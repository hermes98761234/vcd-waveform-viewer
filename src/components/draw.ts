import type { Annotation } from '../lib/decoders'
import { formatSeconds, formatValue, indexAt, niceStep } from '../lib/signal'
import type { Capture, Signal } from '../lib/types'
import type { Cursors, Row } from '../rows'

export const ROW_H = 36
export const RULER_H = 28

export interface View {
  /** Time at the left edge of the plot area (ticks). */
  t0: number
  /** Ticks per pixel. */
  scale: number
}

export function labelWidth(w: number): number {
  return w < 600 ? 96 : 176
}

export interface Colors {
  bg: string
  panel: string
  fg: string
  muted: string
  line: string
  grid: string
  gridStrong: string
  accent: string
  cursorB: string
  err: string
  ok: string
  wave: string
  sel: string
}

export function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  return {
    bg: v('--chart-bg'),
    panel: v('--panel'),
    fg: v('--fg'),
    muted: v('--muted'),
    line: v('--line'),
    grid: v('--grid'),
    gridStrong: v('--grid-strong'),
    accent: v('--accent'),
    cursorB: v('--ref-line'),
    err: v('--err'),
    ok: v('--ok'),
    wave: v('--wave'),
    sel: v('--panel2'),
  }
}

const MONO = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const SANS = '12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export function setupCanvas(c: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1
  c.width = Math.max(1, Math.round(w * dpr))
  c.height = Math.max(1, Math.round(h * dpr))
  c.style.width = `${w}px`
  c.style.height = `${h}px`
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

export interface Ticks {
  stepTicks: number
  stepSec: number
  minor: number
  first: number
  count: number
}

export function computeTicks(view: View, plotW: number, timescale: number): Ticks {
  const stepSec = niceStep(90 * view.scale * timescale)
  const stepTicks = stepSec / timescale
  const mant = Math.round(stepSec / Math.pow(10, Math.floor(Math.log10(stepSec) + 1e-9)))
  const first = Math.ceil(view.t0 / stepTicks) * stepTicks
  const count = Math.floor((view.t0 + plotW * view.scale - first) / stepTicks) + 1
  return { stepTicks, stepSec, minor: mant === 2 ? 4 : 5, first, count: Math.max(0, count) }
}

function fade(ctx: CanvasRenderingContext2D, color: string, alpha: number, fn: () => void) {
  const a = ctx.globalAlpha
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  fn()
  ctx.globalAlpha = a
}

export function drawRuler(ctx: CanvasRenderingContext2D, w: number, view: View, cap: Capture, cur: Cursors, col: Colors) {
  const LW = labelWidth(w)
  ctx.fillStyle = col.panel
  ctx.fillRect(0, 0, w, RULER_H)
  ctx.strokeStyle = col.line
  ctx.beginPath()
  ctx.moveTo(0, RULER_H - 0.5)
  ctx.lineTo(w, RULER_H - 0.5)
  ctx.stroke()
  ctx.save()
  ctx.beginPath()
  ctx.rect(LW, 0, w - LW, RULER_H)
  ctx.clip()
  const k = computeTicks(view, w - LW, cap.timescale)
  ctx.font = MONO
  ctx.textBaseline = 'middle'
  ctx.fillStyle = col.muted
  ctx.strokeStyle = col.gridStrong
  for (let i = 0; i < k.count; i++) {
    const t = k.first + i * k.stepTicks
    const x = Math.round(LW + (t - view.t0) / view.scale) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, RULER_H - 9)
    ctx.lineTo(x, RULER_H)
    ctx.stroke()
    ctx.fillText(formatSeconds(t * cap.timescale, k.stepSec), x + 3, 10)
  }
  ctx.strokeStyle = col.grid
  for (let i = -1; i < k.count; i++) {
    for (let m = 1; m < k.minor; m++) {
      const t = k.first + (i + m / k.minor) * k.stepTicks
      const x = Math.round(LW + (t - view.t0) / view.scale) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, RULER_H - 4)
      ctx.lineTo(x, RULER_H)
      ctx.stroke()
    }
  }
  for (const [name, t, color] of [
    ['A', cur.a, col.accent],
    ['B', cur.b, col.cursorB],
  ] as const) {
    if (t === null) continue
    const x = LW + (t - view.t0) / view.scale
    ctx.fillStyle = color
    ctx.fillRect(x - 7, 1, 14, 14)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(name, x, 9)
    ctx.textAlign = 'start'
  }
  ctx.restore()
  ctx.fillStyle = col.panel
  ctx.fillRect(0, 0, LW, RULER_H - 1)
  ctx.fillStyle = col.muted
  ctx.font = SANS
  if (LW >= 150) ctx.fillText(`${formatSeconds(view.scale * cap.timescale * 100)} / 100 px`, 8, RULER_H / 2)
}

function ellipsize(ctx: CanvasRenderingContext2D, s: string, max: number): string {
  if (ctx.measureText(s).width <= max) return s
  let lo = 0
  let hi = s.length
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1
    if (ctx.measureText(s.slice(0, m) + '…').width <= max) lo = m
    else hi = m - 1
  }
  return s.slice(0, lo) + '…'
}

const realRange = new WeakMap<Signal, [number, number]>()
function rangeOf(sig: Signal): [number, number] {
  let r = realRange.get(sig)
  if (!r) {
    let lo = Infinity
    let hi = -Infinity
    for (const v of sig.values) {
      const n = Number(v)
      if (Number.isFinite(n)) {
        if (n < lo) lo = n
        if (n > hi) hi = n
      }
    }
    r = Number.isFinite(lo) ? (hi > lo ? [lo, hi] : [lo - 1, hi + 1]) : [0, 1]
    realRange.set(sig, r)
  }
  return r
}

const KIND_COLOR = (kind: Annotation['kind'], col: Colors) =>
  kind === 'error' ? col.err : kind === 'addr' ? col.ok : kind === 'ctrl' ? col.cursorB : col.accent

export function drawBody(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: View,
  cap: Capture,
  rows: Row[],
  cur: Cursors,
  selected: number | null,
  col: Colors,
) {
  const LW = labelWidth(w)
  const plotW = w - LW
  const tL = view.t0
  const tR = view.t0 + plotW * view.scale
  const xOf = (t: number) => LW + (t - view.t0) / view.scale
  ctx.fillStyle = col.bg
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.beginPath()
  ctx.rect(LW, 0, plotW, h)
  ctx.clip()

  // Vertical grid.
  const k = computeTicks(view, plotW, cap.timescale)
  ctx.strokeStyle = col.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < k.count; i++) {
    const x = Math.round(xOf(k.first + i * k.stepTicks)) + 0.5
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
  }
  ctx.stroke()

  // Region between the cursors.
  if (cur.a !== null && cur.b !== null) {
    fade(ctx, col.accent, 0.08, () => ctx.fillRect(xOf(Math.min(cur.a!, cur.b!)), 0, Math.abs(cur.a! - cur.b!) / view.scale, h))
  }

  // Data beyond the capture.
  const xe = xOf(cap.end)
  const xs = xOf(cap.start)
  fade(ctx, col.muted, 0.12, () => {
    if (xe < w) ctx.fillRect(Math.max(LW, xe), 0, w, h)
    if (xs > LW) ctx.fillRect(LW, 0, xs - LW, h)
  })

  rows.forEach((row, ri) => {
    const top = ri * ROW_H
    ctx.strokeStyle = col.grid
    ctx.beginPath()
    ctx.moveTo(LW, top + ROW_H - 0.5)
    ctx.lineTo(w, top + ROW_H - 0.5)
    ctx.stroke()
    if (row.kind === 'signal') drawSignal(ctx, row.sig, row.radix, top, cap, LW, w, tL, tR, xOf, col)
    else drawTrack(ctx, row.annotations, top, xOf, LW, w, tL, tR, col)
  })

  // Cursors.
  for (const [t, color] of [
    [cur.a, col.accent],
    [cur.b, col.cursorB],
  ] as const) {
    if (t === null) continue
    const x = Math.round(xOf(t)) + 0.5
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  ctx.lineWidth = 1
  ctx.restore()

  // Name column.
  ctx.font = SANS
  ctx.textBaseline = 'middle'
  rows.forEach((row, ri) => {
    const top = ri * ROW_H
    const isSel = row.kind === 'signal' && row.sig.idx === selected
    ctx.fillStyle = isSel ? col.sel : col.panel
    ctx.fillRect(0, top, LW, ROW_H)
    ctx.strokeStyle = col.line
    ctx.beginPath()
    ctx.moveTo(0, top + ROW_H - 0.5)
    ctx.lineTo(LW, top + ROW_H - 0.5)
    ctx.stroke()
    if (isSel) {
      ctx.fillStyle = col.accent
      ctx.fillRect(0, top, 3, ROW_H)
    }
    ctx.fillStyle = row.kind === 'track' ? col.accent : col.fg
    const name = row.kind === 'signal' ? row.sig.name : row.name
    ctx.fillText(ellipsize(ctx, name, LW - 14), 8, top + ROW_H / 2)
  })
  ctx.strokeStyle = col.line
  ctx.beginPath()
  ctx.moveTo(LW - 0.5, 0)
  ctx.lineTo(LW - 0.5, h)
  ctx.stroke()
}

function drawSignal(
  ctx: CanvasRenderingContext2D,
  sig: Signal,
  radix: Parameters<typeof formatValue>[2],
  top: number,
  cap: Capture,
  LW: number,
  w: number,
  tL: number,
  tR: number,
  xOf: (t: number) => number,
  col: Colors,
) {
  const n = sig.times.length
  if (n === 0) return
  const hi = top + 9
  const lo = top + ROW_H - 10
  const mid = (hi + lo) / 2
  const i0 = Math.max(0, indexAt(sig, tL))
  ctx.font = MONO
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'

  if (sig.kind === 'bit') {
    ctx.strokeStyle = col.wave
    ctx.beginPath()
    let penY: number | null = null
    const special: [string, number, number][] = []
    let runX1 = -1
    let runX2 = -1
    const flush = () => {
      if (runX1 >= 0) {
        fade(ctx, col.wave, 0.55, () => ctx.fillRect(runX1, hi, Math.max(1, runX2 - runX1), lo - hi))
        runX1 = -1
      }
    }
    for (let j = i0; j < n; j++) {
      const ts = sig.times[j]
      if (ts > tR) break
      const te = j + 1 < n ? sig.times[j + 1] : cap.end
      const x1 = xOf(ts)
      const x2 = xOf(Math.max(te, ts))
      if (x2 < LW) continue
      if (x2 - x1 < 1) {
        if (runX1 < 0) runX1 = x1
        runX2 = x2
        penY = null
        continue
      }
      flush()
      const v = sig.values[j]
      if (v === '0' || v === '1') {
        const y = v === '1' ? hi : lo
        if (penY === null) ctx.moveTo(x1, y)
        else ctx.lineTo(x1, y)
        ctx.lineTo(x2, y)
        penY = y
      } else {
        penY = null
        special.push([v, x1, x2])
      }
    }
    flush()
    ctx.stroke()
    for (const [v, x1, x2] of special) {
      const color = v === 'x' ? col.err : col.muted
      if (v === 'x') fade(ctx, color, 0.25, () => ctx.fillRect(x1, hi, x2 - x1, lo - hi))
      ctx.save()
      ctx.strokeStyle = color
      ctx.beginPath()
      if (v === 'x') {
        ctx.moveTo(x1, hi)
        ctx.lineTo(x2, hi)
        ctx.moveTo(x1, lo)
        ctx.lineTo(x2, lo)
      } else {
        ctx.setLineDash([4, 3])
        ctx.moveTo(x1, mid)
        ctx.lineTo(x2, mid)
      }
      ctx.stroke()
      ctx.restore()
    }
  } else if (sig.kind === 'bus') {
    let runX1 = -1
    let runX2 = -1
    const flush = () => {
      if (runX1 >= 0) {
        fade(ctx, col.wave, 0.5, () => ctx.fillRect(runX1, hi, Math.max(1, runX2 - runX1), lo - hi))
        runX1 = -1
      }
    }
    for (let j = i0; j < n; j++) {
      const ts = sig.times[j]
      if (ts > tR) break
      const te = j + 1 < n ? sig.times[j + 1] : cap.end
      const x1 = xOf(ts)
      const x2 = xOf(Math.max(te, ts))
      if (x2 < LW) continue
      if (x2 - x1 < 3) {
        if (runX1 < 0) runX1 = x1
        runX2 = x2
        continue
      }
      flush()
      const v = sig.values[j]
      const allZ = /^z+$/.test(v)
      const hasX = v.includes('x')
      const color = hasX ? col.err : allZ ? col.muted : col.wave
      if (allZ) {
        ctx.strokeStyle = color
        ctx.beginPath()
        ctx.moveTo(x1, mid)
        ctx.lineTo(x2, mid)
        ctx.stroke()
        continue
      }
      const s = Math.min(4, (x2 - x1) / 3)
      ctx.beginPath()
      ctx.moveTo(x1, mid)
      ctx.lineTo(x1 + s, hi)
      ctx.lineTo(x2 - s, hi)
      ctx.lineTo(x2, mid)
      ctx.lineTo(x2 - s, lo)
      ctx.lineTo(x1 + s, lo)
      ctx.closePath()
      fade(ctx, color, 0.14, () => ctx.fill())
      ctx.strokeStyle = color
      ctx.stroke()
      const text = formatValue(sig, v, radix)
      const vis1 = Math.max(x1, LW)
      const vis2 = Math.min(x2, w)
      ctx.fillStyle = col.fg
      if (ctx.measureText(text).width + 12 < vis2 - vis1) {
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, (vis1 + vis2) / 2, mid + 0.5)
        ctx.textAlign = 'start'
      }
    }
    flush()
  } else {
    const [vmin, vmax] = rangeOf(sig)
    const yOf = (v: number) => lo - ((v - vmin) / (vmax - vmin)) * (lo - hi)
    ctx.strokeStyle = col.wave
    ctx.beginPath()
    let started = false
    let lastX = -Infinity
    for (let j = i0; j < n; j++) {
      const ts = sig.times[j]
      if (ts > tR) break
      const te = j + 1 < n ? sig.times[j + 1] : cap.end
      const x1 = xOf(ts)
      const x2 = xOf(Math.max(te, ts))
      if (x2 < LW) continue
      const y = yOf(Number(sig.values[j]))
      if (x1 - lastX < 0.5 && started) {
        ctx.lineTo(x1, y)
        continue
      }
      if (!started) ctx.moveTo(x1, y)
      else ctx.lineTo(x1, y)
      started = true
      ctx.lineTo(x2, y)
      lastX = x1
    }
    ctx.stroke()
    ctx.fillStyle = col.muted
    ctx.textAlign = 'start'
    ctx.fillText(String(Number(vmax.toPrecision(3))), LW + 4, hi + 2)
    ctx.fillText(String(Number(vmin.toPrecision(3))), LW + 4, lo - 1)
  }
  ctx.lineWidth = 1
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  anns: Annotation[],
  top: number,
  xOf: (t: number) => number,
  LW: number,
  w: number,
  tL: number,
  tR: number,
  col: Colors,
) {
  ctx.font = MONO
  const y1 = top + 6
  const h = ROW_H - 12
  for (const a of anns) {
    if (a.start > tR) break
    if (a.end < tL) continue
    let x1 = xOf(a.start)
    let x2 = xOf(a.end)
    if (x2 - x1 < 14) {
      const c = (x1 + x2) / 2
      x1 = c - 7
      x2 = c + 7
    }
    if (x2 < LW || x1 > w) continue
    const color = KIND_COLOR(a.kind, col)
    ctx.beginPath()
    ctx.roundRect(x1 + 0.5, y1, Math.max(2, x2 - x1 - 1), h, 4)
    fade(ctx, color, 0.22, () => ctx.fill())
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.stroke()
    const tw = ctx.measureText(a.text).width
    const v1 = Math.max(x1, LW)
    const v2 = Math.min(x2, w)
    if (tw + 6 <= v2 - v1) {
      ctx.fillStyle = col.fg
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(a.text, (v1 + v2) / 2, y1 + h / 2 + 0.5)
      ctx.textAlign = 'start'
    }
  }
}
