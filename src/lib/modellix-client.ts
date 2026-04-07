import type {IncomingHttpHeaders} from 'node:http'

import {request} from 'node:https'

const BASE_URL = 'https://api.modellix.ai'

export type JsonValue = boolean | JsonValue[] | null | number | string | {[key: string]: JsonValue}

type HttpRequestOptions = {
  apiKey: string
  body?: string
  method: 'GET' | 'POST'
  path: string
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
}

export type InvokeModelAsyncInput = {
  apiKey: string
  body: JsonValue
  modelSlug: string
  modelType: string
}

let httpRequester: (options: HttpRequestOptions) => Promise<HttpResponse> = performHttpRequest

export function __setHttpRequesterForTest(
  requester?: (options: HttpRequestOptions) => Promise<HttpResponse>,
): void {
  httpRequester = requester ?? performHttpRequest
}

export async function invokeModelAsync(input: InvokeModelAsyncInput): Promise<JsonValue> {
  const modelType = encodeURIComponent(input.modelType)
  const {modelId, provider} = parseModelSlug(input.modelSlug)
  const path = `/api/v1/${modelType}/${encodeURIComponent(provider)}/${encodeURIComponent(modelId)}/async`

  return requestJson({
    apiKey: input.apiKey,
    body: input.body,
    method: 'POST',
    path,
  })
}

function parseModelSlug(modelSlug: string): {modelId: string; provider: string} {
  const trimmed = modelSlug.trim()
  const slashIndex = trimmed.indexOf('/')
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
    throw new Error(
      'Invalid model slug. Use provider/model format, for example bytedance/seedream-4.5-t2i.',
    )
  }

  const provider = trimmed.slice(0, slashIndex).trim()
  const modelId = trimmed.slice(slashIndex + 1).trim()
  if (!provider || !modelId) {
    throw new Error(
      'Invalid model slug. Use provider/model format, for example bytedance/seedream-4.5-t2i.',
    )
  }

  return {modelId, provider}
}

export async function getTaskResult(input: {apiKey: string; taskId: string}): Promise<JsonValue> {
  const path = `/api/v1/tasks/${encodeURIComponent(input.taskId)}`
  return requestJson({apiKey: input.apiKey, method: 'GET', path})
}

async function requestJson(options: RequestOptions): Promise<JsonValue> {
  let body: string | undefined
  if (options.body !== undefined) {
    body = JSON.stringify(options.body)
  }

  let response: HttpResponse
  try {
    response = await httpRequester({
      apiKey: options.apiKey,
      body,
      method: options.method,
      path: options.path,
    })
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : ''
    throw new Error(`Network request failed.${detail} Please retry.`)
  }

  const data = parseResponseJson(response.bodyText)
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(buildApiErrorMessage(response, data))
  }

  return data
}

async function performHttpRequest(options: HttpRequestOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${options.path}`)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.apiKey}`,
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = String(Buffer.byteLength(options.body))
    }

    const req = request(
      url,
      {
        headers,
        method: options.method,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        res.on('end', () => {
          const bodyText = Buffer.concat(chunks).toString('utf8')
          resolve({
            bodyText,
            headers: res.headers,
            statusCode: res.statusCode ?? 0,
          })
        })
      },
    )

    req.on('error', reject)
    if (options.body !== undefined) {
      req.write(options.body)
    }

    req.end()
  })
}

function parseResponseJson(bodyText: string): JsonValue {
  if (!bodyText) {
    return null
  }

  try {
    return JSON.parse(bodyText) as JsonValue
  } catch {
    return null
  }
}

function extractMessage(payload: JsonValue): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return
  }

  const maybeMessage = payload.message
  return typeof maybeMessage === 'string' ? maybeMessage : undefined
}

function buildApiErrorMessage(response: HttpResponse, payload: JsonValue): string {
  const {statusCode} = response
  const extractedMessage = extractMessage(payload)
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
      const resetAt = Array.isArray(resetHeader) ? resetHeader[0] : resetHeader
      const resetHint = resetAt ? ` Retry after X-RateLimit-Reset=${resetAt}.` : ''
      return `Modellix API error (429 Too Many Requests).${detail} Retry with exponential backoff (1s, 2s, 4s).${resetHint}`
    }

    case 500: {
      return `Modellix API error (500 Internal Server Error).${detail} Retry up to 3 times with exponential backoff (1s, 2s, 4s).`
    }

    case 503: {
      return `Modellix API error (503 Service Unavailable).${detail} Retry with exponential backoff (1s, 2s, 4s).`
    }

    default: {
      return `Modellix API error (${statusCode}).${detail} Please retry or inspect request parameters.`
    }
  }
}
