import { describe, expect, it } from 'vitest'
import { decodeI2c, decodeSpi, decodeUart, defaultDecoder, runDecoder } from './decoders'
import { makeSample } from './samples'
import type { Signal } from './types'

const bit = (name: string, times: number[], values: string[]): Signal => ({ idx: 0, id: name, name, scope: '', width: 1, kind: 'bit', times, values })

describe('UART', () => {
  const T = 100
  const frame = (byte: number, t0: number, parity?: 'even' | 'odd', stopHigh = true): [number[], string[]] => {
    const times = [t0]
    const values = ['0']
    let ones = 0
    for (let k = 0; k < 8; k++) {
      const b = (byte >> k) & 1
      ones += b
      times.push(t0 + T * (1 + k))
      values.push(String(b))
    }
    let n = 9
    if (parity) {
      const p = parity === 'even' ? ones % 2 : 1 - (ones % 2)
      times.push(t0 + T * n++)
      values.push(String(p))
    }
    times.push(t0 + T * n)
    values.push(stopHigh ? '1' : '0')
    return [times, values]
  }
  const opts = { baud: 1e9 / T, dataBits: 8, parity: 'none' as const, stopBits: 1 as const, msbFirst: false, invert: false }

  it('decodes ASCII H (0x48) LSB first, 8N1', () => {
    const [t, v] = frame(0x48, 500)
    const sig = bit('tx', [0, ...t], ['1', ...v])
    const [track] = decodeUart(sig, 1e-9, opts)
    expect(track.annotations).toHaveLength(1)
    expect(track.annotations[0].text).toBe('H')
    expect(track.annotations[0].detail).toContain('0x48')
    expect(track.annotations[0].start).toBe(500)
    expect(track.annotations[0].end).toBe(500 + 10 * T)
  })
  it('checks parity and framing', () => {
    const [t, v] = frame(0x41, 500, 'even')
    const sig = bit('tx', [0, ...t], ['1', ...v])
    const good = decodeUart(sig, 1e-9, { ...opts, parity: 'even' })[0].annotations[0]
    expect(good.kind).toBe('data')
    const bad = decodeUart(sig, 1e-9, { ...opts, parity: 'odd' })[0].annotations[0]
    expect(bad.kind).toBe('error')
    expect(bad.detail).toContain('parity')
    const [t2, v2] = frame(0x41, 500, undefined, false)
    const fe = decodeUart(bit('tx', [0, ...t2], ['1', ...v2]), 1e-9, opts)[0].annotations[0]
    expect(fe.detail).toContain('framing')
  })
  it('decodes the sample text', () => {
    const cap = makeSample('uart')
    const tx = cap.signals[0]
    const [track] = decodeUart(tx, cap.timescale, { ...opts, baud: 9600 })
    expect(track.annotations.map((a) => a.text).join('')).toBe('Hello, VCD!\r\n'.replace('\r', '0x0D').replace('\n', '0x0A'))
    expect(track.annotations.every((a) => a.kind === 'data')).toBe(true)
    const rx = decodeUart(cap.signals[1], cap.timescale, { ...opts, baud: 9600 })[0]
    expect(rx.annotations.map((a) => a.text).join('')).toBe('OK0x0D0x0A')
  })
  it('supports inverted lines and msb first', () => {
    const [t, v] = frame(0x48, 500)
    const inv = bit('tx', [0, ...t], ['0', ...v.map((x) => (x === '1' ? '0' : '1'))])
    expect(decodeUart(inv, 1e-9, { ...opts, invert: true })[0].annotations[0].text).toBe('H')
    const msb = decodeUart(bit('tx', [0, ...t], ['1', ...v]), 1e-9, { ...opts, msbFirst: true })[0].annotations[0]
    expect(msb.detail).toContain('0x12') // 0x48 = 01001000 reversed = 00010010
  })
})

describe('SPI', () => {
  it('decodes the JEDEC ID transfer in mode 0', () => {
    const cap = makeSample('spi')
    const cfg = defaultDecoder('spi', cap)
    const tracks = runDecoder(cap, cfg)
    expect(tracks.map((t) => t.name)).toEqual(['SPI MOSI', 'SPI MISO'])
    const mosi = tracks[0].annotations.map((a) => a.text)
    const miso = tracks[1].annotations.map((a) => a.text)
    expect(mosi).toEqual(['0x06', '0x9F', '0x00', '0x00', '0x00', '0x03', '0x00', '0x10', '0x00', '0x00', '0x00'])
    expect(miso.slice(1, 5)).toEqual(['0x00', '0xEF', '0x40', '0x18'])
  })
  it('honours clock polarity and phase', () => {
    // Mode 3 (CPOL=1, CPHA=1): idle high, sample on rising edge. Byte 0xA5 MSB first.
    const clkT: number[] = [0]
    const clkV = ['1']
    const dT: number[] = [0]
    const dV = ['0']
    for (let k = 0; k < 8; k++) {
      const t = 100 + k * 100
      dT.push(t + 40)
      dV.push(String((0xa5 >> (7 - k)) & 1))
      clkT.push(t + 20, t + 60)
      clkV.push('0', '1')
    }
    const clk = bit('clk', clkT, clkV)
    const d = bit('mosi', dT, dV)
    const base = { bits: 8, msbFirst: true, csActiveLow: true }
    const ok = decodeSpi({ clk, mosi: d, miso: null, cs: null }, { ...base, cpol: 1, cpha: 1 })
    expect(ok[0].annotations[0].text).toBe('0xA5')
    // CPOL=1, CPHA=0 samples on the falling edge, before each new bit has arrived: the stream shifts by one.
    const falling = decodeSpi({ clk, mosi: d, miso: null, cs: null }, { ...base, cpol: 1, cpha: 0 })
    expect(falling[0].annotations[0].text).toBe('0x52')
  })
})

describe('I2C', () => {
  it('decodes the EEPROM sample', () => {
    const cap = makeSample('i2c')
    const [track] = decodeI2c(cap.signals[0], cap.signals[1])
    const texts = track.annotations.map((a) => a.text)
    expect(texts).toEqual([
      'S', '0x50 W', '0x00', '0xA5', '0x3C', 'P',
      'S', '0x50 W', '0x00', 'Sr', '0x50 R', '0xA5', '0x3C N', 'P',
      'S', '0x68 W NACK', 'P',
    ])
    const addr = track.annotations[1]
    expect(addr.detail).toBe('Address 0x50 write ACK')
    expect(addr.kind).toBe('addr')
    // A byte plus its ACK is nine bit periods of 10 us.
    expect(addr.end - addr.start).toBe(90000)
    expect(track.annotations[2].end - track.annotations[2].start).toBe(90000)
    expect(track.annotations[2].start).toBe(addr.end)
    expect(track.annotations[16 - 1].kind).toBe('error')
  })
})

describe('defaults', () => {
  it('guesses channels from names', () => {
    const cap = makeSample('i2c')
    const d = defaultDecoder('i2c', cap)
    expect(d.kind === 'i2c' && cap.signals[d.scl!].name).toBe('scl')
    expect(d.kind === 'i2c' && cap.signals[d.sda!].name).toBe('sda')
  })
})
