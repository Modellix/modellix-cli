import type {JsonValue} from './modellix-client.js'

import {normalizeSafeText, sanitizeTerminalText} from './safe-text.js'

export type ModelSchema = {
  endpoint: string
  post: ModelSchemaPost
  raw: {[key: string]: JsonValue}
}

type ModelSchemaPost = {
  [key: string]: JsonValue
  requestBody: {[key: string]: JsonValue}
  responses: {[key: string]: JsonValue}
}

export function parseModelSchema(payload: JsonValue): ModelSchema {
  if (
    !isRecord(payload)
    || !Array.isArray(payload.servers)
    || !isModelSchemaPost(payload.post)
  ) {
    throw new Error(
      'Invalid response from Modellix schema API: expected servers, post.requestBody, and post.responses fields.',
    )
  }

  const firstServer = payload.servers[0]
  if (!isRecord(firstServer) || typeof firstServer.url !== 'string') {
    throw new Error(
      'Invalid response from Modellix schema API: expected servers[0].url.',
    )
  }

  let endpoint: URL
  try {
    endpoint = new URL(normalizeSafeText(firstServer.url, 'Model inference URL', 2048))
  } catch {
    throw new Error(
      'Invalid response from Modellix schema API: servers[0].url is not a valid URL.',
    )
  }

  const isLocalHttp = endpoint.protocol === 'http:'
    && (endpoint.hostname === 'localhost'
      || endpoint.hostname === '127.0.0.1'
      || endpoint.hostname === '[::1]')
  if (endpoint.protocol !== 'https:' && !isLocalHttp) {
    throw new Error(
      'Invalid response from Modellix schema API: servers[0].url must use HTTPS.',
    )
  }

  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error(
      'Invalid response from Modellix schema API: servers[0].url must not include credentials, query parameters, or a fragment.',
    )
  }

  return {endpoint: endpoint.toString(), post: payload.post, raw: payload}
}

export function formatModelSchemaHuman(modelSlug: string, schema: ModelSchema): string {
  const lines = [
    `model: ${sanitizeTerminalText(modelSlug, 256)}`,
    `endpoint: ${sanitizeTerminalText(schema.endpoint, 2048)}`,
  ]
  const {description, summary} = schema.post
  if (typeof summary === 'string') lines.push(`summary: ${sanitizeTerminalText(summary, 1000)}`)
  if (typeof description === 'string') {
    lines.push(`description: ${sanitizeTerminalText(description, 20_000)}`)
  }

  return [
    ...lines,
    `requestBody: ${JSON.stringify(schema.post.requestBody, null, 2)}`,
    `responses: ${JSON.stringify(schema.post.responses, null, 2)}`,
  ].join('\n')
}

function isRecord(value: JsonValue): value is {[key: string]: JsonValue} {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isModelSchemaPost(value: JsonValue): value is ModelSchemaPost {
  return isRecord(value) && isRecord(value.requestBody) && isRecord(value.responses)
}
