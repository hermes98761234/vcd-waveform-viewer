import { useMemo, useState } from 'react'
import { RADIX_LABEL, type T } from '../i18n'
import { formatValue, RADIXES, valueAt, type Radix } from '../lib/signal'
import type { Capture } from '../lib/types'
import type { Cursors } from '../rows'

interface Props {
  cap: Capture
  order: number[]
  hidden: Set<number>
  radix: Record<number, Radix>
  defaultRadix: Radix
  cursors: Cursors
  selected: number | null
  t: T
  onSelect: (idx: number) => void
  onToggle: (idx: number) => void
  onMove: (idx: number, dir: -1 | 1) => void
  onRadix: (idx: number, r: Radix) => void
  onShowAll: (show: boolean) => void
}

export default function SignalList({ cap, order, hidden, radix, defaultRadix, cursors, selected, t, onSelect, onToggle, onMove, onRadix, onShowAll }: Props) {
  const [filter, setFilter] = useState('')
  const q = filter.trim().toLowerCase()
  const shown = useMemo(
    () => order.filter((i) => !q || `${cap.signals[i].scope}.${cap.signals[i].name}`.toLowerCase().includes(q)),
    [order, cap, q],
  )
  const val = (i: number, at: number | null) => {
    if (at === null) return ''
    const s = cap.signals[i]
    return formatValue(s, valueAt(s, at), radix[i] ?? defaultRadix)
  }
  return (
    <div className="section">
      <h3>{t('Signals')}</h3>
      <div className="row">
        <input type="search" className="grow" value={filter} placeholder={t('Filter signals')} aria-label={t('Filter signals')} onChange={(e) => setFilter(e.target.value)} />
        <button className="small" onClick={() => onShowAll(true)}>
          {t('All')}
        </button>
        <button className="small" onClick={() => onShowAll(false)}>
          {t('None')}
        </button>
      </div>
      <div className="siglist" role="list">
        {shown.map((i) => {
          const s = cap.signals[i]
          const pos = order.indexOf(i)
          return (
            <div key={i} role="listitem" className={`sig${selected === i ? ' sel' : ''}`}>
              <input type="checkbox" checked={!hidden.has(i)} onChange={() => onToggle(i)} aria-label={t('Show {0}', s.name)} />
              <button className="link signame" onClick={() => onSelect(i)} title={s.scope ? `${s.scope}.${s.name}` : s.name}>
                {s.name}
                {s.kind === 'bus' ? <span className="muted"> [{s.width}]</span> : null}
              </button>
              {s.kind === 'bus' ? (
                <select value={radix[i] ?? defaultRadix} onChange={(e) => onRadix(i, e.target.value as Radix)} aria-label={t('Radix of {0}', s.name)}>
                  {RADIXES.map((r) => (
                    <option key={r} value={r}>
                      {t(RADIX_LABEL[r])}
                    </option>
                  ))}
                </select>
              ) : (
                <span />
              )}
              <span className="v a">{val(i, cursors.a)}</span>
              <span className="v b">{val(i, cursors.b)}</span>
              <span className="mv">
                <button className="small" disabled={pos <= 0 || !!q} onClick={() => onMove(i, -1)} aria-label={t('Move up')}>
                  ↑
                </button>
                <button className="small" disabled={pos >= order.length - 1 || !!q} onClick={() => onMove(i, 1)} aria-label={t('Move down')}>
                  ↓
                </button>
              </span>
            </div>
          )
        })}
        {shown.length === 0 && <p className="hint">{t('No matching signals.')}</p>}
      </div>
    </div>
  )
}
