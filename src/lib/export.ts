import type { Annotation } from './decoders'
import type { Row } from '../rows'

export interface FlatAnn {
  track: string
  ann: Annotation
}

export function flatten(rows: Row[]): FlatAnn[] {
  const out: FlatAnn[] = []
  for (const r of rows) if (r.kind === 'track') for (const ann of r.annotations) out.push({ track: r.name, ann })
  return out.sort((a, b) => a.ann.start - b.ann.start)
}

export function annotationsCsv(list: FlatAnn[], timescale: number): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = ['start_s,end_s,decoder,text,detail']
  for (const { track, ann } of list) lines.push([ann.start * timescale, ann.end * timescale, track, ann.text, ann.detail].map((x) => esc(String(x))).join(','))
  return lines.join('\n') + '\n'
}
