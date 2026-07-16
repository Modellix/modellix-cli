import {expect} from 'chai'

import {formatDuration, parseDuration, parseDurationMs} from '../../src/lib/duration.js'

describe('duration', () => {
  it('parses bare seconds and explicit units', () => {
    expect(parseDuration('30')).to.equal(30_000)
    expect(parseDuration('30s')).to.equal(30_000)
    expect(parseDuration('5m')).to.equal(300_000)
    expect(parseDuration('2H')).to.equal(7_200_000)
    expect(parseDurationMs('500ms')).to.equal(500)
  })

  it('rejects malformed, zero, and out-of-range durations', () => {
    expect(() => parseDuration('1.5m')).to.throw('Invalid duration')
    expect(() => parseDuration('0')).to.throw('greater than zero')
    expect(() => parseDurationMs('2m', 'timeout', {maxMs: 60_000})).to.throw(
      'timeout must not exceed 1m',
    )
  })

  it('formats durations using the largest exact unit', () => {
    expect(formatDuration(500)).to.equal('500ms')
    expect(formatDuration(30_000)).to.equal('30s')
    expect(formatDuration(300_000)).to.equal('5m')
    expect(formatDuration(7_200_000)).to.equal('2h')
  })
})
