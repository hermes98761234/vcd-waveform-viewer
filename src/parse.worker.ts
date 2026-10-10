import { parseCapture } from './lib/load'

export interface ParseRequest {
  file: File
  sampleRate: number
}
export type ParseResponse = { cap: import('./lib/types').Capture } | { error: string }

self.onmessage = async (e: MessageEvent<ParseRequest>) => {
  try {
    const text = await e.data.file.text()
    const cap = parseCapture(text, e.data.file.name, { sampleRate: e.data.sampleRate })
    ;(self as unknown as Worker).postMessage({ cap } satisfies ParseResponse)
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ error: err instanceof Error ? err.message : String(err) } satisfies ParseResponse)
  }
}
