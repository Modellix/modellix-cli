import {expect} from 'chai'

import {
  __setDebugWriterForTest,
  __setHttpRequesterForTest,
  __setRetryDelayForTest,
  ApiResponseSizeLimitError,
  getTaskResult,
  getTeamBalance,
  invokeModelAsync,
  listModels,
  PaidSubmissionOutcomeUnknownError,
  runModel,
  validateApiKey,
} from '../../src/lib/modellix-client.js'

const docsUrlProperty = 'docs_url'
const isValidProperty = 'is_valid'
const taskIdProperty = 'task_id'

describe('modellix client', () => {
  let originalBaseUrl: string | undefined
  let originalDebug: string | undefined
  let receivedApiKey = ''
  let receivedBody: string | undefined
  let receivedMethod = ''
  let receivedPath = ''

  beforeEach(() => {
    originalBaseUrl = process.env.MODELLIX_BASE_URL
    originalDebug = process.env.MODELLIX_CLI_HTTP_DEBUG
    receivedApiKey = ''
    receivedBody = undefined
    receivedMethod = ''
    receivedPath = ''
    __setRetryDelayForTest(async () => {})
  })

  afterEach(() => {
    __setDebugWriterForTest()
    __setHttpRequesterForTest()
    __setRetryDelayForTest()
    restoreEnvironmentVariable('MODELLIX_CLI_HTTP_DEBUG', originalDebug)
    restoreEnvironmentVariable('MODELLIX_BASE_URL', originalBaseUrl)
  })

  it('validates an accepted API key through the read-only validation endpoint', async () => {
    setJsonResponse({code: 0, data: {[isValidProperty]: true}, message: 'success'})

    expect(await validateApiKey({apiKey: 'validation-test-key'})).to.equal(true)
    expect(receivedApiKey).to.equal('validation-test-key')
    expect(receivedMethod).to.equal('GET')
    expect(receivedPath).to.equal('/api/v1/apikey/validate')
    expect(receivedBody).to.equal(undefined)
  })

  it('returns false when the validation endpoint rejects an API key in a 200 response', async () => {
    setJsonResponse({code: 0, data: {[isValidProperty]: false}, message: 'success'})

    expect(await validateApiKey({apiKey: 'invalid-test-key'})).to.equal(false)
  })

  it('rejects a malformed validation response', async () => {
    setJsonResponse({code: 0, data: {}, message: 'success'})

    const error = await captureError(() => validateApiKey({apiKey: 'validation-test-key'}))
    expect(error.message).to.match(/valid|response/i)
  })

  it('propagates validation network failures as actionable errors', async () => {
    let attempts = 0
    __setHttpRequesterForTest(async () => {
      attempts += 1
      throw new Error('connection refused for validation-test-key')
    })

    const error = await captureError(() => validateApiKey({apiKey: 'validation-test-key'}))
    expect(error.message).to.contain('Network request failed')
    expect(error.message).not.to.contain('validation-test-key')
    expect(attempts).to.equal(3)
  })

  it('lists active models through the documented endpoint', async () => {
    const payload = {
      models: [
        {
          description: 'A test model',
          [docsUrlProperty]: 'https://docs.modellix.ai/test/model.md',
          slug: 'test/model',
          type: 'text-to-image',
        },
      ],
    }
    setJsonResponse(payload)

    expect(await listModels({apiKey: 'list-test-key'})).to.deep.equal(payload)
    expect(receivedApiKey).to.equal('list-test-key')
    expect(receivedMethod).to.equal('GET')
    expect(receivedPath).to.equal('/api/v1/models')
    expect(receivedBody).to.equal(undefined)
  })

  it('returns the numeric team balance from the documented response', async () => {
    setJsonResponse({code: 0, data: {balance: 12.3456}, message: 'success'})

    expect(await getTeamBalance({apiKey: 'balance-test-key'})).to.equal(12.3456)
    expect(receivedMethod).to.equal('GET')
    expect(receivedPath).to.equal('/api/v1/team/balance')
  })

  it('runs a model without the removed async path suffix', async () => {
    const payload = {code: 0, data: {[taskIdProperty]: 'task-test'}, message: 'success'}
    setJsonResponse(payload)

    expect(
      await runModel({
        apiKey: 'run-test-key',
        body: {prompt: 'A harmless test prompt'},
        modelSlug: 'bytedance/seedream-5.0-lite',
      }),
    ).to.deep.equal(payload)
    expect(receivedMethod).to.equal('POST')
    expect(receivedPath).to.equal('/api/v1/bytedance/seedream-5.0-lite')
    expect(receivedPath).not.to.contain('/async')
    expect(receivedBody).to.equal(JSON.stringify({prompt: 'A harmless test prompt'}))
  })

  it('keeps invokeModelAsync compatible while using the path without async', async () => {
    setJsonResponse({code: 0, data: {[taskIdProperty]: 'task-test'}, message: 'success'})

    await invokeModelAsync({
      apiKey: 'invoke-test-key',
      body: {prompt: 'A harmless test prompt'},
      modelSlug: 'bytedance/seedream-5.0-lite',
    })

    expect(receivedPath).to.equal('/api/v1/bytedance/seedream-5.0-lite')
    expect(receivedPath).not.to.contain('/async')
  })

  it('rejects a successful HTTP response that is not JSON', async () => {
    __setHttpRequesterForTest(async (options) => {
      recordRequest(options)
      return {bodyText: '<html>not json</html>', headers: {}, statusCode: 200}
    })

    const error = await captureError(() => listModels({apiKey: 'list-test-key'}))
    expect(error.message).to.match(/JSON|response/i)
  })

  it('passes a bounded request deadline to task polling', async () => {
    let receivedTimeout = 0
    __setHttpRequesterForTest(async (options) => {
      receivedTimeout = options.timeoutMs
      return {
        bodyText: '{"code":0,"data":{"status":"pending","task_id":"task-timeout"},"message":"success"}',
        headers: {},
        statusCode: 200,
      }
    })

    await getTaskResult({apiKey: 'timeout-test-key', taskId: 'task-timeout', timeoutMs: 2500})
    expect(receivedTimeout).to.equal(2500)

    await getTaskResult({apiKey: 'timeout-test-key', taskId: 'task-timeout', timeoutMs: 30_000})
    expect(receivedTimeout).to.equal(15_000)
  })

  it('retries safe GET requests for temporary server errors', async () => {
    let attempts = 0
    __setHttpRequesterForTest(async (options) => {
      attempts += 1
      recordRequest(options)
      if (attempts < 3) {
        return {bodyText: '{"message":"temporary"}', headers: {}, statusCode: 503}
      }

      return {bodyText: '{"models":[]}', headers: {}, statusCode: 200}
    })

    expect(await listModels({apiKey: 'retry-test-key'})).to.deep.equal({models: []})
    expect(attempts).to.equal(3)
  })

  it('does not retry paid POST requests', async () => {
    let attempts = 0
    __setHttpRequesterForTest(async () => {
      attempts += 1
      return {bodyText: '{"message":"temporary"}', headers: {}, statusCode: 503}
    })

    const error = await captureError(() =>
      runModel({
        apiKey: 'paid-post-test-key',
        body: {prompt: 'Do not retry this request'},
        modelSlug: 'test/model',
      }),
    )

    expect(error.message).to.contain('503')
    expect(error).to.be.instanceOf(PaidSubmissionOutcomeUnknownError)
    expect((error as PaidSubmissionOutcomeUnknownError).safeToRetry).to.equal(false)
    expect(error.message).to.match(/do not submit/i)
    expect(attempts).to.equal(1)
  })

  it('treats ambiguous paid HTTP statuses as outcome unknown', async () => {
    __setHttpRequesterForTest(async () => ({bodyText: '', headers: {}, statusCode: 408}))

    const error = await captureError(() =>
      runModel({apiKey: 'paid-timeout-key', body: {prompt: 'cat'}, modelSlug: 'test/model'}),
    )

    expect(error).to.be.instanceOf(PaidSubmissionOutcomeUnknownError)
    expect(error.message).to.contain('HTTP 408')
  })

  it('does not retry a response-size protocol failure', async () => {
    let attempts = 0
    __setHttpRequesterForTest(async () => {
      attempts += 1
      throw new ApiResponseSizeLimitError()
    })

    const error = await captureError(() => listModels({apiKey: 'large-response-key'}))
    expect(error).to.be.instanceOf(ApiResponseSizeLimitError)
    expect(attempts).to.equal(1)
  })

  it('marks an oversized paid response as outcome unknown', async () => {
    __setHttpRequesterForTest(async () => {
      throw new ApiResponseSizeLimitError()
    })

    const error = await captureError(() =>
      runModel({apiKey: 'paid-large-key', body: {prompt: 'cat'}, modelSlug: 'test/model'}),
    )
    expect(error).to.be.instanceOf(PaidSubmissionOutcomeUnknownError)
  })

  it('marks a successful paid response without a task ID as unsafe to retry', async () => {
    setJsonResponse({code: 0, data: {}, message: 'success'})

    const error = await captureError(() =>
      runModel({apiKey: 'unknown-outcome-key', body: {prompt: 'private'}, modelSlug: 'test/model'}),
    )

    expect(error).to.be.instanceOf(PaidSubmissionOutcomeUnknownError)
    expect(error.message).to.match(/task ID|do not submit/i)
    expect(error.message).not.to.contain('unknown-outcome-key')
    expect(error.message).not.to.contain('private')
  })

  it('uses a validated custom base URL without logging secrets or request bodies', async () => {
    const debugMessages: string[] = []
    let receivedBaseUrl = ''
    process.env.MODELLIX_BASE_URL = 'http://127.0.0.1:8787'
    process.env.MODELLIX_CLI_HTTP_DEBUG = '1'
    __setDebugWriterForTest((message) => debugMessages.push(message))
    __setHttpRequesterForTest(async (options) => {
      receivedBaseUrl = options.baseUrl
      return {
        bodyText: '{"code":0,"data":{"task_id":"task-local"},"message":"success"}',
        headers: {},
        statusCode: 200,
      }
    })

    await runModel({
      apiKey: 'custom-base-url-secret-key',
      body: {prompt: 'private prompt'},
      modelSlug: 'test/model',
    })

    const debugOutput = debugMessages.join('')
    expect(receivedBaseUrl).to.equal('http://127.0.0.1:8787')
    expect(debugOutput).to.contain('POST /api/v1/test/model')
    expect(debugOutput).not.to.contain('custom-base-url-secret-key')
    expect(debugOutput).not.to.contain('private prompt')
  })

  it('rejects insecure non-local custom base URLs before making a request', async () => {
    process.env.MODELLIX_BASE_URL = 'http://api.example.test'
    let attempts = 0
    __setHttpRequesterForTest(async () => {
      attempts += 1
      return {bodyText: '{"models":[]}', headers: {}, statusCode: 200}
    })

    const error = await captureError(() => listModels({apiKey: 'base-url-test-key'}))
    expect(error.message).to.match(/HTTPS|base URL/i)
    expect(attempts).to.equal(0)
  })

  it('removes terminal controls from API messages and rate-limit headers', async () => {
    __setHttpRequesterForTest(async () => ({
      bodyText: JSON.stringify({message: 'bad\u009Bmessage\u202E'}),
      headers: {'x-ratelimit-reset': 'soon\u009BFAKE'},
      statusCode: 429,
    }))

    const error = await captureError(() => getTaskResult({apiKey: 'control-key', taskId: 'task'}))
    expect(error.message).not.to.contain('\u009B')
    expect(error.message).not.to.contain('\u202E')
  })

  function recordRequest(options: {
    apiKey: string
    body?: string
    method: string
    path: string
  }): void {
    receivedApiKey = options.apiKey
    receivedBody = options.body
    receivedMethod = options.method
    receivedPath = options.path
  }

  function setJsonResponse(payload: unknown): void {
    __setHttpRequesterForTest(async (options) => {
      recordRequest(options)
      return {bodyText: JSON.stringify(payload), headers: {}, statusCode: 200}
    })
  }
})

async function captureError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation()
  } catch (error) {
    expect(error).to.be.instanceOf(Error)
    return error as Error
  }

  throw new Error('Expected operation to reject')
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
