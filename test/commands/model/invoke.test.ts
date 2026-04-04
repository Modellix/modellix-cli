import {runCommand} from '@oclif/test'
import {expect} from 'chai'

import {__setHttpRequesterForTest} from '../../../src/lib/modellix-client.js'

describe('model invoke', () => {
  let receivedApiKey = ''
  let receivedBody = ''
  let receivedMethod = ''
  let receivedPath = ''

  beforeEach(() => {
    receivedApiKey = ''
    receivedBody = ''
    receivedMethod = ''
    receivedPath = ''
    delete process.env.MODELLIX_API_KEY
  })

  afterEach(() => {
    __setHttpRequesterForTest()
    delete process.env.MODELLIX_API_KEY
  })

  it('creates async model task with --api-key and --body', async () => {
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

    const {error, stdout} = await runCommand([
      'model',
      'invoke',
      '--model-type',
      'text-to-image',
      '--model-id',
      'qwen-image-plus',
      '--api-key',
      'test-key',
      '--body',
      '{"prompt":"cat"}',
    ])

    expect(error).to.equal(undefined)
    expect(receivedPath).to.equal('/api/v1/text-to-image/alibaba/qwen-image-plus/async')
    expect(receivedApiKey).to.equal('test-key')
    expect(receivedMethod).to.equal('POST')
    expect(receivedBody).to.contain('"prompt":"cat"')
    expect(stdout).to.contain('"task_id": "task-abc123"')
  })

  it('fails when api key is missing', async () => {
    __setHttpRequesterForTest(async () => {
      throw new Error('requester should not be called')
    })

    const {error} = await runCommand([
      'model',
      'invoke',
      '--model-type',
      'text-to-image',
      '--model-id',
      'qwen-image-plus',
      '--body',
      '{"prompt":"cat"}',
    ])

    expect(error?.message).to.contain('Missing API key')
  })
})
