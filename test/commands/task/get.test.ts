import {runCommand} from '@oclif/test'
import {expect} from 'chai'

import {__setHttpRequesterForTest} from '../../../src/lib/modellix-client.js'

describe('task get', () => {
  let receivedApiKey = ''
  let receivedMethod = ''
  let receivedPath = ''

  beforeEach(() => {
    receivedApiKey = ''
    receivedMethod = ''
    receivedPath = ''
    delete process.env.MODELLIX_API_KEY
  })

  afterEach(() => {
    __setHttpRequesterForTest()
    delete process.env.MODELLIX_API_KEY
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
})
