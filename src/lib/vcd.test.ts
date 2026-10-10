import { describe, expect, it } from 'vitest'
import { formatTimescale, parseTimescale, parseVcd, writeVcd } from './vcd'
import { makeSample, SAMPLE_IDS } from './samples'

const SIMPLE = `$date today $end
$version test $end
$timescale 10 ns $end
$scope module top $end
$var wire 1 ! clk $end
$var wire 4 " bus [3:0] $end
$var reg 1 ! alias_of_clk $end
$var real 64 $ v $end
$scope module sub $end
$var wire 8 % data $end
$upscope $end
$upscope $end
$enddefinitions $end
#0
$dumpvars
0!
b101 "
bx %
r1.5 $
$end
#5
1!
b0110 "
#5
b1111 "
#10
0!
b1z0 %
r2.25 $
#20
`

describe('parseVcd', () => {
  const cap = parseVcd(SIMPLE)
  it('reads timescale and time range', () => {
    expect(cap.timescale).toBeCloseTo(1e-8, 15)
    expect(cap.start).toBe(0)
    expect(cap.end).toBe(20)
  })
  it('reads scopes, widths and kinds', () => {
    const [clk, bus, alias, v, data] = cap.signals
    expect(clk.scope).toBe('top')
    expect(bus.name).toBe('bus[3:0]')
    expect(bus.kind).toBe('bus')
    expect(bus.width).toBe(4)
    expect(v.kind).toBe('real')
    expect(data.scope).toBe('top.sub')
    expect(alias.times).toBe(clk.times)
  })
  it('records changes and pads short vectors', () => {
    const [clk, bus, , v, data] = cap.signals
    expect(clk.times).toEqual([0, 5, 10])
    expect(clk.values).toEqual(['0', '1', '0'])
    expect(bus.values).toEqual(['0101', '1111'])
    expect(bus.times).toEqual([0, 5])
    expect(v.values).toEqual(['1.5', '2.25'])
    expect(data.values).toEqual(['xxxxxxxx', '000001z0'])
  })
  it('rejects files without signals', () => {
    expect(() => parseVcd('hello')).toThrow()
  })
  it('skips multi-line comments in the body', () => {
    const c = parseVcd('$timescale 1ns $end $scope module m $end $var wire 1 ! a $end $upscope $end $enddefinitions $end\n#0\n0!\n$comment\n 1! bogus\n$end\n#4\n1!\n')
    expect(c.signals[0].times).toEqual([0, 4])
  })
})

describe('timescale', () => {
  it('parses units', () => {
    expect(parseTimescale('1 ns')).toBeCloseTo(1e-9, 18)
    expect(parseTimescale('100ps')).toBeCloseTo(1e-10, 18)
    expect(parseTimescale('10 us')).toBeCloseTo(1e-5, 15)
  })
  it('formats back', () => {
    expect(formatTimescale(1e-9)).toBe('1 ns')
    expect(formatTimescale(1e-10)).toBe('100 ps')
    expect(formatTimescale(1e-5)).toBe('10 us')
  })
})

describe('writeVcd', () => {
  it('round-trips every sample', () => {
    for (const id of SAMPLE_IDS) {
      const a = makeSample(id)
      const b = parseVcd(writeVcd(a))
      expect(b.signals.length).toBe(a.signals.length)
      expect(b.timescale).toBeCloseTo(a.timescale, 15)
      a.signals.forEach((s, i) => {
        expect(b.signals[i].name).toBe(s.name)
        expect(b.signals[i].kind).toBe(s.kind)
        expect(b.signals[i].times).toEqual(s.times)
        expect(b.signals[i].values).toEqual(s.values)
      })
    }
  })
})
