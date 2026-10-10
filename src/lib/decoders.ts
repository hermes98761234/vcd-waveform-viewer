import { indexAt, valueAt } from './signal'
import type { Capture, Signal } from './types'

export type AnnKind = 'data' | 'addr' | 'ctrl' | 'error'

export interface Annotation {
  start: number
  end: number
  /** Short label drawn on the waveform. */
  text: string
  /** Longer description for the results table. */
  detail: string
  kind: AnnKind
}

export interface Track {
  name: string
  annotations: Annotation[]
}

export interface UartConfig {
  id: string
  kind: 'uart'
  rx: number | null
  baud: number
  dataBits: number
  parity: 'none' | 'even' | 'odd'
  stopBits: 1 | 2
  msbFirst: boolean
  invert: boolean
}

export interface SpiConfig {
  id: string
  kind: 'spi'
  clk: number | null
  mosi: number | null
  miso: number | null
  cs: number | null
  cpol: 0 | 1
  cpha: 0 | 1
  bits: number
  msbFirst: boolean
  csActiveLow: boolean
}

export interface I2cConfig {
  id: string
  kind: 'i2c'
  scl: number | null
  sda: number | null
}

export type DecoderConfig = UartConfig | SpiConfig | I2cConfig

const hex = (v: number, digits = 2) => '0x' + v.toString(16).toUpperCase().padStart(digits, '0')
const printable = (c: number) => c >= 32 && c < 127

const lvl = (sig: Signal, t: number): 0 | 1 | -1 => {
  const v = valueAt(sig, t)
  return v === '1' ? 1 : v === '0' ? 0 : -1
}

export function decodeUart(sig: Signal, timescale: number, o: Omit<UartConfig, 'id' | 'kind' | 'rx'>): Track[] {
  const track: Track = { name: `UART ${sig.name}`, annotations: [] }
  const T = 1 / (o.baud * timescale)
  if (!(T >= 2)) return [track]
  // Logical bit as seen by the UART (idle = 1).
  const bit = (t: number): number => {
    const l = lvl(sig, t)
    return l < 0 ? -1 : o.invert ? 1 - l : l
  }
  const ts = sig.times
  let minT = -Infinity
  for (let i = 1; i < ts.length; i++) {
    const t0 = ts[i]
    if (t0 < minT) continue
    const prevLevel = sig.values[i - 1]
    const curLevel = sig.values[i]
    // Start bit: idle (1) to active (0) in logical terms.
    const idleChar = o.invert ? '0' : '1'
    if (!(prevLevel === idleChar && curLevel !== idleChar && (curLevel === '0' || curLevel === '1'))) continue
    if (bit(t0 + T / 2) !== 0) continue
    let val = 0
    let ones = 0
    let ok = true
    for (let k = 0; k < o.dataBits; k++) {
      const b = bit(t0 + T * (1.5 + k))
      if (b < 0) {
        ok = false
        break
      }
      ones += b
      if (o.msbFirst) val = val * 2 + b
      else val += b * Math.pow(2, k)
    }
    let pos = 1.5 + o.dataBits
    let parityErr = false
    if (o.parity !== 'none') {
      const pb = bit(t0 + T * pos)
      if (pb < 0) ok = false
      else {
        const total = ones + pb
        parityErr = o.parity === 'even' ? total % 2 !== 0 : total % 2 === 0
      }
      pos += 1
    }
    let framing = false
    for (let s = 0; s < o.stopBits; s++) {
      if (bit(t0 + T * (pos + s)) !== 1) framing = true
    }
    const end = t0 + T * (pos - 0.5 + o.stopBits)
    minT = end - T / 2
    if (!ok) {
      track.annotations.push({ start: t0, end, text: '?', detail: 'Unknown (x/z) bits', kind: 'error' })
      continue
    }
    const ch = printable(val) ? String.fromCharCode(val) : ''
    const errs = (framing ? ' framing error' : '') + (parityErr ? ' parity error' : '')
    track.annotations.push({
      start: t0,
      end,
      text: errs ? `${hex(val)}!` : ch || hex(val),
      detail: `${hex(val, Math.ceil(o.dataBits / 4))}${ch ? ` '${ch}'` : ''}${errs}`,
      kind: errs ? 'error' : 'data',
    })
  }
  return [track]
}

export function decodeSpi(
  sigs: { clk: Signal; mosi: Signal | null; miso: Signal | null; cs: Signal | null },
  o: Pick<SpiConfig, 'cpol' | 'cpha' | 'bits' | 'msbFirst' | 'csActiveLow'>,
): Track[] {
  const { clk, mosi, miso, cs } = sigs
  const sampleRising = o.cpol === o.cpha
  const edges: number[] = []
  for (let j = 0; j < clk.times.length; j++) {
    const p = j > 0 ? clk.values[j - 1] : 'x'
    const c = clk.values[j]
    if (sampleRising ? p === '0' && c === '1' : p === '1' && c === '0') edges.push(clk.times[j])
  }
  const activeChar = o.csActiveLow ? '0' : '1'
  const lines: [string, Signal | null][] = [
    ['MOSI', mosi],
    ['MISO', miso],
  ]
  const tracks: Track[] = lines.filter((l) => l[1]).map(([name]) => ({ name: `SPI ${name}`, annotations: [] }))
  const active = lines.filter((l) => l[1]) as [string, Signal][]
  if (active.length === 0) return []

  let group = -2
  let times: number[] = []
  const flush = () => {
    times = []
  }
  const emit = () => {
    const first = times[0]
    const last = times[times.length - 1]
    const p = times.length > 1 ? (last - first) / (times.length - 1) : 1
    active.forEach(([name, sig], ti) => {
      let val = 0
      let bad = false
      for (let k = 0; k < times.length; k++) {
        const l = lvl(sig, times[k])
        if (l < 0) bad = true
        const b = l < 0 ? 0 : l
        if (o.msbFirst) val = val * 2 + b
        else val += b * Math.pow(2, k)
      }
      const digits = Math.ceil(o.bits / 4)
      tracks[ti].annotations.push({
        start: first - p / 2,
        end: last + p / 2,
        text: bad ? '?' : hex(val, digits),
        detail: bad ? `${name}: unknown bits` : `${name}: ${hex(val, digits)} (${val})`,
        kind: bad ? 'error' : 'data',
      })
    })
  }
  for (const t of edges) {
    let g = 0
    if (cs) {
      if (valueAt(cs, t) !== activeChar) continue
      // Transaction id = index of the change that asserted CS.
      g = indexAt(cs, t)
    }
    if (g !== group) {
      flush()
      group = g
    }
    times.push(t)
    if (times.length === o.bits) {
      emit()
      flush()
    }
  }
  return tracks
}

export function decodeI2c(scl: Signal, sda: Signal): Track[] {
  const track: Track = { name: 'I2C', annotations: [] }
  type Ev = { t: number; scl: boolean; v: '0' | '1' }
  const evs: Ev[] = []
  const add = (sig: Signal, isScl: boolean) => {
    for (let i = 0; i < sig.times.length; i++) {
      const v = sig.values[i]
      if (v === '0' || v === '1') evs.push({ t: sig.times[i], scl: isScl, v })
    }
  }
  add(scl, true)
  add(sda, false)
  // At equal times: data settles before SCL rises, and SCL falls before data changes.
  const rank = (e: Ev) => (e.scl ? (e.v === '1' ? 1 : -1) : 0)
  evs.sort((a, b) => a.t - b.t || rank(a) - rank(b))

  let sclV = '1'
  let sdaV = '1'
  let inTx = false
  let bitCount = 0
  let byteVal = 0
  let byteIdx = 0
  let bitStart = 0
  let ack = false

  const point = (t: number, text: string, detail: string) =>
    track.annotations.push({ start: t, end: t, text, detail, kind: 'ctrl' })

  for (const e of evs) {
    if (e.scl) {
      const prev = sclV
      sclV = e.v
      if (!inTx) continue
      if (prev === '0' && e.v === '1') {
        if (bitCount < 8) {
          byteVal = byteVal * 2 + (sdaV === '1' ? 1 : 0)
          bitCount++
        } else if (bitCount === 8) {
          ack = sdaV === '0'
          bitCount = 9
        }
      } else if (prev === '1' && e.v === '0') {
        if (bitCount === 9) {
          const ackText = ack ? 'ACK' : 'NACK'
          if (byteIdx === 0) {
            const addr = byteVal >> 1
            const read = (byteVal & 1) === 1
            track.annotations.push({
              start: bitStart,
              end: e.t,
              text: `${hex(addr)} ${read ? 'R' : 'W'}${ack ? '' : ' NACK'}`,
              detail: `Address ${hex(addr)} ${read ? 'read' : 'write'} ${ackText}`,
              kind: ack ? 'addr' : 'error',
            })
          } else {
            track.annotations.push({
              start: bitStart,
              end: e.t,
              text: ack ? hex(byteVal) : `${hex(byteVal)} N`,
              detail: `Data ${hex(byteVal)} ${ackText}`,
              kind: 'data',
            })
          }
          byteIdx++
          bitCount = 0
          byteVal = 0
          bitStart = e.t
        } else if (bitCount === 0) bitStart = e.t
      }
    } else {
      const prev = sdaV
      sdaV = e.v
      if (sclV !== '1' || prev === e.v) continue
      if (e.v === '0') {
        point(e.t, inTx ? 'Sr' : 'S', inTx ? 'Repeated START' : 'START')
        inTx = true
        bitCount = 0
        byteVal = 0
        byteIdx = 0
        bitStart = e.t
      } else if (inTx) {
        point(e.t, 'P', 'STOP')
        inTx = false
      }
    }
  }
  return [track]
}

/** Runs a configured decoder against a capture. Missing channels give no tracks. */
export function runDecoder(cap: Capture, cfg: DecoderConfig): Track[] {
  const sig = (i: number | null) => (i === null ? null : (cap.signals[i] ?? null))
  switch (cfg.kind) {
    case 'uart': {
      const rx = sig(cfg.rx)
      return rx ? decodeUart(rx, cap.timescale, cfg) : []
    }
    case 'spi': {
      const clk = sig(cfg.clk)
      return clk ? decodeSpi({ clk, mosi: sig(cfg.mosi), miso: sig(cfg.miso), cs: sig(cfg.cs) }, cfg) : []
    }
    case 'i2c': {
      const scl = sig(cfg.scl)
      const sda = sig(cfg.sda)
      return scl && sda ? decodeI2c(scl, sda) : []
    }
  }
}

let nextId = 1

function find(cap: Capture, ...patterns: RegExp[]): number | null {
  const bits = cap.signals.filter((s) => s.kind === 'bit')
  for (const p of patterns) {
    const s = bits.find((b) => p.test(b.name))
    if (s) return s.idx
  }
  return null
}

/** A decoder with its channels guessed from signal names (tx, sclk, sda...). */
export function defaultDecoder(kind: DecoderConfig['kind'], cap: Capture): DecoderConfig {
  const id = `dec${nextId++}`
  const bits = cap.signals.filter((s) => s.kind === 'bit').map((s) => s.idx)
  const nth = (n: number) => bits[n] ?? null
  if (kind === 'uart') {
    return {
      id,
      kind,
      rx: find(cap, /^(tx|rx|txd|rxd|uart)/i) ?? nth(0),
      baud: 9600,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      msbFirst: false,
      invert: false,
    }
  }
  if (kind === 'spi') {
    return {
      id,
      kind,
      clk: find(cap, /sclk|sck|clk/i) ?? nth(0),
      mosi: find(cap, /mosi|sdo|copi|din/i) ?? nth(1),
      miso: find(cap, /miso|sdi|cipo|dout/i),
      cs: find(cap, /^(cs|ss|nss|csn|cs_n|ncs)/i),
      cpol: 0,
      cpha: 0,
      bits: 8,
      msbFirst: true,
      csActiveLow: true,
    }
  }
  return { id, kind: 'i2c', scl: find(cap, /scl/i) ?? nth(0), sda: find(cap, /sda/i) ?? nth(1) }
}
