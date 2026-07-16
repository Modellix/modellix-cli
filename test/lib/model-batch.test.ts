import {expect} from 'chai'
import {Readable} from 'node:stream'

import {readModelBatch} from '../../src/lib/model-batch.js'

describe('model batch input', () => {
  it('enforces the stream byte limit', async () => {
    const stdin = Readable.from(['{"modelSlug":"google/model","body":{}}']) as Readable & {
      isTTY?: boolean
    }
    stdin.isTTY = false

    await expectRejected(readModelBatch('-', stdin, {maxBytes: 10}), 'byte limit')
  })

  it('rejects deeply nested bodies without overflowing the call stack', async () => {
    const body = `${'['.repeat(20_000)}0${']'.repeat(20_000)}`
    const stdin = Readable.from([`{"modelSlug":"google/model","body":${body}}`]) as Readable & {
      isTTY?: boolean
    }
    stdin.isTTY = false

    await expectRejected(readModelBatch('-', stdin), 'nesting depth')
  })

  it('stops parsing as soon as the configured task limit is exceeded', async () => {
    const line = '{"modelSlug":"google/model","body":{}}'
    const stdin = Readable.from([`${'\n'.repeat(100_000)}${line}\n${line}`]) as Readable & {
      isTTY?: boolean
    }
    stdin.isTTY = false

    await expectRejected(readModelBatch('-', stdin, {maxTasks: 1}), '--max-tasks limit of 1')
  })
})

async function expectRejected(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise
    expect.fail('Expected promise to reject')
  } catch (error) {
    expect(error).to.be.instanceOf(Error)
    expect((error as Error).message).to.contain(message)
  }
}
