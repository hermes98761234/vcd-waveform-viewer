import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DecoderPanel from './components/DecoderPanel'
import FindPanel from './components/FindPanel'
import ResultsTable from './components/ResultsTable'
import SignalList from './components/SignalList'
import Waveform from './components/Waveform'
import { RADIX_LABEL, tr, type T } from './i18n'
import { runDecoder, type Annotation, type DecoderConfig } from './lib/decoders'
import { parseCapture } from './lib/load'
import { SAMPLE_IDS, SAMPLE_NAMES, sampleDecoders, sampleVcd, type SampleId } from './lib/samples'
import { formatFreq, formatSeconds, measureBit, RADIXES, type Radix } from './lib/signal'
import type { Capture } from './lib/types'
import { parseVcd, writeVcd } from './lib/vcd'
import type { ParseResponse } from './parse.worker'
import type { Cursors, Reveal, Row } from './rows'
import { loadSettings, saveSettings, type Settings } from './settings'

const FIRST: SampleId = 'i2c'

function initial() {
  const cap = parseVcd(sampleVcd(FIRST), `${FIRST}.vcd`)
  return { cap, decoders: sampleDecoders(FIRST, cap) }
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [init] = useState(initial)
  const [cap, setCap] = useState<Capture>(init.cap)
  const [decoders, setDecoders] = useState<DecoderConfig[]>(init.decoders)
  const [sampleId, setSampleId] = useState<SampleId | ''>(FIRST)
  const [order, setOrder] = useState<number[]>(() => init.cap.signals.map((s) => s.idx))
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [radix, setRadix] = useState<Record<number, Radix>>({})
  const [cursors, setCursors] = useState<Cursors>({ a: null, b: null })
  const [selected, setSelected] = useState<number | null>(null)
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [themeTick, setThemeTick] = useState(0)
  const [dropping, setDropping] = useState(false)
  const lastFile = useRef<File | null>(null)
  const [fileName, setFileName] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const revealN = useRef(0)
  const t: T = useCallback((s, ...a) => tr(settings.lang, s, ...a), [settings.lang])

  useEffect(() => saveSettings(settings), [settings])
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'auto') delete root.dataset.theme
    else root.dataset.theme = settings.theme
    root.lang = settings.lang
    document.title = tr(settings.lang, 'VCD Waveform Viewer: logic analyzer in your browser')
  }, [settings.theme, settings.lang])
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const f = () => setThemeTick((n) => n + 1)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])

  const install = useCallback((c: Capture, decs: DecoderConfig[]) => {
    setCap(c)
    setDecoders(decs)
    setOrder(c.signals.map((s) => s.idx))
    setHidden(new Set())
    setRadix({})
    setCursors({ a: null, b: null })
    setSelected(null)
    setReveal(null)
    setError('')
  }, [])

  const loadSample = (id: SampleId | '') => {
    setSampleId(id)
    if (!id) return
    const c = parseVcd(sampleVcd(id), `${id}.vcd`)
    install(c, sampleDecoders(id, c))
  }

  const loadFile = useCallback(
    (file: File, sampleRate: number) => {
      lastFile.current = file
      setFileName(file.name)
      setLoading(true)
      setError('')
      const done = (res: ParseResponse) => {
        setLoading(false)
        if ('error' in res) setError(res.error)
        else {
          setSampleId('')
          install(res.cap, [])
        }
      }
      let worker: Worker | null = null
      try {
        worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' })
      } catch {
        worker = null
      }
      if (worker) {
        const w = worker
        w.onmessage = (e: MessageEvent<ParseResponse>) => {
          w.terminate()
          done(e.data)
        }
        w.onerror = () => {
          w.terminate()
          done({ error: 'The parser failed to start.' })
        }
        w.postMessage({ file, sampleRate })
      } else {
        file
          .text()
          .then((text) => done({ cap: parseCapture(text, file.name, { sampleRate }) }))
          .catch((err: unknown) => done({ error: err instanceof Error ? err.message : String(err) }))
      }
    },
    [install],
  )

  // Drag and drop a file anywhere on the page.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        setDropping(true)
      }
    }
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDropping(false)
    }
    const drop = (e: DragEvent) => {
      const f = e.dataTransfer?.files[0]
      setDropping(false)
      if (f) {
        e.preventDefault()
        loadFile(f, settings.sampleRate)
      }
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [loadFile, settings.sampleRate])

  const tracks = useMemo(() => decoders.flatMap((d) => runDecoder(cap, d).map((tk, i) => ({ key: `${d.id}:${i}`, name: tk.name, annotations: tk.annotations }))), [cap, decoders])

  const rows: Row[] = useMemo(() => {
    const sigs: Row[] = order
      .filter((i) => !hidden.has(i))
      .map((i) => ({ kind: 'signal', key: String(i), sig: cap.signals[i], radix: radix[i] ?? settings.radix }))
    return [...sigs, ...tracks.map((tk): Row => ({ kind: 'track', ...tk }))]
  }, [order, hidden, cap, radix, settings.radix, tracks])

  const requestReveal = (time: number, span?: number) => setReveal({ t: time, span, n: ++revealN.current })

  const setCursor = useCallback((which: 'a' | 'b', time: number) => setCursors((c) => ({ ...c, [which]: time })), [])

  const jump = (time: number) => {
    setCursors((c) => ({ ...c, a: time }))
    requestReveal(time)
  }
  const pick = (a: Annotation) => {
    setCursors({ a: a.start, b: a.end > a.start ? a.end : null })
    requestReveal(a.start, a.end > a.start ? a.end - a.start : undefined)
  }

  const move = (idx: number, dir: -1 | 1) =>
    setOrder((o) => {
      const p = o.indexOf(idx)
      const q = p + dir
      if (q < 0 || q >= o.length) return o
      const n = o.slice()
      ;[n[p], n[q]] = [n[q], n[p]]
      return n
    })

  const sel = selected === null ? null : cap.signals[selected]
  const dt = cursors.a !== null && cursors.b !== null ? Math.abs(cursors.b - cursors.a) : null
  const bitM = sel && sel.kind === 'bit' && cursors.a !== null && cursors.b !== null ? measureBit(sel, cursors.a, cursors.b) : null
  const secs = (ticks: number) => formatSeconds(ticks * cap.timescale)
  const upd = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }))

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">{t('VCD Waveform Viewer')}</span>
        <span className="hint grow">{t('Logic analyzer captures in your browser: VCD and CSV, cursors, UART / SPI / I2C decoding.')}</span>
        <label className="inline">
          {t('Language')}{' '}
          <select value={settings.lang} onChange={(e) => upd({ lang: e.target.value as Settings['lang'] })}>
            <option value="en">English</option>
            <option value="uk">Українська</option>
          </select>
        </label>
        <label className="inline">
          {t('Theme')}{' '}
          <select value={settings.theme} onChange={(e) => upd({ theme: e.target.value as Settings['theme'] })}>
            <option value="auto">{t('System')}</option>
            <option value="light">{t('Light')}</option>
            <option value="dark">{t('Dark')}</option>
          </select>
        </label>
      </header>
      <div className="body">
        <aside className="side">
          <div className="panel">
            <div className="section">
              <h3>{t('Capture')}</h3>
              <div className="row">
                <button className="primary" onClick={() => fileInput.current?.click()} disabled={loading}>
                  {loading ? t('Loading…') : t('Open file…')}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  accept=".vcd,.csv,.tsv,.txt,text/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) loadFile(f, settings.sampleRate)
                    e.target.value = ''
                  }}
                />
                <span className="hint">{t('or drop a .vcd / .csv file here')}</span>
              </div>
              <div className="field">
                <label>{t('Sample capture')}</label>
                <select value={sampleId} onChange={(e) => loadSample(e.target.value as SampleId | '')}>
                  {sampleId === '' && <option value="">{fileName}</option>}
                  {SAMPLE_IDS.map((id) => (
                    <option key={id} value={id}>
                      {t(SAMPLE_NAMES[id])}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <button className="small" onClick={() => download(`${cap.name.replace(/\.[^.]*$/, '')}.vcd`, writeVcd(cap), 'text/plain')}>
                  {t('Save as .vcd')}
                </button>
              </div>
              <div className="field">
                <label>{t('CSV sample rate (Hz), used when there is no time column')}</label>
                <input
                  type="number"
                  min={1}
                  value={settings.sampleRate}
                  onChange={(e) => Number.isFinite(e.target.valueAsNumber) && e.target.valueAsNumber > 0 && upd({ sampleRate: e.target.valueAsNumber })}
                  onBlur={() => lastFile.current && /\.(csv|tsv|txt)$/i.test(lastFile.current.name) && loadFile(lastFile.current, settings.sampleRate)}
                />
              </div>
              {error && (
                <p className="err-text" role="alert">
                  {t('Error: {0}', t(error))}
                </p>
              )}
              <p className="hint">
                {cap.name}: {t('{0} signals', cap.signals.length)}, {secs(cap.end - cap.start)}, {t('timescale')} {formatSeconds(cap.timescale)}
              </p>
              <div className="field">
                <label>{t('Default bus radix')}</label>
                <select value={settings.radix} onChange={(e) => upd({ radix: e.target.value as Radix })}>
                  {RADIXES.map((r) => (
                    <option key={r} value={r}>
                      {t(RADIX_LABEL[r])}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <SignalList
              cap={cap}
              order={order}
              hidden={hidden}
              radix={radix}
              defaultRadix={settings.radix}
              cursors={cursors}
              selected={selected}
              t={t}
              onSelect={setSelected}
              onToggle={(i) =>
                setHidden((h) => {
                  const n = new Set(h)
                  if (n.has(i)) n.delete(i)
                  else n.add(i)
                  return n
                })
              }
              onMove={move}
              onRadix={(i, r) => setRadix((m) => ({ ...m, [i]: r }))}
              onShowAll={(show) => setHidden(show ? new Set() : new Set(cap.signals.map((s) => s.idx)))}
            />
            <FindPanel cap={cap} selected={selected} radix={selected === null ? settings.radix : (radix[selected] ?? settings.radix)} cursors={cursors} t={t} onJump={jump} />
            <DecoderPanel cap={cap} decoders={decoders} t={t} onChange={setDecoders} />
          </div>
        </aside>
        <main className="main">
          <div className="box">
            <Waveform cap={cap} rows={rows} cursors={cursors} selected={selected} reveal={reveal} themeKey={`${settings.theme}:${themeTick}`} t={t} onCursor={setCursor} onSelect={setSelected} />
          </div>
          <div className="box meas">
            <h3>{t('Cursors')}</h3>
            <dl className="cursor-grid">
              <dt>
                <span className="dot a" /> A
              </dt>
              <dd>{cursors.a === null ? '–' : secs(cursors.a)}</dd>
              <dt>
                <span className="dot b" /> B
              </dt>
              <dd>{cursors.b === null ? '–' : secs(cursors.b)}</dd>
              <dt>Δt</dt>
              <dd>{dt === null ? '–' : secs(dt)}</dd>
              <dt>1/Δt</dt>
              <dd>{dt === null || dt === 0 ? '–' : formatFreq(1 / (dt * cap.timescale))}</dd>
            </dl>
            {bitM && sel && (
              <p className="measure-line">
                <b>{sel.name}</b>: {t('{0} rising, {1} falling edges', bitM.rising, bitM.falling)}
                {bitM.periodTicks ? `, ${t('period')} ${secs(bitM.periodTicks)} (${formatFreq(1 / (bitM.periodTicks * cap.timescale))})` : ''}
                {bitM.high + bitM.low > 0 ? `, ${t('duty')} ${((100 * bitM.high) / (bitM.high + bitM.low)).toFixed(1)}%` : ''}
              </p>
            )}
            {cursors.a === null && <p className="hint">{t('Click the waveform to place cursor A; Shift+click or right-click for B.')}</p>}
          </div>
          <ResultsTable rows={rows} timescale={cap.timescale} t={t} onPick={pick} />
        </main>
      </div>
      <p className="hint foot">
        {t('Everything runs in your browser; files are never uploaded.')}{' '}
        <a href="https://github.com/hermes98761234/vcd-waveform-viewer">{t('Source on GitHub')}</a>
      </p>
      {dropping && <div className="dropzone">{t('Drop the file to open it')}</div>}
    </div>
  )
}
