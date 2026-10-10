import { parseCsv, type CsvOptions } from './csv'
import type { Capture } from './types'
import { parseVcd } from './vcd'

/** Picks the parser from the content: VCD declares variables with $var, anything else is tried as CSV. */
export function parseCapture(text: string, name: string, opts: CsvOptions = {}): Capture {
  if (/\$(var|enddefinitions|timescale)\b/.test(text.slice(0, 20000))) return parseVcd(text, name)
  return parseCsv(text, name, opts)
}
