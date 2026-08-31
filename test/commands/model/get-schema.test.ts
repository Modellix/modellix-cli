import {runCommand} from '@oclif/test'
import {expect} from 'chai'

import {__setHttpRequesterForTest} from '../../../src/lib/modellix-client.js'

describe('model get-schema', () => {
  let originalApiKey: string | undefined

  beforeEach(() => {
    originalApiKey = process.env.MODELLIX_API_KEY
    delete process.env.MODELLIX_API_KEY
    __setHttpRequesterForTest(async () => ({
      bodyText: JSON.stringify({
        post: {
          description: 'A test model schema',
          operationId: 'testModelAsync',
          requestBody: {
            content: {'application/json': {schema: {required: ['prompt'], type: 'object'}}},
          },
          responses: {'200': {description: 'Task submitted'}},
          summary: 'Test Model',
        },
        servers: [{url: 'https://api.modellix.ai/api/v1/test/model'}],
      }),
      headers: {},
      statusCode: 200,
    }))
  })

  afterEach(() => {
    __setHttpRequesterForTest()
    restoreEnvironmentVariable('MODELLIX_API_KEY', originalApiKey)
  })

  it('prints the complete public schema as JSON without requiring an API key', async () => {
    let receivedApiKey = 'not-called'
    let receivedBaseUrl = ''
    let receivedPath = ''
    __setHttpRequesterForTest(async (options) => {
      receivedApiKey = options.apiKey
      receivedBaseUrl = options.baseUrl
      receivedPath = options.path
      return {
        bodyText: JSON.stringify({
          post: {requestBody: {}, responses: {}, summary: 'Test Model'},
          servers: [{url: 'https://api.modellix.ai/api/v1/test/model'}],
        }),
        headers: {},
        statusCode: 200,
      }
    })

    const {error, stdout} = await runCommand(['model', 'get-schema', 'test/model'])

    expect(error).to.equal(undefined)
    expect(JSON.parse(stdout)).to.deep.include({
      servers: [{url: 'https://api.modellix.ai/api/v1/test/model'}],
    })
    expect(receivedApiKey).to.equal('')
    expect(receivedBaseUrl).to.equal('https://www.modellix.ai')
    expect(receivedPath).to.equal('/models/test/model/api_schema')
  })

  it('honors a custom schema origin for local compatible endpoints', async () => {
    let receivedBaseUrl = ''
    __setHttpRequesterForTest(async (options) => {
      receivedBaseUrl = options.baseUrl
      return {
        bodyText: JSON.stringify({
          post: {requestBody: {}, responses: {}},
          servers: [{url: 'http://127.0.0.1:8787/api/v1/test/model'}],
        }),
        headers: {},
        statusCode: 200,
      }
    })

    const {error} = await runCommand([
      'model',
      'get-schema',
      'test/model',
      '--base-url',
      'http://127.0.0.1:8787',
    ])

    expect(error).to.equal(undefined)
    expect(receivedBaseUrl).to.equal('http://127.0.0.1:8787')
  })

  it('supports human and quiet output', async () => {
    const human = await runCommand([
      'model',
      'get-schema',
      'test/model',
      '--output',
      'human',
    ])
    const quiet = await runCommand(['model', 'get-schema', 'test/model', '--quiet'])

    expect(human.error).to.equal(undefined)
    expect(human.stdout).to.contain('model: test/model')
    expect(human.stdout).to.contain('summary: Test Model')
    expect(human.stdout).to.contain('requestBody:')
    expect(quiet.error).to.equal(undefined)
    expect(quiet.stdout.trim()).to.equal('https://api.modellix.ai/api/v1/test/model')
  })

  it('points invalid slugs to model list without making a request', async () => {
    let requests = 0
    __setHttpRequesterForTest(async () => {
      requests += 1
      throw new Error('request should not be made')
    })

    const {error} = await runCommand(['model', 'get-schema', 'missing'])

    expect(error?.message).to.contain('provider/model')
    expect(error?.message).to.contain('modellix-cli model list --output slugs')
    expect(error?.oclif?.exit).to.equal(2)
    expect(requests).to.equal(0)
  })

  it('rejects a malformed schema response', async () => {
    __setHttpRequesterForTest(async () => ({
      bodyText: '{"servers":[]}',
      headers: {},
      statusCode: 200,
    }))

    const {error} = await runCommand(['model', 'get-schema', 'test/model'])
    expect(error?.message).to.contain('expected servers, post.requestBody, and post.responses')
  })

  it('rejects inference URLs containing credentials or query parameters', async () => {
    __setHttpRequesterForTest(async () => ({
      bodyText: JSON.stringify({
        post: {requestBody: {}, responses: {}},
        servers: [{url: 'https://user:password@api.modellix.ai/model?token=secret'}],
      }),
      headers: {},
      statusCode: 200,
    }))

    const {error} = await runCommand(['model', 'get-schema', 'test/model'])
    expect(error?.message).to.contain('must not include credentials')
    expect(error?.message).not.to.contain('password')
    expect(error?.message).not.to.contain('secret')
  })
})

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
