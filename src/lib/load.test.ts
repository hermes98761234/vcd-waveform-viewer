import { describe, expect, it } from 'vitest'
import { parseCapture } from './load'

describe('parseCapture', () => {
  it('detects VCD and CSV', () => {
    const vcd = '$timescale 1ns $end\n$scope module m $end\n$var wire 1 ! a $end\n$upscope $end\n$enddefinitions $end\n#0\n1!\n#5\n0!\n'
    expect(parseCapture(vcd, 'a.vcd').signals[0].times).toEqual([0, 5])
    expect(parseCapture('time,a\n0,0\n1,1\n', 'a.csv').signals[0].times).toEqual([0, 1])
  })
})
