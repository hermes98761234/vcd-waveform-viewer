import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { T } from '../i18n'
import { formatSeconds, formatValue, valueAt } from '../lib/signal'
import type { Capture } from '../lib/types'
import type { Cursors, Reveal, Row } from '../rows'
import { drawBody, drawRuler, labelWidth, readColors, RULER_H, ROW_H, setupCanvas, type View } from './draw'

interface Props {
  cap: Capture
  rows: Row[]
  cursors: Cursors
  selected: number | null
  reveal: Reveal | null
  themeKey: string
  t: T
  onCursor: (which: 'a' | 'b', t: number) => void
  onSelect: (idx: number) => void
}

export default function Waveform({ cap, rows, cursors, selected, reveal, themeKey, t, onCursor, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLCanvasElement>(null)
  const bodyRef = useRef<HTMLCanvasElement>(null)
  const [w, setW] = useState(0)
  const [view, setView] = useState<View>({ t0: cap.start, scale: 1 })
  const [place, setPlace] = useState<'a' | 'b'>('a')
  const [hover, setHover] = useState<{ t: number; row: number } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const wRef = useRef(w)
  wRef.current = w
  const fitted = useRef<Capture | null>(null)

  const plotW = Math.max(1, w - labelWidth(w))
  const span = Math.max(1, cap.end - cap.start)
  const minScale = 1 / 64
  const maxScale = (span * 4) / plotW

  const clampView = useCallback(
    (v: View): View => {
      const pw = Math.max(1, wRef.current - labelWidth(wRef.current))
      const sc = Math.min(Math.max(v.scale, 1 / 64), (span * 4) / pw)
      const width = pw * sc
      return { scale: sc, t0: Math.min(Math.max(v.t0, cap.start - width / 2), cap.end - width / 2) }
    },
    [cap, span],
  )

  const fit = useCallback(() => {
    const pw = Math.max(1, wRef.current - labelWidth(wRef.current))
    const sc = (span * 1.04) / pw
    setView({ t0: cap.start - span * 0.02, scale: sc })
  }, [cap, span])

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => setW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (w > 0 && fitted.current !== cap) {
      fitted.current = cap
      fit()
    }
  }, [w, cap, fit])

  const zoomAt = useCallback(
    (factor: number, x: number) => {
      const v = viewRef.current
      const LW = labelWidth(wRef.current)
      const tAt = v.t0 + (x - LW) * v.scale
      const sc = Math.min(Math.max(v.scale * factor, 1 / 64), (span * 4) / Math.max(1, wRef.current - LW))
      setView(clampView({ scale: sc, t0: tAt - (x - LW) * sc }))
    },
    [clampView, span],
  )
  const zoomCenter = (factor: number) => zoomAt(factor, labelWidth(w) + plotW / 2)

  // Bring a requested time into view.
  useEffect(() => {
    if (!reveal) return
    const v = viewRef.current
    const pw = Math.max(1, wRef.current - labelWidth(wRef.current))
    if (reveal.span !== undefined) {
      const sc = Math.min(Math.max((Math.max(reveal.span, 4) * 3) / pw, 1 / 64), (span * 4) / pw)
      setView(clampView({ scale: sc, t0: reveal.t + reveal.span / 2 - (pw * sc) / 2 }))
    } else if (reveal.t < v.t0 || reveal.t > v.t0 + pw * v.scale) {
      setView(clampView({ ...v, t0: reveal.t - (pw * v.scale) / 2 }))
    }
    // Only a new request (n) should move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.n])

  const bodyH = Math.max(ROW_H, rows.length * ROW_H)

  useEffect(() => {
    if (w <= 0) return
    const col = readColors()
    const rc = rulerRef.current
    const bc = bodyRef.current
    if (!rc || !bc) return
    const rctx = setupCanvas(rc, w, RULER_H)
    const bctx = setupCanvas(bc, w, bodyH)
    if (!rctx || !bctx) return
    drawRuler(rctx, w, view, cap, cursors, col)
    drawBody(bctx, w, bodyH, view, cap, rows, cursors, selected, col)
    document.body.dataset.ready = '1'
  }, [view, w, cap, rows, cursors, selected, themeKey, bodyH])

  // Wheel: zoom around the pointer; shift or horizontal wheel pans. Needs a non-passive listener.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const dx = e.shiftKey ? e.deltaY : e.deltaX
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const v = viewRef.current
        setView(clampView({ ...v, t0: v.t0 + dx * v.scale }))
      } else {
        zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX - rect.left)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [clampView, zoomAt])

  const ptrs = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<{ sx: number; sy: number; t0: number; moved: boolean } | null>(null)
  const pinch = useRef<{ d0: number; scale0: number; tMid: number; xMid: number } | null>(null)

  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect()
    const b = bodyRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - b.top, inRuler: e.clientY < b.top }
  }
  const timeAt = (x: number) => viewRef.current.t0 + (x - labelWidth(wRef.current)) * viewRef.current.scale

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    try {
      wrap.current!.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic or already-released pointer: dragging still works without capture */
    }
    const p = local(e)
    ptrs.current.set(e.pointerId, { x: p.x, y: p.y })
    if (ptrs.current.size === 1) {
      drag.current = { sx: p.x, sy: p.y, t0: viewRef.current.t0, moved: false }
    } else if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()]
      const xMid = (a.x + b.x) / 2
      pinch.current = { d0: Math.max(10, Math.abs(a.x - b.x)), scale0: viewRef.current.scale, tMid: timeAt(xMid), xMid }
      if (drag.current) drag.current.moved = true
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e)
    if (!ptrs.current.has(e.pointerId)) {
      const row = Math.floor(p.y / ROW_H)
      setHover(p.x >= labelWidth(wRef.current) && row >= 0 && row < rows.length ? { t: timeAt(p.x), row } : null)
      return
    }
    ptrs.current.set(e.pointerId, { x: p.x, y: p.y })
    if (pinch.current && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()]
      const d = Math.max(10, Math.abs(a.x - b.x))
      const pc = pinch.current
      const LW = labelWidth(wRef.current)
      const xMid = (a.x + b.x) / 2
      const sc = pc.scale0 * (pc.d0 / d)
      setView(clampView({ scale: sc, t0: pc.tMid - (xMid - LW) * Math.min(Math.max(sc, minScale), maxScale) }))
      return
    }
    const d = drag.current
    if (!d) return
    const dx = p.x - d.sx
    if (!d.moved && Math.abs(dx) > 4) d.moved = true
    if (d.moved) setView(clampView({ ...viewRef.current, t0: d.t0 - dx * viewRef.current.scale }))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const wasSingle = ptrs.current.size === 1
    ptrs.current.delete(e.pointerId)
    if (ptrs.current.size < 2) pinch.current = null
    const d = drag.current
    if (ptrs.current.size === 0) drag.current = null
    if (!d || d.moved || !wasSingle) return
    const p = local(e)
    const LW = labelWidth(wRef.current)
    if (p.x < LW && !p.inRuler) {
      const row = rows[Math.floor(p.y / ROW_H)]
      if (row?.kind === 'signal') onSelect(row.sig.idx)
      return
    }
    if (p.x < LW) return
    const which = e.shiftKey || place === 'b' ? 'b' : 'a'
    onCursor(which, Math.round(timeAt(p.x)))
    if (!p.inRuler) {
      const row = rows[Math.floor(p.y / ROW_H)]
      if (row?.kind === 'signal') onSelect(row.sig.idx)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = viewRef.current
    if (e.key === '+' || e.key === '=') zoomCenter(0.5)
    else if (e.key === '-' || e.key === '_') zoomCenter(2)
    else if (e.key === 'f' || e.key === '0') fit()
    else if (e.key === 'ArrowLeft') setView(clampView({ ...v, t0: v.t0 - plotW * v.scale * 0.2 }))
    else if (e.key === 'ArrowRight') setView(clampView({ ...v, t0: v.t0 + plotW * v.scale * 0.2 }))
    else return
    e.preventDefault()
  }

  const zoomToCursors = () => {
    if (cursors.a === null || cursors.b === null) return
    const lo = Math.min(cursors.a, cursors.b)
    const hi = Math.max(cursors.a, cursors.b)
    const pw = plotW
    const sc = Math.max(((hi - lo) * 1.1) / pw, minScale)
    setView(clampView({ scale: sc, t0: lo - (hi - lo) * 0.05 }))
  }

  const hoverRow = hover ? rows[hover.row] : undefined
  let hoverText = ''
  if (hover && hoverRow) {
    hoverText = formatSeconds(hover.t * cap.timescale)
    if (hoverRow.kind === 'signal') hoverText += `  ${hoverRow.sig.name} = ${formatValue(hoverRow.sig, valueAt(hoverRow.sig, hover.t), hoverRow.radix)}`
    else {
      const a = hoverRow.annotations.find((x) => hover.t >= x.start && hover.t <= Math.max(x.end, x.start + view.scale * 7))
      if (a) hoverText += `  ${a.detail}`
    }
  }

  return (
    <div className="wave">
      <div className="row wave-bar">
        <button className="small" onClick={() => zoomCenter(0.5)} title={t('Zoom in (+)')} aria-label={t('Zoom in (+)')}>
          +
        </button>
        <button className="small" onClick={() => zoomCenter(2)} title={t('Zoom out (-)')} aria-label={t('Zoom out (-)')}>
          −
        </button>
        <button className="small" onClick={fit} title={t('Fit all (F)')}>
          {t('Fit')}
        </button>
        <button className="small" onClick={zoomToCursors} disabled={cursors.a === null || cursors.b === null}>
          {t('Zoom to A–B')}
        </button>
        <span className="seg" role="group" aria-label={t('Click places cursor')}>
          <button className={`small${place === 'a' ? ' on' : ''}`} onClick={() => setPlace('a')} aria-pressed={place === 'a'}>
            A
          </button>
          <button className={`small${place === 'b' ? ' on' : ''}`} onClick={() => setPlace('b')} aria-pressed={place === 'b'}>
            B
          </button>
        </span>
        <span className="hint wave-hover" aria-live="off">
          {hoverText || t('Scroll to zoom, drag to pan, click to place a cursor (Shift+click for B).')}
        </span>
      </div>
      <div
        className="wave-wrap"
        ref={wrap}
        tabIndex={0}
        role="img"
        aria-label={t('Waveform display')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onContextMenu={(e) => {
          e.preventDefault()
          const p = local(e)
          if (p.x >= labelWidth(wRef.current)) onCursor('b', Math.round(timeAt(p.x)))
        }}
        onKeyDown={onKeyDown}
      >
        <canvas ref={rulerRef} className="wave-ruler" />
        <canvas ref={bodyRef} className="wave-body" />
      </div>
    </div>
  )
}
