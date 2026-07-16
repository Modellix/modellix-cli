import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('safe command suggestions', () => {
  let originalStdinIsTty: PropertyDescriptor | undefined

  beforeEach(() => {
    originalStdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', {configurable: true, value: true})
  })

  afterEach(() => {
    if (originalStdinIsTty) {
      Object.defineProperty(process.stdin, 'isTTY', originalStdinIsTty)
    } else {
      Reflect.deleteProperty(process.stdin, 'isTTY')
    }
  })

  it('suggests but never executes the nearest command in a TTY', async () => {
    const {error, stderr} = await runCommand(['model', 'rn'])

    expect(getExitCode(error)).to.equal(127)
    expect(stderr).to.contain('Did you mean model run?')
    expect(error?.message).to.contain('Run modellix-cli help')
    expect(process.stdin.isTTY).to.equal(true)
  })
})

function getExitCode(error: Error | undefined): number | undefined {
  return (error as (Error & {oclif?: {exit?: number}}) | undefined)?.oclif?.exit
}
