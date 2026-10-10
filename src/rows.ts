import type { Annotation } from './lib/decoders'
import type { Radix } from './lib/signal'
import type { Signal } from './lib/types'

export type Row =
  | { kind: 'signal'; key: string; sig: Signal; radix: Radix }
  | { kind: 'track'; key: string; name: string; annotations: Annotation[] }

export interface Cursors {
  a: number | null
  b: number | null
}

/** Ask the waveform view to bring a time into view; `span` also zooms so that many ticks fill about a third. */
export interface Reveal {
  t: number
  span?: number
  n: number
}
