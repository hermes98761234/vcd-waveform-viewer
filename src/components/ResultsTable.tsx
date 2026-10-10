import type { T } from '../i18n'
import type { Annotation } from '../lib/decoders'
import { formatSeconds } from '../lib/signal'
import { annotationsCsv, flatten } from '../lib/export'
import type { Row } from '../rows'

interface Props {
  rows: Row[]
  timescale: number
  t: T
  onPick: (a: Annotation) => void
}

const LIMIT = 1500

export default function ResultsTable({ rows, timescale, t, onPick }: Props) {
  const list = flatten(rows)
  if (list.length === 0) return null
  const download = () => {
    const url = URL.createObjectURL(new Blob([annotationsCsv(list, timescale)], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'decoded.csv'
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="box">
      <div className="row">
        <h3 className="grow">{t('Decoded data')}</h3>
        <span className="hint">{t('{0} items', list.length)}</span>
        <button className="small" onClick={download}>
          {t('Export CSV')}
        </button>
      </div>
      <div className="results">
        <table className="data">
          <tbody>
            {list.slice(0, LIMIT).map((r, i) => (
              <tr key={i} className={r.ann.kind === 'error' ? 'bad' : ''}>
                <td>
                  <button className="link" onClick={() => onPick(r.ann)}>
                    {formatSeconds(r.ann.start * timescale)}
                  </button>
                </td>
                <td>{r.track}</td>
                <td className="mono">{r.ann.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > LIMIT && <p className="hint">{t('Showing the first {0} items.', LIMIT)}</p>}
      </div>
    </div>
  )
}
