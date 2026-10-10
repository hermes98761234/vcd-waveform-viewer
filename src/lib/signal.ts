import type { Signal } from './types'

export type Radix = 'hex' | 'dec' | 'sdec' | 'bin' | 'ascii'
export const RADIXES: Radix[] = ['hex', 'dec', 'sdec', 'bin', 'ascii']

/** First index with a[i] >= t. */
export function lowerBound(a: number[], t: number): number {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (a[m] < t) lo = m + 1
    else hi = m
  }
  return lo
}

/** First index with a[i] > t. */
export function upperBound(a: number[], t: number): number {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (a[m] <= t) lo = m + 1
    else hi = m
  }
  return lo
}

/** Index of the last change at or before t, or -1. */
export function indexAt(sig: Signal, t: number): number {
  return upperBound(sig.times, t) - 1
}

/** Value at time t ('x' before the first change). */
export function valueAt(sig: Signal, t: number): string {
  const i = indexAt(sig, t)
  if (i < 0) return sig.kind === 'bus' ? 'x'.repeat(sig.width) : 'x'
  return sig.values[i]
}

function hexOf(v: string): string {
  const pad = (4 - (v.length % 4)) % 4
  const lead = v[0] === 'x' || v[0] === 'z' ? v[0] : '0'
  const p = lead.repeat(pad) + v
  let out = ''
  for (let i = 0; i < p.length; i += 4) {
    const n = p.slice(i, i + 4)
    if (/^x+$/.test(n)) out += 'x'
    else if (/^z+$/.test(n)) out += 'z'
    else if (/[xz]/.test(n)) out += 'X'
    else out += Number.parseInt(n, 2).toString(16).toUpperCase()
  }
  return out
}

export function formatReal(v: string): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  return String(Number(n.toPrecision(6)))
}

/** Renders a signal value for display. */
export function formatValue(sig: Signal, v: string, radix: Radix): string {
  if (sig.kind === 'real') return formatReal(v)
  if (sig.kind === 'bit') return v
  switch (radix) {
    case 'bin':
      return v
    case 'hex':
      return hexOf(v)
    case 'dec':
      return /[xz]/.test(v) ? 'x' : BigInt('0b' + v).toString()
    case 'sdec': {
      if (/[xz]/.test(v)) return 'x'
      let b = BigInt('0b' + v)
      if (v[0] === '1') b -= 1n << BigInt(v.length)
      return b.toString()
    }
    case 'ascii': {
      if (/[xz]/.test(v)) return 'x'
      const p = v.padStart(Math.ceil(v.length / 8) * 8, '0')
      let s = ''
      for (let i = 0; i < p.length; i += 8) {
        const c = Number.parseInt(p.slice(i, i + 8), 2)
        s += c >= 32 && c < 127 ? String.fromCharCode(c) : '.'
      }
      return s
    }
  }
}

const TIME_UNITS: [number, string][] = [
  [1, 's'],
  [1e-3, 'ms'],
  [1e-6, 'µs'],
  [1e-9, 'ns'],
  [1e-12, 'ps'],
  [1e-15, 'fs'],
]

/** Seconds → "1.5 µs". With `stepSec`, shows just enough decimals to tell apart multiples of that step. */
export function formatSeconds(sec: number, stepSec?: number): string {
  if (sec === 0) return '0 s'
  const a = Math.abs(sec)
  const [scale, unit] = TIME_UNITS.find((u) => a >= u[0] * 0.9995) ?? TIME_UNITS[TIME_UNITS.length - 1]
  const v = sec / scale
  if (stepSec !== undefined && stepSec > 0) {
    const decimals = Math.min(9, Math.max(0, Math.ceil(-Math.log10(stepSec / scale) - 1e-9)))
    return `${v.toFixed(decimals)} ${unit}`
  }
  return `${Number(v.toPrecision(6))} ${unit}`
}

export function formatFreq(hz: number): string {
  const a = Math.abs(hz)
  if (a >= 1e9) return `${Number((hz / 1e9).toPrecision(4))} GHz`
  if (a >= 1e6) return `${Number((hz / 1e6).toPrecision(4))} MHz`
  if (a >= 1e3) return `${Number((hz / 1e3).toPrecision(4))} kHz`
  return `${Number(hz.toPrecision(4))} Hz`
}

/** Smallest 1/2/5 × 10^k that is >= min. */
export function niceStep(min: number): number {
  if (!(min > 0)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(min)))
  for (const m of [1, 2, 5, 10]) if (m * p >= min * (1 - 1e-12)) return m * p
  return 10 * p
}

export type EdgeKind = 'any' | 'rising' | 'falling'

export type Matcher = (prev: string, cur: string) => boolean

export function edgeMatcher(kind: EdgeKind): Matcher {
  if (kind === 'rising') return (p, c) => p === '0' && c === '1'
  if (kind === 'falling') return (p, c) => p === '1' && c === '0'
  return () => true
}

/** Time of the next (dir 1) or previous (dir -1) value change strictly after/before t that satisfies match. */
export function findChange(sig: Signal, t: number, dir: 1 | -1, match: Matcher): number | null {
  const ts = sig.times
  if (dir === 1) {
    for (let j = upperBound(ts, t); j < ts.length; j++) {
      if (match(j > 0 ? sig.values[j - 1] : 'x', sig.values[j])) return ts[j]
    }
  } else {
    for (let j = lowerBound(ts, t) - 1; j >= 0; j--) {
      if (match(j > 0 ? sig.values[j - 1] : 'x', sig.values[j])) return ts[j]
    }
  }
  return null
}

/** Parses "0x1F", "0b101", "31", or bare digits in the given radix. */
export function parseNumberInput(text: string, radix: Radix): bigint | null {
  const s = text.trim()
  if (/^0x[0-9a-f]+$/i.test(s)) return BigInt(s)
  if (/^0b[01]+$/i.test(s)) return BigInt(s)
  if (radix === 'hex' && /^[0-9a-f]+$/i.test(s)) return BigInt('0x' + s)
  if (radix === 'bin' && /^[01]+$/.test(s)) return BigInt('0b' + s)
  if (/^[0-9]+$/.test(s)) return BigInt(s)
  if (radix === 'sdec' && /^-[0-9]+$/.test(s)) return BigInt(s)
  return null
}

/** Matcher for "signal equals this value" that fires on the change that makes it equal. */
export function valueMatcher(sig: Signal, text: string, radix: Radix): Matcher | null {
  if (sig.kind === 'real') {
    const target = Number(text)
    if (text.trim() === '' || !Number.isFinite(target)) return null
    return (p, c) => Number(c) === target && Number(p) !== target
  }
  let target = parseNumberInput(text, radix)
  if (target === null) return null
  if (target < 0n) target += 1n << BigInt(sig.width)
  const t = target
  const eq = (v: string) => !/[xz]/.test(v) && BigInt('0b' + v) === t
  return (_p, c) => eq(c)
}

export interface BitMeasure {
  rising: number
  falling: number
  high: number
  low: number
  /** Mean frequency from rising edges, if at least two. */
  periodTicks: number | null
}

/** Edge counts and high/low time of a 1-bit signal between t1 and t2. */
export function measureBit(sig: Signal, t1: number, t2: number): BitMeasure {
  if (t2 < t1) [t1, t2] = [t2, t1]
  const m: BitMeasure = { rising: 0, falling: 0, high: 0, low: 0, periodTicks: null }
  const ts = sig.times
  let firstRise = 0
  let lastRise = 0
  let i = Math.max(0, indexAt(sig, t1))
  for (; i < ts.length && ts[i] < t2; i++) {
    const segStart = Math.max(ts[i], t1)
    const segEnd = Math.min(i + 1 < ts.length ? ts[i + 1] : t2, t2)
    const v = sig.values[i]
    if (segEnd > segStart) {
      if (v === '1') m.high += segEnd - segStart
      else if (v === '0') m.low += segEnd - segStart
    }
    if (ts[i] > t1) {
      const p = i > 0 ? sig.values[i - 1] : 'x'
      if (p === '0' && v === '1') {
        if (m.rising === 0) firstRise = ts[i]
        lastRise = ts[i]
        m.rising++
      } else if (p === '1' && v === '0') m.falling++
    }
  }
  if (m.rising >= 2) m.periodTicks = (lastRise - firstRise) / (m.rising - 1)
  return m
}

const STANDARD_BAUDS = [300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 76800, 115200, 230400, 460800, 921600, 1000000, 2000000]

/** Guesses the UART baud rate from the shortest pulse, snapped to a standard rate when close. */
export function estimateBaud(sig: Signal, timescale: number): number | null {
  const ts = sig.times
  let min = Infinity
  for (let i = 1; i < ts.length; i++) {
    const d = ts[i] - ts[i - 1]
    if (d > 0 && d < min) min = d
  }
  if (!Number.isFinite(min)) return null
  const raw = 1 / (min * timescale)
  const near = STANDARD_BAUDS.find((b) => Math.abs(b - raw) / b < 0.06)
  return near ?? Math.round(raw)
}
