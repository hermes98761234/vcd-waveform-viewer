import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'

describe('parseCsv', () => {
  it('reads a time column with units and bit channels', () => {
    const cap = parseCsv('Time [s],CLK,DATA\n0,0,0\n0.000001,1,0\n0.000002,0,1\n0.000003,1,1\n')
    expect(cap.timescale).toBeCloseTo(1e-6, 12)
    expect(cap.signals.map((s) => s.name)).toEqual(['CLK', 'DATA'])
    expect(cap.signals[0].times).toEqual([0, 1, 2, 3])
    expect(cap.signals[1].times).toEqual([0, 2])
    expect(cap.signals[1].values).toEqual(['0', '1'])
    expect(cap.end).toBe(3)
  })
  it('uses the header unit', () => {
    const cap = parseCsv('time_ns;a\n0;0\n100;1\n200;0\n')
    expect(cap.timescale).toBeCloseTo(1e-7, 15)
    expect(cap.signals[0].times).toEqual([0, 1, 2])
  })
  it('treats rows as samples without a time column', () => {
    const cap = parseCsv('a,b\n0,1\n0,1\n1,1\n', 'x.csv', { sampleRate: 1000 })
    expect(cap.timescale).toBeCloseTo(0.001, 9)
    expect(cap.signals[0].times).toEqual([0, 2])
    expect(cap.signals[1].times).toEqual([0])
  })
  it('turns non-binary numeric columns into reals', () => {
    const cap = parseCsv('t,v\n0,1.5\n1,2.5\n')
    expect(cap.signals[0].kind).toBe('real')
    expect(cap.signals[0].values).toEqual(['1.5', '2.5'])
  })
  it('rejects empty input', () => {
    expect(() => parseCsv('')).toThrow()
  })
})
