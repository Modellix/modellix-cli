import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {readTaskHistory} from '../../../src/lib/history.js'
import {__setHttpRequesterForTest} from '../../../src/lib/modellix-client.js'

describe('model run', () => {
  let originalApiKey: string | undefined
  let originalXdgConfigHome: string | undefined
  let receivedApiKey = ''
  let receivedBody = ''
  let receivedMethod = ''
  let receivedPath = ''
  let temporaryXdgDirectory: string

  beforeEach(async () => {
    originalApiKey = process.env.MODELLIX_API_KEY
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    temporaryXdgDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-run-test-'))
    process.env.XDG_CONFIG_HOME = temporaryXdgDirectory
    delete process.env.MODELLIX_API_KEY
    receivedApiKey = ''
    receivedBody = ''
    receivedMethod = ''
    receivedPath = ''
  })

  afterEach(async () => {
    __setHttpRequesterForTest()
    restoreEnvironmentVariable('MODELLIX_API_KEY', originalApiKey)
    restoreEnvironmentVariable('XDG_CONFIG_HOME', originalXdgConfigHome)
    await rm(temporaryXdgDirectory, {force: true, recursive: true})
  })

  it('submits a model task without the removed async suffix', async () => {
    stubSuccessfulTask()

    const {error, stdout} = await runCommand([
      'model',
      'run',
      '--model-slug',
      'bytedance/seedream-4.5-t2i',
      '--api-key',
      'test-key',
      '--body',
      '{"prompt":"cat"}',
    ])

    expect(error).to.equal(undefined)
    expect(receivedPath).to.equal('/api/v1/bytedance/seedream-4.5-t2i')
    expect(receivedPath).not.to.contain('/async')
    expect(receivedApiKey).to.equal('test-key')
    expect(receivedMethod).to.equal('POST')
    expect(receivedBody).to.equal('{"prompt":"cat"}')
    expect(stdout).to.contain('"task_id": "task-abc123"')
    const [historyEntry] = await readTaskHistory()
    expect(historyEntry).to.include({
      modelSlug: 'bytedance/seedream-4.5-t2i',
      status: 'submitted',
      taskId: 'task-abc123',
    })
  })

  it('keeps model invoke as a compatible alias', async () => {
    stubSuccessfulTask()

    const {error} = await runCommand([
      'model',
      'invoke',
      '--model-slug',
      'bytedance/seedream-4.5-t2i',
      '--api-key',
      'alias-test-key',
      '--body',
      '{"prompt":"cat"}',
    ])

    expect(error).to.equal(undefined)
    expect(receivedPath).to.equal('/api/v1/bytedance/seedream-4.5-t2i')
    expect(receivedApiKey).to.equal('alias-test-key')
  })

  it('can emit only the task ID for shell pipelines', async () => {
    stubSuccessfulTask()

    const {error, stdout} = await runCommand([
      'model',
      'run',
      '--model-slug',
      'bytedance/seedream-4.5-t2i',
      '--api-key',
      'test-key',
      '--body',
      '{"prompt":"cat"}',
      '--output',
      'task-id',
    ])

    expect(error).to.equal(undefined)
    expect(stdout.trim()).to.equal('task-abc123')
  })

  it('loads a request body from a JSON file', async () => {
    stubSuccessfulTask()
    const bodyPath = join(temporaryXdgDirectory, 'payload with spaces.json')
    await writeFile(bodyPath, '{"prompt":"file cat"}', 'utf8')

    const {error} = await runCommand([
      'model',
      'run',
      '--model-slug',
      'bytedance/seedream-4.5-t2i',
      '--api-key',
      'test-key',
      '--body-file',
      `"${bodyPath}"`,
    ])

    expect(error).to.equal(undefined)
    expect(receivedBody).to.equal('{"prompt":"file cat"}')
  })

  it('waits for completion and emits only resource URLs in quiet mode', async () => {
    let requestCount = 0
    __setHttpRequesterForTest(async (options) => {
      requestCount += 1
      if (options.method === 'POST') {
        return {
          bodyText: '{"code":0,"data":{"status":"pending","task_id":"task-wait"}}',
          headers: {},
          statusCode: 200,
        }
      }

      expect(options.path).to.equal('/api/v1/tasks/task-wait')
      return {
        bodyText:
          '{"code":0,"data":{"result":{"resources":[{"url":"https://cdn.example.com/result.png"}]},"status":"success","task_id":"task-wait"}}',
        headers: {},
        statusCode: 200,
      }
    })

    const {error, stdout} = await runCommand([
      'model',
      'run',
      '--model-slug',
      'google/nano-banana-2',
      '--api-key',
      'test-key',
      '--body',
      '{"prompt":"cat"}',
      '--wait',
      '--timeout',
      '30s',
      '--quiet',
    ])

    expect(error).to.equal(undefined)
    expect(requestCount).to.equal(2)
    expect(stdout.trim()).to.equal('https://cdn.example.com/result.png')
  })

  it('accepts explicit --no-wait and keeps the asynchronous response', async () => {
    stubSuccessfulTask()
    const {error, stdout} = await runCommand([
      'model',
      'run',
      '--model-slug',
      'google/nano-banana-2',
      '--api-key',
      'test-key',
      '--body',
      '{"prompt":"cat"}',
      '--no-wait',
    ])

    expect(error).to.equal(undefined)
    expect(stdout).to.contain('"task_id": "task-abc123"')
  })

  it('reports the submitted task ID and recovery command when waiting times out', async () => {
    __setHttpRequesterForTest(async (options) => ({
      bodyText: options.method === 'POST'
        ? '{"data":{"status":"pending","task_id":"task-resume"}}'
        : '{"data":{"status":"running","task_id":"task-resume"}}',
      headers: {},
      statusCode: 200,
    }))

    const {error} = await runCommand([
      'model',
      'run',
      '--model-slug',
      'google/nano-banana-2',
      '--api-key',
      'test-key',
      '--body',
      '{"prompt":"cat"}',
      '--wait',
      '--interval',
      '1ms',
      '--timeout',
      '1ms',
    ])

    expect(error?.oclif?.exit).to.equal(124)
    expect(error?.message).to.contain('task-resume')
    expect(error?.message).to.contain('modellix-cli task wait task-resume')
  })

  it('reports a terminal model failure without mislabeling it as a polling failure', async () => {
    __setHttpRequesterForTest(async (options) => ({
      bodyText: options.method === 'POST'
        ? '{"data":{"status":"pending","task_id":"task-terminal-failure"}}'
        : '{"data":{"status":"failed","task_id":"task-terminal-failure"}}',
      headers: {},
      statusCode: 200,
    }))

    const {error, stdout} = await runCommand([
      'model',
      'run',
      '--model-slug',
      'google/nano-banana-2',
      '--api-key',
      'test-key',
      '--body',
      '{"prompt":"cat"}',
      '--wait',
    ])

    expect(error?.oclif?.exit).to.equal(1)
    expect(error?.message).not.to.contain('polling failed')
    expect(stdout).to.contain('"status": "failed"')
  })

  it('keeps the paid task ID when response formatting fails', async () => {
    __setHttpRequesterForTest(async () => ({
      bodyText:
        '{"data":{"result":{"resources":[{"url":"not a URL"}]},"status":"pending","task_id":"task-format-recovery"}}',
      headers: {},
      statusCode: 200,
    }))

    const {error} = await runCommand([
      'model',
      'run',
      '--model-slug',
      'google/nano-banana-2',
      '--api-key',
      'test-key',
      '--body',
      '{"prompt":"cat"}',
      '--output',
      'human',
    ])

    expect(error?.message).to.contain('task-format-recovery')
    expect(error?.message).to.contain('modellix-cli task wait task-format-recovery')
  })

  it('validates wait durations before creating a potentially paid task', async () => {
    rejectUnexpectedRequest()
    const {error} = await runCommand([
      'model',
      'run',
      '--model-slug',
      'google/nano-banana-2',
      '--api-key',
      'test-key',
      '--body',
      '{"prompt":"cat"}',
      '--wait',
      '--timeout',
      'tomorrow',
    ])

    expect(error?.message).to.contain('Invalid timeout')
  })

  it('fails before the network request when the API key is missing', async () => {
    rejectUnexpectedRequest()

    const {error} = await runCommand([
      'model',
      'run',
      '--model-slug',
      'bytedance/seedream-4.5-t2i',
      '--body',
      '{"prompt":"cat"}',
    ])

    expect(error?.message).to.contain('Missing API key')
  })

  it('fails when the model slug contains more than one slash', async () => {
    rejectUnexpectedRequest()

    const {error} = await runCommand([
      'model',
      'run',
      '--model-slug',
      'provider/model/extra',
      '--api-key',
      'test-key',
      '--body',
      '{"prompt":"cat"}',
    ])

    expect(error?.message).to.contain('Invalid model slug')
    expect(error?.message).to.contain('provider/model')
  })

  it('fails when no request body is provided', async () => {
    rejectUnexpectedRequest()

    const {error} = await runCommand([
      'model',
      'run',
      '--model-slug',
      'bytedance/seedream-4.5-t2i',
      '--api-key',
      'test-key',
    ])

    expect(error?.message).to.contain('Missing request body')
  })

  it('removes terminal controls from human-readable errors', async () => {
    const unsafePath = `missing\u009BZ\u202ETXT`
    const {error} = await runCommand([
      'model',
      'run',
      '--model-slug',
      'google/model',
      '--api-key',
      'test-key',
      '--body-file',
      unsafePath,
    ])

    expect(error?.message).not.to.contain('\u009B')
    expect(error?.message).not.to.contain('\u202E')
  })

  function stubSuccessfulTask(): void {
    __setHttpRequesterForTest(async (options) => {
      receivedApiKey = options.apiKey
      receivedBody = options.body ?? ''
      receivedMethod = options.method
      receivedPath = options.path
      return {
        bodyText: '{"code":0,"data":{"status":"pending","task_id":"task-abc123"},"message":"success"}',
        headers: {},
        statusCode: 200,
      }
    })
  }
})

function rejectUnexpectedRequest(): void {
  __setHttpRequesterForTest(async () => {
    throw new Error('requester should not be called')
  })
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
