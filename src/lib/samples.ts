import { defaultDecoder, type DecoderConfig } from './decoders'
import { writeVcd } from './vcd'
import type { Capture, Signal, SignalKind } from './types'

export type SampleId = 'i2c' | 'spi' | 'uart' | 'counter'
export const SAMPLE_IDS: SampleId[] = ['i2c', 'spi', 'uart', 'counter']
export const SAMPLE_NAMES: Record<SampleId, string> = {
  i2c: 'I2C EEPROM write and read',
  spi: 'SPI flash JEDEC ID',
  uart: 'UART 9600 8N1 text',
  counter: 'Counter with buses',
}

/** Collects value changes for one signal; the last write at a given time wins. */
class Wave {
  times: number[] = []
  values: string[] = []
  set(t: number, v: string) {
    t = Math.round(t)
    const n = this.times.length
    if (n && this.times[n - 1] === t) this.values[n - 1] = v
    else if (n && this.values[n - 1] === v) return
    else {
      this.times.push(t)
      this.values.push(v)
    }
  }
  signal(name: string, scope: string, kind: SignalKind = 'bit', width = 1): Signal {
    return { idx: 0, id: name, name, scope, width, kind, times: this.times, values: this.values }
  }
}

function finish(name: string, timescale: number, end: number, sigs: Signal[]): Capture {
  sigs.forEach((s, i) => (s.idx = i))
  return { name, timescale, start: 0, end, signals: sigs }
}

function uartSample(): Capture {
  const T = Math.round(1e9 / 9600) // ns per bit at 9600 baud
  const tx = new Wave()
  const rx = new Wave()
  tx.set(0, '1')
  rx.set(0, '1')
  const send = (w: Wave, t: number, byte: number): number => {
    w.set(t, '0')
    for (let k = 0; k < 8; k++) w.set(t + T * (1 + k), String((byte >> k) & 1))
    w.set(t + T * 9, '1')
    return t + T * 10
  }
  let t = T * 3
  for (const c of 'Hello, VCD!\r\n') t = send(tx, t, c.charCodeAt(0))
  let r = t + T * 4
  for (const c of 'OK\r\n') r = send(rx, r, c.charCodeAt(0))
  const end = r + T * 3
  return finish('uart-9600-8n1.vcd', 1e-9, end, [tx.signal('tx', 'uart_tb'), rx.signal('rx', 'uart_tb')])
}

function spiSample(): Capture {
  const cs = new Wave()
  const clk = new Wave()
  const mosi = new Wave()
  const miso = new Wave()
  for (const w of [cs, clk, mosi, miso]) w.set(0, w === cs ? '1' : '0')
  const P = 1000 // 1 MHz clock, mode 0
  const transfer = (t0: number, out: number[], inn: number[]): number => {
    cs.set(t0, '0')
    let base = t0 + 600
    out.forEach((byte, bi) => {
      for (let k = 7; k >= 0; k--) {
        const td = base
        mosi.set(td, String((byte >> k) & 1))
        miso.set(td, String(((inn[bi] ?? 0) >> k) & 1))
        clk.set(td + 300, '1')
        clk.set(td + 800, '0')
        base += P
      }
    })
    mosi.set(base, '0')
    miso.set(base, '0')
    cs.set(base + 200, '1')
    return base + 200
  }
  let t = 2000
  t = transfer(t, [0x06], [0x00]) + 3000 // write enable
  t = transfer(t, [0x9f, 0, 0, 0], [0x00, 0xef, 0x40, 0x18]) + 3000 // read JEDEC ID (Winbond W25Q128)
  t = transfer(t, [0x03, 0x00, 0x10, 0x00, 0, 0], [0, 0, 0, 0, 0xde, 0xad]) + 2000
  return finish('spi-flash-jedec.vcd', 1e-9, t, [
    cs.signal('cs_n', 'spi_tb'),
    clk.signal('sclk', 'spi_tb'),
    mosi.signal('mosi', 'spi_tb'),
    miso.signal('miso', 'spi_tb'),
  ])
}

function i2cSample(): Capture {
  const scl = new Wave()
  const sda = new Wave()
  scl.set(0, '1')
  sda.set(0, '1')
  const q = 2500 // 100 kHz bus: 10 us per bit, 4 quarters
  let t = 4000
  const start = () => {
    sda.set(t, '0')
    scl.set(t + q, '0')
    t += 2 * q
  }
  const bit = (b: number) => {
    sda.set(t, String(b))
    scl.set(t + q, '1')
    scl.set(t + 3 * q, '0')
    t += 4 * q
  }
  const byte = (v: number, ack: boolean) => {
    for (let k = 7; k >= 0; k--) bit((v >> k) & 1)
    bit(ack ? 0 : 1)
  }
  const repStart = () => {
    sda.set(t, '1')
    scl.set(t + q, '1')
    sda.set(t + 2 * q, '0')
    scl.set(t + 3 * q, '0')
    t += 4 * q
  }
  const stop = () => {
    sda.set(t, '0')
    scl.set(t + q, '1')
    sda.set(t + 2 * q, '1')
    t += 4 * q
  }
  // Write 0xA5, 0x3C to address 0 of a 24C02 EEPROM (7-bit address 0x50).
  start()
  byte(0xa0, true)
  byte(0x00, true)
  byte(0xa5, true)
  byte(0x3c, true)
  stop()
  t += 8 * q
  // Random read: set the pointer, repeated start, read two bytes, NACK the last.
  start()
  byte(0xa0, true)
  byte(0x00, true)
  repStart()
  byte(0xa1, true)
  byte(0xa5, true)
  byte(0x3c, false)
  stop()
  t += 8 * q
  // An address nobody answers.
  start()
  byte(0x68 << 1, false)
  stop()
  t += 4 * q
  return finish('i2c-eeprom.vcd', 1e-9, t, [scl.signal('scl', 'i2c_tb'), sda.signal('sda', 'i2c_tb')])
}

function counterSample(): Capture {
  const clk = new Wave()
  const rst = new Wave()
  const en = new Wave()
  const count = new Wave()
  const lfsr = new Wave()
  const ovf = new Wave()
  const vout = new Wave()
  const bin = (v: number, w: number) => v.toString(2).padStart(w, '0')
  clk.set(0, '0')
  rst.set(0, '0')
  en.set(0, '0')
  count.set(0, 'xxxx')
  lfsr.set(0, 'xxxxxxxx')
  ovf.set(0, 'x')
  rst.set(230, '1')
  en.set(330, '1')
  en.set(2430, '0')
  en.set(2830, '1')
  let c = 0
  let l = 0
  let resetDone = false
  const cycles = 40
  for (let i = 0; i < cycles; i++) {
    const tr = 50 + i * 100
    clk.set(tr, '1')
    clk.set(tr + 50, '0')
    const rstHigh = tr > 230
    const enHigh = (tr > 330 && tr < 2430) || tr > 2830
    if (!rstHigh) {
      c = 0
      l = 1
      resetDone = true
    } else if (enHigh) {
      c = (c + 1) & 15
      l = (l >> 1) ^ (l & 1 ? 0xb8 : 0)
    }
    if (resetDone) {
      count.set(tr + 3, bin(c, 4))
      lfsr.set(tr + 3, bin(l, 8))
      ovf.set(tr + 3, c === 15 ? '1' : '0')
    }
    vout.set(tr + 3, (1.65 + 1.4 * Math.sin((i / cycles) * Math.PI * 4)).toFixed(3))
  }
  return finish('counter.vcd', 1e-9, 50 + cycles * 100 + 50, [
    clk.signal('clk', 'tb'),
    rst.signal('rst_n', 'tb'),
    en.signal('en', 'tb'),
    count.signal('count[3:0]', 'tb.dut', 'bus', 4),
    lfsr.signal('lfsr[7:0]', 'tb.dut', 'bus', 8),
    ovf.signal('overflow', 'tb.dut'),
    vout.signal('vout', 'tb.adc', 'real', 64),
  ])
}

export function makeSample(id: SampleId): Capture {
  switch (id) {
    case 'i2c':
      return i2cSample()
    case 'spi':
      return spiSample()
    case 'uart':
      return uartSample()
    case 'counter':
      return counterSample()
  }
}

/** The sample as VCD text, the same bytes a user would download and reopen. */
export function sampleVcd(id: SampleId): string {
  return writeVcd(makeSample(id))
}

/** Decoders that suit a sample, so it shows something on first load. */
export function sampleDecoders(id: SampleId, cap: Capture): DecoderConfig[] {
  if (id === 'i2c') return [defaultDecoder('i2c', cap)]
  if (id === 'spi') return [defaultDecoder('spi', cap)]
  if (id === 'uart') {
    const tx = defaultDecoder('uart', cap)
    const rx = defaultDecoder('uart', cap)
    if (rx.kind === 'uart') rx.rx = cap.signals.find((s) => s.name === 'rx')?.idx ?? null
    return [tx, rx]
  }
  return []
}
