import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {__setHttpRequesterForTest} from '../../../src/lib/modellix-client.js'

const taskIdProperty = 'task_id'

describe('model batch', () => {
  let originalApiKey: string | undefined
  let originalXdgConfigHome: string | undefined
  let temporaryDirectory: string

  beforeEach(async () => {
    originalApiKey = process.env.MODELLIX_API_KEY
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'modellix-batch-test-'))
    process.env.XDG_CONFIG_HOME = temporaryDirectory
    process.env.MODELLIX_API_KEY = 'batch-key'
  })

  afterEach(async () => {
    __setHttpRequesterForTest()
    restoreEnvironmentVariable('MODELLIX_API_KEY', originalApiKey)
    restoreEnvironmentVariable('XDG_CONFIG_HOME', originalXdgConfigHome)
    await rm(temporaryDirectory, {force: true, recursive: true})
  })

  it('submits JSONL entries concurrently and preserves input order in output', async () => {
    const inputPath = await writeBatch([
      {body: {prompt: 'secret prompt one'}, modelSlug: 'google/model-one'},
      {body: {prompt: 'secret prompt two'}, modelSlug: 'google/model-two'},
    ])
    let taskNumber = 0
    __setHttpRequesterForTest(async () => {
      taskNumber += 1
      return {
        bodyText: JSON.stringify({
          data: {status: 'pending', [taskIdProperty]: `task-${taskNumber}`},
        }),
        headers: {},
        statusCode: 200,
      }
    })

    const {error, stdout} = await runCommand([
      'model',
      'batch',
      inputPath,
      '--max-tasks',
      '2',
      '--concurrency',
      '2',
    ])

    expect(error).to.equal(undefined)
    const output = JSON.parse(stdout)
    expect(output).to.deep.include({failed: 0, succeeded: 2, total: 2})
    expect(output.tasks.map((task: {modelSlug: string}) => task.modelSlug)).to.deep.equal([
      'google/model-one',
      'google/model-two',
    ])
    expect(stdout).not.to.contain('secret prompt')
    expect(stdout).not.to.contain('batch-key')
  })

  it('requires an explicit paid-task safety guard before any request', async () => {
    const inputPath = await writeBatch([{body: {prompt: 'cat'}, modelSlug: 'google/model'}])
    __setHttpRequesterForTest(async () => {
      throw new Error('requester should not be called')
    })

    const {error} = await runCommand(['model', 'batch', inputPath])
    expect(error?.message).to.contain('--max-tasks or explicit --yes')
  })

  it('rejects input exceeding max-tasks before any request', async () => {
    const inputPath = await writeBatch([
      {body: {}, modelSlug: 'google/one'},
      {body: {}, modelSlug: 'google/two'},
    ])
    __setHttpRequesterForTest(async () => {
      throw new Error('requester should not be called')
    })

    const {error} = await runCommand(['model', 'batch', inputPath, '--max-tasks', '1'])
    expect(error?.message).to.contain('exceeds the --max-tasks limit')
  })

  it('validates every model slug before starting any paid request', async () => {
    const inputPath = await writeBatch([
      {body: {}, modelSlug: 'google/valid'},
      {body: {}, modelSlug: 'invalid-slug'},
    ])
    let requests = 0
    __setHttpRequesterForTest(async () => {
      requests += 1
      throw new Error('must not submit')
    })

    const {error} = await runCommand(['model', 'batch', inputPath, '--yes'])
    expect(error?.message).to.contain('line 2')
    expect(requests).to.equal(0)
  })

  it('waits for tasks and emits resource URLs in quiet mode', async () => {
    const inputPath = await writeBatch([{body: {prompt: 'cat'}, modelSlug: 'google/model'}])
    __setHttpRequesterForTest(async (options) => {
      if (options.method === 'POST') {
        return {
          bodyText: '{"data":{"status":"pending","task_id":"task-batch-wait"}}',
          headers: {},
          statusCode: 200,
        }
      }

      return {
        bodyText:
          '{"data":{"result":{"resources":[{"url":"https://cdn.example.com/batch.png"}]},"status":"success","task_id":"task-batch-wait"}}',
        headers: {},
        statusCode: 200,
      }
    })

    const {error, stdout} = await runCommand([
      'model',
      'batch',
      inputPath,
      '--yes',
      '--wait',
      '--quiet',
    ])
    expect(error).to.equal(undefined)
    expect(stdout.trim()).to.equal('https://cdn.example.com/batch.png')
  })

  it('reports malformed JSONL line numbers without echoing input', async () => {
    const inputPath = join(temporaryDirectory, 'invalid.jsonl')
    await writeFile(inputPath, '{"modelSlug":"google/one","body":{}}\nsecret payload', 'utf8')

    const {error} = await runCommand(['model', 'batch', inputPath, '--yes'])
    expect(error?.message).to.contain('line 2')
    expect(error?.message).not.to.contain('secret payload')
  })

  it('redacts API keys and body strings from per-task failures', async () => {
    const inputPath = await writeBatch([
      {body: {prompt: 'private prompt value'}, modelSlug: 'google/model'},
    ])
    __setHttpRequesterForTest(async () => {
      throw new Error('request failed for private prompt value with batch-key')
    })

    const {error, stdout} = await runCommand(['model', 'batch', inputPath, '--yes'])
    expect(error?.oclif?.exit).to.equal(1)
    expect(stdout).to.match(/outcome is unknown|do not submit/i)
    expect(stdout).not.to.contain('private prompt value')
    expect(stdout).not.to.contain('batch-key')
  })

  it('stops starting new tasks after an outcome-unknown submission by default', async () => {
    const inputPath = await writeBatch([
      {body: {prompt: 'first'}, modelSlug: 'google/one'},
      {body: {prompt: 'second'}, modelSlug: 'google/two'},
    ])
    let requests = 0
    __setHttpRequesterForTest(async () => {
      requests += 1
      throw new Error('connection ended after write')
    })

    const {error, stdout} = await runCommand([
      'model',
      'batch',
      inputPath,
      '--yes',
      '--concurrency',
      '1',
    ])
    const output = JSON.parse(stdout)

    expect(error?.oclif?.exit).to.equal(1)
    expect(requests).to.equal(1)
    expect(output.tasks.map((task: {submissionState: string}) => task.submissionState)).to.deep.equal([
      'unknown',
      'skipped',
    ])
  })

  it('uses exit code 124 when all failed batch tasks timed out locally', async () => {
    const inputPath = await writeBatch([{body: {prompt: 'cat'}, modelSlug: 'google/model'}])
    __setHttpRequesterForTest(async (options) => ({
      bodyText: options.method === 'POST'
        ? '{"data":{"status":"pending","task_id":"task-batch-timeout"}}'
        : '{"data":{"status":"running","task_id":"task-batch-timeout"}}',
      headers: {},
      statusCode: 200,
    }))

    const {error, stdout} = await runCommand([
      'model',
      'batch',
      inputPath,
      '--yes',
      '--wait',
      '--interval',
      '1ms',
      '--timeout',
      '1ms',
    ])

    expect(error?.oclif?.exit).to.equal(124)
    expect(JSON.parse(stdout).tasks[0]).to.include({status: 'timeout'})
  })

  async function writeBatch(entries: unknown[]): Promise<string> {
    const filePath = join(temporaryDirectory, `batch-${entries.length}.jsonl`)
    await writeFile(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n'), 'utf8')
    return filePath
  }
})

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
