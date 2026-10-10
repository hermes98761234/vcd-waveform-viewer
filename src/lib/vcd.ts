import type { Capture, Signal } from './types'

const UNITS: [string, number][] = [
  ['s', 1],
  ['ms', 1e-3],
  ['us', 1e-6],
  ['ns', 1e-9],
  ['ps', 1e-12],
  ['fs', 1e-15],
]

/** "10 ns", "1ps" → seconds per tick. Falls back to 1 ns for unreadable input. */
export function parseTimescale(s: string): number {
  const m = /^\s*(\d+)\s*(s|ms|us|ns|ps|fs)\s*$/.exec(s)
  if (!m) return 1e-9
  return Number(m[1]) * UNITS.find((u) => u[0] === m[2])![1]
}

/** Seconds per tick → "1 ns" (VCD $timescale form). */
export function formatTimescale(sec: number): string {
  for (const [unit, scale] of UNITS) {
    for (const mult of [1, 10, 100]) {
      if (Math.abs(sec - mult * scale) <= mult * scale * 1e-6) return `${mult} ${unit}`
    }
  }
  return '1 ns'
}

/** Vector values may be shortened in VCD: left-extend with 0 (or x/z if the leftmost bit is x/z). */
function normalizeBits(v: string, width: number): string {
  v = v.toLowerCase()
  if (v.length >= width) return v.length > width ? v.slice(v.length - width) : v
  const first = v[0]
  return v.padStart(width, first === 'x' || first === 'z' ? first : '0')
}

/** Parses a Value Change Dump (IEEE 1364) file. Throws if no variables are declared. */
export function parseVcd(text: string, name = 'capture.vcd'): Capture {
  const signals: Signal[] = []
  const byId = new Map<string, Signal>() // the signal that owns the change arrays for an id code
  const scopes: string[] = []
  let timescale = 1e-9
  let inHeader = true
  let cmd: string | null = null
  let args: string[] = []
  let time = 0
  let first = Infinity
  let last = 0
  let skipping = false

  const finishCommand = () => {
    switch (cmd) {
      case '$timescale':
        timescale = parseTimescale(args.join(' '))
        break
      case '$scope':
        scopes.push(args[1] ?? args[0] ?? '')
        break
      case '$upscope':
        scopes.pop()
        break
      case '$var': {
        const [type, size, id, ...rest] = args
        if (!id || rest.length === 0) break
        const width = Math.max(1, Number.parseInt(size, 10) || 1)
        const isReal = type === 'real' || type === 'realtime'
        const owner = byId.get(id)
        const sig: Signal = {
          idx: signals.length,
          id,
          name: rest.join(''),
          scope: scopes.join('.'),
          width: isReal ? 64 : width,
          kind: isReal ? 'real' : width > 1 ? 'bus' : 'bit',
          times: owner ? owner.times : [],
          values: owner ? owner.values : [],
        }
        if (!owner) byId.set(id, sig)
        signals.push(sig)
        break
      }
      case '$enddefinitions':
        inHeader = false
        break
    }
  }

  const record = (id: string, v: string) => {
    const s = byId.get(id)
    if (!s) return
    const n = s.times.length
    if (n > 0 && s.times[n - 1] === time) {
      // Several changes in the same tick: the last one wins, and a glitch back to the old value vanishes.
      if (n >= 2 && s.values[n - 2] === v) {
        s.times.pop()
        s.values.pop()
      } else s.values[n - 1] = v
    } else if (n > 0 && s.values[n - 1] === v) return
    else {
      s.times.push(time)
      s.values.push(v)
    }
  }

  let pos = 0
  const len = text.length
  while (pos < len) {
    let nl = text.indexOf('\n', pos)
    if (nl < 0) nl = len
    const line = text.slice(pos, nl).trim()
    pos = nl + 1
    if (!line) continue
    if (inHeader) {
      for (const tok of line.split(/\s+/)) {
        if (cmd === null) {
          if (tok[0] === '$') {
            cmd = tok
            args = []
          }
        } else if (tok === '$end') {
          finishCommand()
          cmd = null
        } else args.push(tok)
      }
      continue
    }
    if (skipping) {
      if (line.includes('$end')) skipping = false
      continue
    }
    const c = line[0]
    if (c === '#') {
      time = Number(line.slice(1))
      if (Number.isFinite(time)) {
        if (time < first) first = time
        if (time > last) last = time
      }
    } else if (c === '$') {
      if (/^\$(comment|date|version)/.test(line) && !line.includes('$end')) skipping = true
    } else if (c === 'b' || c === 'B') {
      const sp = line.search(/\s/)
      if (sp > 0) {
        const id = line.slice(sp).trim()
        const s = byId.get(id)
        if (s) record(id, normalizeBits(line.slice(1, sp), s.width))
      }
    } else if (c === 'r' || c === 'R') {
      const sp = line.search(/\s/)
      if (sp > 0) record(line.slice(sp).trim(), line.slice(1, sp))
    } else if ('01xXzZ'.includes(c)) {
      record(line.slice(1).trim(), c.toLowerCase())
    }
  }

  if (signals.length === 0) throw new Error('No signals found. Is this a VCD file?')
  let start = Number.isFinite(first) ? Math.min(first, 0) : 0
  for (const s of signals) {
    if (s.times.length) {
      start = Math.min(start, s.times[0])
      last = Math.max(last, s.times[s.times.length - 1])
    }
  }
  if (last <= start) last = start + 1
  return { name, timescale, start, end: last, signals }
}

function idCode(n: number): string {
  // Printable ASCII 33..126, base 94.
  let s = ''
  do {
    s = String.fromCharCode(33 + (n % 94)) + s
    n = Math.floor(n / 94)
  } while (n > 0)
  return s
}

/** Serializes a capture as VCD. Signals sharing change arrays (aliases) get a shared id code. */
export function writeVcd(cap: Capture): string {
  const out: string[] = []
  out.push('$date', '  generated by VCD Waveform Viewer', '$end')
  out.push('$version', '  vcd-waveform-viewer', '$end')
  out.push(`$timescale ${formatTimescale(cap.timescale)} $end`)
  const ids = new Map<number[], string>()
  const owners: Signal[] = []
  const idOf = (s: Signal) => {
    let id = ids.get(s.times)
    if (!id) {
      id = idCode(ids.size)
      ids.set(s.times, id)
      owners.push(s)
    }
    return id
  }
  // Group by scope, preserving order of first appearance.
  const scopeOrder: string[] = []
  for (const s of cap.signals) if (!scopeOrder.includes(s.scope)) scopeOrder.push(s.scope)
  for (const scope of scopeOrder) {
    const parts = scope ? scope.split('.') : ['top']
    for (const p of parts) out.push(`$scope module ${p} $end`)
    for (const s of cap.signals) {
      if (s.scope !== scope) continue
      const type = s.kind === 'real' ? 'real' : 'wire'
      out.push(`$var ${type} ${s.kind === 'real' ? 64 : s.width} ${idOf(s)} ${s.name} $end`)
    }
    for (let i = 0; i < parts.length; i++) out.push('$upscope $end')
  }
  out.push('$enddefinitions $end')
  type Ev = { t: number; order: number; id: string; line: string }
  const evs: Ev[] = []
  let order = 0
  for (const s of owners) {
    const id = ids.get(s.times)!
    for (let i = 0; i < s.times.length; i++) {
      const v = s.values[i]
      const line = s.kind === 'bit' ? `${v}${id}` : s.kind === 'bus' ? `b${v} ${id}` : `r${v} ${id}`
      evs.push({ t: s.times[i], order: order++, id, line })
    }
  }
  evs.sort((a, b) => a.t - b.t || a.order - b.order)
  let cur = -1
  for (const e of evs) {
    if (e.t !== cur) {
      out.push(`#${e.t}`)
      cur = e.t
    }
    out.push(e.line)
  }
  if (cap.end > cur) out.push(`#${cap.end}`)
  return out.join('\n') + '\n'
}
