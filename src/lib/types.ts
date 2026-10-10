export type SignalKind = 'bit' | 'bus' | 'real'

/**
 * One traced signal as a list of value changes. `times` are integer ticks (see Capture.timescale).
 * Values: bits are '0' '1' 'x' 'z'; buses are MSB-first binary strings of exactly `width` characters;
 * reals are number strings.
 */
export interface Signal {
  idx: number
  id: string
  name: string
  scope: string
  width: number
  kind: SignalKind
  times: number[]
  values: string[]
}

export interface Capture {
  name: string
  /** Seconds per tick. */
  timescale: number
  start: number
  end: number
  signals: Signal[]
}

export type Lang = 'en' | 'uk'
