import type {IncomingHttpHeaders} from 'node:http'

import {request as requestHttp} from 'node:http'
import {request} from 'node:https'
import {setTimeout as delay} from 'node:timers/promises'

import {assertJsonValue} from './json-value.js'
import {
  normalizeApiKey,
  normalizeSafeText,
  normalizeTaskId,
  sanitizeTerminalText,
} from './safe-text.js'

export const MODELLIX_BASE_URL_ENV = 'MODELLIX_BASE_URL'

export const DEFAULT_BASE_URL = 'https://api.modellix.ai'
const REQUEST_TIMEOUT_MS = 15_000
const GET_MAX_ATTEMPTS = 3
const MAX_API_RESPONSE_BYTES = 16 * 1024 * 1024
export const MAX_API_REQUEST_BYTES = 64 * 1024 * 1024
const RETRY_BASE_DELAY_MS = 1000
const RETRY_MAX_DELAY_MS = 10_000

export type JsonValue = boolean | JsonValue[] | null | number | string | {[key: string]: JsonValue}

type HttpRequestOptions = {
  apiKey: string
  baseUrl: string
  body?: string
  method: 'GET' | 'POST'
  path: string
  timeoutMs: number
}

type HttpResponse = {
  bodyText: string
  headers: IncomingHttpHeaders
  statusCode: number
}

type RequestOptions = {
  apiKey: string
  body?: JsonValue
  method: 'GET' | 'POST'
  path: string
  timeoutMs?: number
}

export type RunModelInput = {
  apiKey: string
  body: JsonValue
  modelSlug: string
}

export type InvokeModelAsyncInput = RunModelInput

export class PaidSubmissionOutcomeUnknownError extends Error {
  readonly safeToRetry = false

  constructor(reason: string) {
    super(
      `${reason} The paid submission outcome is unknown. Do not submit the same request again until you verify whether a task was created.`,
    )
    this.name = 'PaidSubmissionOutcomeUnknownError'
  }
}

export class ApiResponseSizeLimitError extends Error {
  constructor() {
    super(`API response exceeds the ${MAX_API_RESPONSE_BYTES}-byte limit.`)
    this.name = 'ApiResponseSizeLimitError'
  }
}

export class RetryableReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetryableReadError'
  }
}

type ApiKeyInput = {
  apiKey: string
}

let httpRequester: (options: HttpRequestOptions) => Promise<HttpResponse> = performHttpRequest
let retryDelay: (milliseconds: number) => Promise<unknown> = delay
let debugWriter: (message: string) => void = (message) => process.stderr.write(message)

export function __setHttpRequesterForTest(
  requester?: (options: HttpRequestOptions) => Promise<HttpResponse>,
): void {
  httpRequester = requester ?? performHttpRequest
}

export function __setRetryDelayForTest(
  testDelay?: (milliseconds: number) => Promise<unknown>,
): void {
  retryDelay = testDelay ?? delay
}

export function __setDebugWriterForTest(testWriter?: (message: string) => void): void {
  debugWriter = testWriter ?? ((message) => process.stderr.write(message))
}

export async function runModel(input: RunModelInput): Promise<JsonValue> {
  const {modelId, provider} = parseModelSlug(input.modelSlug)
  const path = `/api/v1/${encodeURIComponent(provider)}/${encodeURIComponent(modelId)}`

  const response = await requestJson({
    apiKey: input.apiKey,
    body: input.body,
    method: 'POST',
    path,
  })
  const data = isRecord(response) && isRecord(response.data) ? response.data : undefined
  if (typeof data?.task_id !== 'string') {
    throw new PaidSubmissionOutcomeUnknownError(
      'Modellix returned a successful response without a usable task ID.',
    )
  }

  try {
    normalizeTaskId(data.task_id, 'Modellix task ID')
  } catch {
    throw new PaidSubmissionOutcomeUnknownError(
      'Modellix returned a successful response without a usable task ID.',
    )
  }

  return response
}

export async function invokeModelAsync(input: InvokeModelAsyncInput): Promise<JsonValue> {
  return runModel(input)
}

export function parseModelSlug(modelSlug: string): {modelId: string; provider: string} {
  let trimmed: string
  try {
    trimmed = normalizeSafeText(modelSlug, 'Model slug', 256)
  } catch {
    throw new Error(
      'Invalid model slug. Use provider/model format without control characters.',
    )
  }

  const segments = trimmed.split('/')
  if (segments.length !== 2) {
    throw new Error(
      'Invalid model slug. Use provider/model format, for example bytedance/seedream-4.5-t2i.',
    )
  }

  const provider = segments[0].trim()
  const modelId = segments[1].trim()
  if (!provider || !modelId) {
    throw new Error(
      'Invalid model slug. Use provider/model format, for example bytedance/seedream-4.5-t2i.',
    )
  }

  return {modelId, provider}
}

export async function getTaskResult(input: {
  apiKey: string
  taskId: string
  timeoutMs?: number
}): Promise<JsonValue> {
  const path = `/api/v1/tasks/${encodeURIComponent(input.taskId)}`
  return requestJson({apiKey: input.apiKey, method: 'GET', path, timeoutMs: input.timeoutMs})
}

export async function listModels(input: ApiKeyInput): Promise<JsonValue> {
  return requestJson({apiKey: input.apiKey, method: 'GET', path: '/api/v1/models'})
}

export async function validateApiKey(input: ApiKeyInput): Promise<boolean> {
  const payload = await requestJson({
    apiKey: input.apiKey,
    method: 'GET',
    path: '/api/v1/apikey/validate',
  })
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : undefined

  if (typeof data?.is_valid !== 'boolean') {
    throw new TypeError(
      'Modellix API protocol error: expected data.is_valid to be a boolean.',
    )
  }

  return data.is_valid
}

export async function getTeamBalance(input: ApiKeyInput): Promise<number> {
  const payload = await requestJson({
    apiKey: input.apiKey,
    method: 'GET',
    path: '/api/v1/team/balance',
  })
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : undefined

  if (typeof data?.balance !== 'number' || !Number.isFinite(data.balance)) {
    throw new TypeError('Modellix API protocol error: expected data.balance to be a number.')
  }

  return data.balance
}

// Retry, deadline, and paid-submission safety branches are intentionally centralized here.
// eslint-disable-next-line complexity
async function requestJson(options: RequestOptions): Promise<JsonValue> {
  const apiKey = normalizeApiKey(options.apiKey)
  let body: string | undefined
  if (options.body !== undefined) {
    assertJsonValue(options.body, 'Model request body')
    body = JSON.stringify(options.body)
    if (Buffer.byteLength(body) > MAX_API_REQUEST_BYTES) {
      throw new Error(`Model request body exceeds the ${MAX_API_REQUEST_BYTES}-byte limit.`)
    }
  }

  const baseUrl = resolveBaseUrl()
  const totalTimeoutMs = Math.max(
    1,
    Math.min(options.timeoutMs ?? REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS),
  )
  const deadline = Date.now() + totalTimeoutMs
  const maxAttempts = options.method === 'GET' ? GET_MAX_ATTEMPTS : 1
  let lastNetworkError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      break
    }

    debugRequest(`request ${options.method} ${options.path} attempt ${attempt}/${maxAttempts}`)
    const startedAt = Date.now()
    let response: HttpResponse
    try {
      // Sequential retries are intentional and share one wall-clock deadline.
      // eslint-disable-next-line no-await-in-loop
      response = await httpRequester({
        apiKey,
        baseUrl,
        body,
        method: options.method,
        path: options.path,
        timeoutMs: remainingMs,
      })
    } catch (error) {
      if (error instanceof ApiResponseSizeLimitError) {
        if (options.method === 'POST') {
          throw new PaidSubmissionOutcomeUnknownError(
            'The paid submission response exceeded the safe response-size limit.',
          )
        }

        throw error
      }

      lastNetworkError = error
      debugRequest(
        `network failure ${options.method} ${options.path} after ${Date.now() - startedAt}ms`,
      )
      if (attempt >= maxAttempts) {
        break
      }

      const waitMs = boundedRetryDelay(attempt, undefined, deadline)
      if (waitMs === undefined) {
        break
      }

      // eslint-disable-next-line no-await-in-loop
      await retryDelay(waitMs)
      continue
    }

    debugRequest(
      `response ${response.statusCode} ${options.method} ${options.path} after ${Date.now() - startedAt}ms`,
    )
    const data = tryParseResponseJson(response.bodyText)
    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (data === undefined) {
        if (options.method === 'POST') {
          throw new PaidSubmissionOutcomeUnknownError(
            'Modellix returned a successful HTTP response that was not valid JSON.',
          )
        }

        throw new Error('Modellix API protocol error: expected a JSON response.')
      }

      return data
    }

    if (attempt < maxAttempts && isRetryableStatus(response.statusCode)) {
      const waitMs = boundedRetryDelay(attempt, response.headers, deadline)
      if (waitMs !== undefined) {
        debugRequest(`retrying ${options.method} ${options.path} in ${waitMs}ms`)
        // eslint-disable-next-line no-await-in-loop
        await retryDelay(waitMs)
        continue
      }
    }

    if (options.method === 'POST' && !isDefinitelyRejectedSubmission(response.statusCode)) {
      throw new PaidSubmissionOutcomeUnknownError(
        `Modellix returned HTTP ${response.statusCode} after the request was sent.`,
      )
    }

    const apiErrorMessage = redactSecret(
      buildApiErrorMessage(response, data ?? null, options.method),
      apiKey,
    )
    if (options.method === 'GET' && isRetryableStatus(response.statusCode)) {
      throw new RetryableReadError(apiErrorMessage)
    }

    throw new Error(apiErrorMessage)
  }

  const detail = lastNetworkError instanceof Error
    ? ` ${redactSecret(lastNetworkError.message, apiKey)}`
    : ''
  if (options.method === 'POST') {
    throw new PaidSubmissionOutcomeUnknownError(
      'The connection failed after the model submission started.',
    )
  }

  throw new RetryableReadError(`Network request failed.${detail} Please retry.`)
}

async function performHttpRequest(options: HttpRequestOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path, `${options.baseUrl}/`)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.apiKey}`,
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = String(Buffer.byteLength(options.body))
    }

    // Assigned after request creation because its callback needs the request instance.
    // eslint-disable-next-line prefer-const
    let deadline: NodeJS.Timeout
    let settled = false
    const clearDeadline = (): void => clearTimeout(deadline)
    const rejectRequest = (error: Error): void => {
      if (settled) return
      settled = true
      clearDeadline()
      reject(error)
    }

    const resolveRequest = (response: HttpResponse): void => {
      if (settled) return
      settled = true
      clearDeadline()
      resolve(response)
    }

    const requester = url.protocol === 'http:' ? requestHttp : request
    const req = requester(
      url,
      {
        headers,
        method: options.method,
      },
      (res) => {
        const chunks: Buffer[] = []
        let responseBytes = 0
        res.on('aborted', () => rejectRequest(new Error('Response was aborted.')))
        res.on('error', rejectRequest)
        res.on('data', (chunk) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          responseBytes += buffer.length
          if (responseBytes > MAX_API_RESPONSE_BYTES) {
            res.destroy()
            rejectRequest(new ApiResponseSizeLimitError())
            return
          }

          chunks.push(buffer)
        })
        res.on('end', () => {
          const bodyText = Buffer.concat(chunks).toString('utf8')
          resolveRequest({
            bodyText,
            headers: res.headers,
            statusCode: res.statusCode ?? 0,
          })
        })
      },
    )

    deadline = setTimeout(() => {
      req.destroy(new Error(`Request timed out after ${options.timeoutMs / 1000} seconds.`))
    }, options.timeoutMs)
    deadline.unref()
    req.on('error', rejectRequest)
    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${options.timeoutMs / 1000} seconds.`))
    })
    if (options.body !== undefined) {
      req.write(options.body)
    }

    req.end()
  })
}

export function resolveBaseUrl(explicitBaseUrl?: string): string {
  const configured = explicitBaseUrl?.trim() || process.env[MODELLIX_BASE_URL_ENV]?.trim()
  const rawBaseUrl = configured || DEFAULT_BASE_URL
  let url: URL
  try {
    url = new URL(rawBaseUrl)
  } catch {
    throw new Error('Invalid Modellix API base URL.')
  }

  const isLocalHttp =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('Modellix API base URL must use HTTPS (HTTP is allowed only for localhost).')
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Modellix API base URL must not include credentials, query parameters, or a fragment.')
  }

  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('Modellix API base URL must be an origin without a path.')
  }

  return url.origin
}

function debugRequest(message: string): void {
  const debug = process.env.MODELLIX_CLI_HTTP_DEBUG === '1'
  if (!debug && process.env.MODELLIX_CLI_VERBOSE !== '1') {
    return
  }

  debugWriter(`[modellix:${debug ? 'debug' : 'verbose'}] ${message}\n`)
}

function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504
}

function isDefinitelyRejectedSubmission(statusCode: number): boolean {
  return [400, 401, 402, 403, 404, 405, 413, 415, 422, 429].includes(statusCode)
}

function boundedRetryDelay(
  attempt: number,
  headers: IncomingHttpHeaders | undefined,
  deadline: number,
): number | undefined {
  const retryAfterMs = headers ? parseRetryAfter(headers) : undefined
  const exponentialMs = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS)
  const requestedMs = Math.min(retryAfterMs ?? exponentialMs, RETRY_MAX_DELAY_MS)
  const remainingMs = deadline - Date.now() - 1
  return remainingMs < 0 ? undefined : Math.max(0, Math.min(requestedMs, remainingMs))
}

function parseRetryAfter(headers: IncomingHttpHeaders): number | undefined {
  const value = firstHeaderValue(headers['retry-after'])
  if (!value) {
    return
  }

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000
  }

  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function redactSecret(message: string, secret: string): string {
  const normalizedSecret = secret.trim()
  return normalizedSecret ? message.replaceAll(normalizedSecret, '[REDACTED]') : message
}

function tryParseResponseJson(bodyText: string): JsonValue | undefined {
  if (!bodyText) {
    return
  }

  try {
    const parsed = JSON.parse(bodyText) as unknown
    assertJsonValue(parsed, 'Modellix API response')
    return parsed
  } catch {
    // The caller distinguishes invalid JSON from a valid JSON null response.
  }
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractMessage(payload: JsonValue): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return
  }

  const maybeMessage = payload.message
  return typeof maybeMessage === 'string' ? maybeMessage : undefined
}

function buildApiErrorMessage(
  response: HttpResponse,
  payload: JsonValue,
  method: 'GET' | 'POST',
): string {
  const {statusCode} = response
  const extractedMessage = method === 'GET' ? sanitizeApiMessage(extractMessage(payload)) : undefined
  const detail = extractedMessage ? ` ${extractedMessage}.` : ''

  switch (statusCode) {
    case 400: {
      return `Modellix API error (400 Bad Request).${detail} Check required parameters and payload format.`
    }

    case 401: {
      return `Modellix API error (401 Unauthorized).${detail} Verify your API key.`
    }

    case 402: {
      return `Modellix API error (402 Payment Required).${detail} Recharge your account before retrying.`
    }

    case 404: {
      return `Modellix API error (404 Not Found).${detail} Verify task ID, model type, provider, and model ID.`
    }

    case 429: {
      const resetHeader = response.headers['x-ratelimit-reset']
      const rawResetAt = Array.isArray(resetHeader) ? resetHeader[0] : resetHeader
      const resetAt = rawResetAt ? sanitizeTerminalText(rawResetAt, 64).trim() : ''
      const resetHint = resetAt ? ` Retry after X-RateLimit-Reset=${resetAt}.` : ''
      const retryHint = method === 'GET'
        ? ' Automatic read retries were exhausted.'
        : ' The CLI did not retry this paid submission; verify account activity before trying later.'
      return `Modellix API error (429 Too Many Requests).${detail}${retryHint}${resetHint}`
    }

    case 500: {
      return `Modellix API error (500 Internal Server Error).${detail} Automatic read retries were exhausted.`
    }

    case 503: {
      return `Modellix API error (503 Service Unavailable).${detail} Automatic read retries were exhausted.`
    }

    default: {
      return `Modellix API error (${statusCode}).${detail} Inspect the request parameters and account state.`
    }
  }
}

function sanitizeApiMessage(message: string | undefined): string | undefined {
  if (!message) return
  const withoutControls = sanitizeTerminalText(message, 2000).trim()
  const redactedUrls = withoutControls.replaceAll(
    /([?&](?:api[_-]?key|authorization|key|sig|signature|token)=)[^&\s]*/gi,
    '$1[REDACTED]',
  )
  return redactedUrls.slice(0, 300)
}
