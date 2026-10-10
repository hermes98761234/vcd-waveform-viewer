import { useState } from 'react'
import type { T } from '../i18n'
import { edgeMatcher, findChange, formatSeconds, valueMatcher, type EdgeKind, type Radix } from '../lib/signal'
import type { Capture } from '../lib/types'
import type { Cursors } from '../rows'

type Mode = EdgeKind | 'value'

interface Props {
  cap: Capture
  selected: number | null
  radix: Radix
  cursors: Cursors
  t: T
  onJump: (t: number) => void
}

export default function FindPanel({ cap, selected, radix, cursors, t, onJump }: Props) {
  const [mode, setMode] = useState<Mode>('rising')
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const sig = selected === null ? null : cap.signals[selected]
  const from = cursors.a ?? cap.start - 1

  const go = (dir: 1 | -1) => {
    if (!sig) return
    let match
    if (mode === 'value') {
      match = valueMatcher(sig, text, radix)
      if (!match) {
        setMsg(t('Enter a value such as 0x1F, 0b101 or 31.'))
        return
      }
    } else match = edgeMatcher(mode)
    const at = findChange(sig, from, dir, match)
    if (at === null) setMsg(dir === 1 ? t('No later match.') : t('No earlier match.'))
    else {
      setMsg(t('Found at {0}', formatSeconds(at * cap.timescale)))
      onJump(at)
    }
  }

  return (
    <div className="section">
      <h3>{t('Find')}</h3>
      {!sig ? (
        <p className="hint">{t('Select a signal (click its name) to search its edges or values.')}</p>
      ) : (
        <>
          <p className="hint">
            {t('Searching')} <b>{sig.name}</b> {t('from cursor A')}
          </p>
          <div className="row">
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label={t('Search for')}>
              <option value="rising">{t('Rising edge')}</option>
              <option value="falling">{t('Falling edge')}</option>
              <option value="any">{t('Any change')}</option>
              <option value="value">{t('Value equals')}</option>
            </select>
            {mode === 'value' && <input className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="0x1F" aria-label={t('Value')} onKeyDown={(e) => e.key === 'Enter' && go(1)} />}
          </div>
          <div className="row">
            <button onClick={() => go(-1)}>◀ {t('Previous')}</button>
            <button onClick={() => go(1)}>{t('Next')} ▶</button>
          </div>
          {msg && <p className="hint" role="status">{msg}</p>}
        </>
      )}
    </div>
  )
}
