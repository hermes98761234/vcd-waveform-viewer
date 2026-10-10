import { describe, expect, it } from 'vitest'
import {
  edgeMatcher,
  estimateBaud,
  findChange,
  formatSeconds,
  formatValue,
  indexAt,
  measureBit,
  niceStep,
  parseNumberInput,
  valueAt,
  valueMatcher,
} from './signal'
import type { Signal } from './types'

const bit = (times: number[], values: string[]): Signal => ({ idx: 0, id: 'a', name: 'a', scope: '', width: 1, kind: 'bit', times, values })
const bus = (width: number, times: number[], values: string[]): Signal => ({ idx: 0, id: 'b', name: 'b', scope: '', width, kind: 'bus', times, values })

describe('lookup', () => {
  const s = bit([10, 20, 30], ['0', '1', '0'])
  it('indexAt / valueAt', () => {
    expect(indexAt(s, 5)).toBe(-1)
    expect(valueAt(s, 5)).toBe('x')
    expect(valueAt(s, 10)).toBe('0')
    expect(valueAt(s, 25)).toBe('1')
    expect(valueAt(s, 99)).toBe('0')
  })
  it('finds edges in both directions', () => {
    expect(findChange(s, 10, 1, edgeMatcher('rising'))).toBe(20)
    expect(findChange(s, 20, 1, edgeMatcher('rising'))).toBeNull()
    expect(findChange(s, 20, 1, edgeMatcher('falling'))).toBe(30)
    expect(findChange(s, 30, -1, edgeMatcher('any'))).toBe(20)
    expect(findChange(s, 20, -1, edgeMatcher('rising'))).toBeNull()
    expect(findChange(s, 25, -1, edgeMatcher('rising'))).toBe(20)
  })
})

describe('formatValue', () => {
  const b = bus(8, [0], ['10100101'])
  it('formats radixes', () => {
    expect(formatValue(b, '10100101', 'hex')).toBe('A5')
    expect(formatValue(b, '10100101', 'dec')).toBe('165')
    expect(formatValue(b, '10100101', 'sdec')).toBe('-91')
    expect(formatValue(b, '10100101', 'bin')).toBe('10100101')
    expect(formatValue(b, '01001000', 'ascii')).toBe('H')
  })
  it('handles x and z', () => {
    expect(formatValue(b, 'xxxx0101', 'hex')).toBe('x5')
    expect(formatValue(b, '0x000101', 'hex')).toBe('X5')
    expect(formatValue(b, 'zzzzzzzz', 'hex')).toBe('zz')
    expect(formatValue(b, '0000x101', 'dec')).toBe('x')
  })
  it('pads to nibbles', () => {
    expect(formatValue(bus(10, [0], ['1111111111']), '1111111111', 'hex')).toBe('3FF')
  })
})

describe('time formatting', () => {
  it('chooses units', () => {
    expect(formatSeconds(0)).toBe('0 s')
    expect(formatSeconds(1.5e-6)).toBe('1.5 µs')
    expect(formatSeconds(1e-3)).toBe('1 ms')
    expect(formatSeconds(104.167e-6)).toBe('104.167 µs')
    expect(formatSeconds(2.5e-9, 1e-9)).toBe('3 ns')
    expect(formatSeconds(2.5e-9, 0.5e-9)).toBe('2.5 ns')
  })
  it('nice steps', () => {
    expect(niceStep(0.7)).toBe(1)
    expect(niceStep(1.1)).toBe(2)
    expect(niceStep(2.1)).toBe(5)
    expect(niceStep(5.1)).toBe(10)
    expect(niceStep(130)).toBe(200)
  })
})

describe('search values', () => {
  it('parses numbers by radix', () => {
    expect(parseNumberInput('0x1F', 'dec')).toBe(31n)
    expect(parseNumberInput('1F', 'hex')).toBe(31n)
    expect(parseNumberInput('1F', 'dec')).toBeNull()
    expect(parseNumberInput('101', 'bin')).toBe(5n)
    expect(parseNumberInput('-1', 'sdec')).toBe(-1n)
  })
  it('matches bus values', () => {
    const b = bus(4, [0, 10, 20, 30], ['0001', '1010', '1111', '1010'])
    const m = valueMatcher(b, 'A', 'hex')!
    expect(findChange(b, 0, 1, m)).toBe(10)
    expect(findChange(b, 10, 1, m)).toBe(30)
    const neg = valueMatcher(b, '-1', 'sdec')!
    expect(findChange(b, 0, 1, neg)).toBe(20)
    expect(valueMatcher(b, 'zz', 'hex')).toBeNull()
  })
})

describe('measurements', () => {
  it('measures a clock', () => {
    // 10 ticks period, 50% duty, from t=0..100
    const times: number[] = []
    const values: string[] = []
    for (let i = 0; i < 10; i++) {
      times.push(i * 10, i * 10 + 5)
      values.push('1', '0')
    }
    const m = measureBit(bit(times, values), 0, 100)
    expect(m.high).toBe(50)
    expect(m.low).toBe(50)
    expect(m.periodTicks).toBe(10)
    expect(m.rising).toBe(9)
    expect(m.falling).toBe(10)
  })
  it('estimates baud from shortest pulse', () => {
    const T = 104167
    const s = bit([0, 3 * T, 4 * T, 6 * T], ['1', '0', '1', '0'])
    expect(estimateBaud(s, 1e-9)).toBe(9600)
  })
})
