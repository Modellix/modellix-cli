import {createReadStream} from 'node:fs'
import {type Readable} from 'node:stream'

import {assertJsonValue} from './json-value.js'
import {type JsonValue, MAX_API_REQUEST_BYTES} from './modellix-client.js'

type ParseModelInvokeBodyInput = {
  bodyFile?: string
  bodyText?: string
  maxBytes?: number
  stdin?: Readable & {isTTY?: boolean}
}

export const DEFAULT_MODEL_BODY_MAX_BYTES = MAX_API_REQUEST_BYTES

export async function parseModelInvokeBody(input: ParseModelInvokeBodyInput): Promise<JsonValue> {
  const maxBytes = input.maxBytes ?? DEFAULT_MODEL_BODY_MAX_BYTES
  assertPositiveByteLimit(maxBytes)
  const hasText = Boolean(input.bodyText?.trim())
  const hasFile = Boolean(input.bodyFile?.trim())

  if (!hasText && !hasFile) {
    throw new Error('Missing request body. Provide --body or --body-file.')
  }

  if (hasText && hasFile) {
    throw new Error('Use either --body or --body-file, not both.')
  }

  if (hasText) {
    assertContentSize(input.bodyText!, maxBytes, 'Model request body')
    return parseJson(input.bodyText!, '--body')
  }

  const filePath = input.bodyFile!.trim()
  if (filePath === '-') {
    const stdin = input.stdin ?? process.stdin
    if (stdin.isTTY) {
      throw new Error('Cannot read --body-file - from an interactive terminal. Pipe JSON to stdin.')
    }

    return parseJson(await readStream(stdin, maxBytes, 'Model request body'), '--body-file')
  }

  let fileContent: string
  try {
    fileContent = await readStream(
      createReadStream(filePath),
      maxBytes,
      'Model request body',
    )
  } catch (error) {
    if (error instanceof InputSizeLimitError) throw error
    throw new Error(`Unable to read --body-file at path: ${filePath}`)
  }

  return parseJson(fileContent, '--body-file')
}

async function readStream(stream: Readable, maxBytes: number, label: string): Promise<string> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    totalBytes += buffer.length
    if (totalBytes > maxBytes) {
      stream.destroy()
      throw new InputSizeLimitError(`${label} exceeds the ${maxBytes}-byte limit.`)
    }

    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

class InputSizeLimitError extends Error {}

function assertContentSize(content: string, maxBytes: number, label: string): void {
  if (Buffer.byteLength(content) > maxBytes) {
    throw new InputSizeLimitError(`${label} exceeds the ${maxBytes}-byte limit.`)
  }
}

function assertPositiveByteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Model request body byte limit must be a positive safe integer.')
  }
}

function parseJson(raw: string, sourceLabel: '--body' | '--body-file'): JsonValue {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new Error(`Invalid JSON from ${sourceLabel}.`)
  }

  assertJsonValue(parsed, `JSON from ${sourceLabel}`)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`JSON from ${sourceLabel} must be an object.`)
  }

  return parsed
}
