import type { Capture, Signal } from './types'

const TIME_UNITS: Record<string, number> = { s: 1, ms: 1e-3, us: 1e-6, 'µs': 1e-6, ns: 1e-9, ps: 1e-12 }

function splitLine(line: string, delim: string | null): string[] {
  const cells = delim ? line.split(delim) : line.trim().split(/\s+/)
  return cells.map((c) => c.trim().replace(/^"(.*)"$/, '$1'))
}

function detectDelimiter(line: string): string | null {
  const counts: [string, number][] = [',', ';', '\t'].map((d) => [d, line.split(d).length - 1])
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : null
}

export interface CsvOptions {
  /** Samples per second when the file has no time column. */
  sampleRate?: number
}

/**
 * Parses a logic-analyzer style CSV: an optional time column (header like "Time [s]", "time_ns") plus
 * one column per channel. Columns holding only 0/1 become bit signals, other numeric columns become reals.
 * Without a time column each row is one sample at `sampleRate`.
 */
export function parseCsv(text: string, name = 'capture.csv', opts: CsvOptions = {}): Capture {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !l.startsWith('#') && !l.startsWith(';;'))
  if (lines.length === 0) throw new Error('The file is empty.')
  const delim = detectDelimiter(lines[0])
  const rows = lines.map((l) => splitLine(l, delim))
  const isNum = (c: string) => c !== '' && Number.isFinite(Number(c))
  const hasHeader = rows[0].some((c) => !isNum(c) && !/^[xXzZ]$/.test(c))
  const header = hasHeader ? rows[0] : rows[0].map((_, i) => `ch${i}`)
  const data = hasHeader ? rows.slice(1) : rows
  if (data.length === 0) throw new Error('No data rows.')

  let timeCol = hasHeader ? header.findIndex((h) => /time|^t$|^ts$|^timestamp/i.test(h)) : -1
  let unit = 1
  if (timeCol >= 0) {
    const m = /[[(]\s*(s|ms|us|µs|ns|ps)\s*[\])]|_(s|ms|us|ns|ps)$/i.exec(header[timeCol])
    const u = (m?.[1] ?? m?.[2] ?? 's').toLowerCase()
    unit = TIME_UNITS[u] ?? 1
  }
  if (timeCol >= 0 && !data.every((r) => isNum(r[timeCol] ?? ''))) timeCol = -1

  let timescale: number
  let ticks: number[]
  if (timeCol >= 0) {
    const secs = data.map((r) => Number(r[timeCol]) * unit)
    let minDelta = Infinity
    for (let i = 1; i < secs.length; i++) {
      const d = secs[i] - secs[i - 1]
      if (d > 0 && d < minDelta) minDelta = d
    }
    if (!Number.isFinite(minDelta)) minDelta = 1e-6
    timescale = Math.max(1e-15, Math.pow(10, Math.floor(Math.log10(minDelta))))
    const t0 = secs[0]
    ticks = secs.map((s) => Math.round((s - t0) / timescale))
  } else {
    const rate = opts.sampleRate && opts.sampleRate > 0 ? opts.sampleRate : 1e6
    timescale = 1 / rate
    ticks = data.map((_, i) => i)
  }

  const signals: Signal[] = []
  for (let c = 0; c < header.length; c++) {
    if (c === timeCol) continue
    const col = data.map((r) => (r[c] ?? '').trim())
    const bitLike = col.every((v) => /^[01xXzZ]$/.test(v))
    const numeric = col.every(isNum)
    if (!bitLike && !numeric) continue
    const sig: Signal = {
      idx: signals.length,
      id: String(c),
      name: header[c] || `ch${c}`,
      scope: '',
      width: bitLike ? 1 : 64,
      kind: bitLike ? 'bit' : 'real',
      times: [],
      values: [],
    }
    let prev = ''
    for (let i = 0; i < col.length; i++) {
      const v = bitLike ? col[i].toLowerCase() : String(Number(col[i]))
      if (v === prev) continue
      if (sig.times.length && sig.times[sig.times.length - 1] === ticks[i]) sig.values[sig.values.length - 1] = v
      else {
        sig.times.push(ticks[i])
        sig.values.push(v)
      }
      prev = v
    }
    signals.push(sig)
  }
  if (signals.length === 0) throw new Error('No numeric channel columns found.')
  const end = Math.max(ticks[ticks.length - 1], ticks[0] + 1)
  return { name, timescale, start: 0, end, signals }
}
