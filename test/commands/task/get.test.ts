import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeConfig} from '../../../src/lib/config.js'
import {__setHttpRequesterForTest} from '../../../src/lib/modellix-client.js'

const taskIdProperty = 'task_id'

describe('task get', () => {
  let receivedApiKey = ''
  let receivedMethod = ''
  let receivedPath = ''
  let originalApiKey: string | undefined
  let originalBaseUrl: string | undefined
  let originalXdgConfigHome: string | undefined
  let temporaryXdgDirectory: string

  beforeEach(async () => {
    originalApiKey = process.env.MODELLIX_API_KEY
    originalBaseUrl = process.env.MODELLIX_BASE_URL
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    temporaryXdgDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-task-test-'))
    process.env.XDG_CONFIG_HOME = temporaryXdgDirectory
    receivedApiKey = ''
    receivedMethod = ''
    receivedPath = ''
    delete process.env.MODELLIX_API_KEY
  })

  afterEach(async () => {
    __setHttpRequesterForTest()
    restoreEnvironmentVariable('MODELLIX_API_KEY', originalApiKey)
    restoreEnvironmentVariable('MODELLIX_BASE_URL', originalBaseUrl)
    restoreEnvironmentVariable('XDG_CONFIG_HOME', originalXdgConfigHome)
    await rm(temporaryXdgDirectory, {force: true, recursive: true})
  })

  it('gets task result with api key from environment', async () => {
    process.env.MODELLIX_API_KEY = 'env-key'
    __setHttpRequesterForTest(async (options) => {
      receivedApiKey = options.apiKey
      receivedMethod = options.method
      receivedPath = options.path
      return {
        bodyText:
          '{"code":0,"data":{"result":{"resources":[{"type":"image","url":"https://cdn.example.com/a.png"}]},"status":"success","task_id":"task-abc123"},"message":"success"}',
        headers: {},
        statusCode: 200,
      }
    })

    const {error, stdout} = await runCommand(['task', 'get', 'task-abc123'])

    expect(error).to.equal(undefined)
    expect(receivedPath).to.equal('/api/v1/tasks/task-abc123')
    expect(receivedApiKey).to.equal('env-key')
    expect(receivedMethod).to.equal('GET')
    expect(stdout).to.contain('"status": "success"')
    expect(stdout).to.contain('"task_id": "task-abc123"')
  })

  it('shows mapped error message on 429 response', async () => {
    process.env.MODELLIX_API_KEY = 'env-key'
    __setHttpRequesterForTest(async () => ({
      bodyText: '{"code":429,"message":"Too many requests"}',
      headers: {'x-ratelimit-reset': '1710000000'},
      statusCode: 429,
    }))

    const {error} = await runCommand(['task', 'get', 'task-abc123'])
    expect(error?.message).to.contain('429 Too Many Requests')
    expect(error?.message).to.contain('X-RateLimit-Reset=1710000000')
  })

  it('uses the saved key and safely encodes the task ID', async () => {
    await writeConfig({apiKey: 'saved-task-key'})
    __setHttpRequesterForTest(async (options) => {
      receivedApiKey = options.apiKey
      receivedPath = options.path
      return {
        bodyText: '{"code":0,"data":{"status":"pending","task_id":"folder/task"},"message":"success"}',
        headers: {},
        statusCode: 200,
      }
    })

    const {error} = await runCommand(['task', 'get', 'folder/task'])

    expect(error).to.equal(undefined)
    expect(receivedApiKey).to.equal('saved-task-key')
    expect(receivedPath).to.equal('/api/v1/tasks/folder%2Ftask')
  })

  it('supports unified human and quiet output modes', async () => {
    process.env.MODELLIX_API_KEY = 'output-mode-key'
    __setHttpRequesterForTest(async () => ({
      bodyText:
        '{"code":0,"data":{"result":{"resources":[{"url":"https://cdn.example.com/result.png"}]},"status":"success","task_id":"task-output"},"message":"success"}',
      headers: {},
      statusCode: 200,
    }))

    const human = await runCommand(['task', 'get', 'task-output', '--output', 'human'])
    const quiet = await runCommand(['task', 'get', 'task-output', '--quiet'])

    expect(human.error).to.equal(undefined)
    expect(human.stdout).to.contain('Status: success')
    expect(human.stdout).to.contain('Resource: https://cdn.example.com/result.png')
    expect(quiet.error).to.equal(undefined)
    expect(quiet.stdout.trim()).to.equal('https://cdn.example.com/result.png')
  })

  it('never treats an argument after -- as a base URL carrying the API key', async () => {
    process.env.MODELLIX_API_KEY = 'separator-key'
    process.env.MODELLIX_BASE_URL = 'https://safe.example'
    let receivedBaseUrl = ''
    __setHttpRequesterForTest(async (options) => {
      receivedBaseUrl = options.baseUrl
      return {
        bodyText:
          '{"data":{"status":"pending","task_id":"--base-url=https://evil.example"}}',
        headers: {},
        statusCode: 200,
      }
    })

    const {error} = await runCommand([
      'task',
      'get',
      '--',
      '--base-url=https://evil.example',
    ])

    expect(error).to.equal(undefined)
    expect(receivedBaseUrl).to.equal('https://safe.example')
  })

  it('rejects a response belonging to a different task', async () => {
    process.env.MODELLIX_API_KEY = 'mismatch-key'
    __setHttpRequesterForTest(async () => ({
      bodyText: '{"data":{"status":"success","task_id":"different-task"}}',
      headers: {},
      statusCode: 200,
    }))

    const {error} = await runCommand(['task', 'get', 'expected-task'])
    expect(error?.message).to.contain('different task ID')
    expect(error?.message).not.to.contain('different-task')
  })

  it('normalizes resource URLs before printing them', async () => {
    process.env.MODELLIX_API_KEY = 'url-normalization-key'
    __setHttpRequesterForTest(async () => ({
      bodyText: JSON.stringify({
        data: {
          result: {resources: [{url: 'https://cdn.example.com/file\nFAKE-LINE'}]},
          status: 'success',
          [taskIdProperty]: 'task-url-normalization',
        },
      }),
      headers: {},
      statusCode: 200,
    }))

    const {error, stdout} = await runCommand([
      'task',
      'get',
      'task-url-normalization',
      '--quiet',
    ])
    expect(error).to.equal(undefined)
    expect(stdout.trim()).to.equal('https://cdn.example.com/fileFAKE-LINE')
    expect(stdout.trim().split(/\r?\n/)).to.have.length(1)
  })

  it('escapes terminal controls in JSON without changing parsed data', async () => {
    process.env.MODELLIX_API_KEY = 'json-control-key'
    const note = 'A\u009BZB\u202EC'
    __setHttpRequesterForTest(async () => ({
      bodyText: JSON.stringify({
        data: {note, status: 'success', [taskIdProperty]: 'task-json-controls'},
      }),
      headers: {},
      statusCode: 200,
    }))

    const {error, stdout} = await runCommand(['task', 'get', 'task-json-controls', '--json'])
    expect(error).to.equal(undefined)
    expect(stdout).not.to.contain('\u009B')
    expect(stdout).not.to.contain('\u202E')
    expect(JSON.parse(stdout).data.note).to.equal(note)
  })
})

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
