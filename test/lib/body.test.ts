import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'

import {parseModelInvokeBody} from '../../src/lib/body.js'

describe('model request body', () => {
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'modellix-body-test-'))
  })

  afterEach(async () => {
    await rm(temporaryDirectory, {force: true, recursive: true})
  })

  it('parses inline and file JSON', async () => {
    const filePath = join(temporaryDirectory, 'body.json')
    await writeFile(filePath, '{"prompt":"from file"}', 'utf8')

    expect(await parseModelInvokeBody({bodyText: '{"prompt":"inline"}'})).to.deep.equal({
      prompt: 'inline',
    })
    expect(await parseModelInvokeBody({bodyFile: filePath})).to.deep.equal({prompt: 'from file'})
  })

  it('reads --body-file - from non-interactive stdin', async () => {
    const stdin = Readable.from(['{"prompt":', '"piped"}']) as Readable & {isTTY?: boolean}
    stdin.isTTY = false

    expect(await parseModelInvokeBody({bodyFile: '-', stdin})).to.deep.equal({prompt: 'piped'})
  })

  it('refuses to read body JSON from an interactive terminal', async () => {
    const stdin = Readable.from([]) as Readable & {isTTY?: boolean}
    stdin.isTTY = true

    await expectRejected(parseModelInvokeBody({bodyFile: '-', stdin}), 'interactive terminal')
  })

  it('rejects invalid, missing, and ambiguous bodies', async () => {
    await expectRejected(parseModelInvokeBody({bodyText: '{bad'}), 'Invalid JSON')
    await expectRejected(parseModelInvokeBody({}), 'Missing request body')
    await expectRejected(
      parseModelInvokeBody({bodyFile: 'body.json', bodyText: '{}'}),
      'either --body or --body-file',
    )
  })

  it('enforces byte, finite-number, and nesting limits', async () => {
    await expectRejected(
      parseModelInvokeBody({bodyText: '{"prompt":"too long"}', maxBytes: 10}),
      'byte limit',
    )
    await expectRejected(parseModelInvokeBody({bodyText: '{"cost":1e400}'}), 'non-finite')
    await expectRejected(
      parseModelInvokeBody({bodyText: `${'['.repeat(101)}0${']'.repeat(101)}`}),
      'nesting depth',
    )
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
