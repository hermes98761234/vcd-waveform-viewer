import type { Radix } from './lib/signal'
import type { Lang } from './lib/types'

export interface Settings {
  lang: Lang
  theme: 'auto' | 'light' | 'dark'
  radix: Radix
  sampleRate: number
}

const KEY = 'vcd-waveform-viewer:settings'

export const DEFAULTS: Settings = {
  lang: typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('uk') ? 'uk' : 'en',
  theme: 'auto',
  radix: 'hex',
  sampleRate: 1_000_000,
}

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
    return {
      lang: raw.lang === 'uk' || raw.lang === 'en' ? raw.lang : DEFAULTS.lang,
      theme: raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'auto' ? raw.theme : DEFAULTS.theme,
      radix: raw.radix && ['hex', 'dec', 'sdec', 'bin', 'ascii'].includes(raw.radix) ? raw.radix : DEFAULTS.radix,
      sampleRate: typeof raw.sampleRate === 'number' && raw.sampleRate > 0 ? raw.sampleRate : DEFAULTS.sampleRate,
    }
  } catch {
    return DEFAULTS
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}
