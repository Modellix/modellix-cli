import {createReadStream} from 'node:fs'
import {type Readable} from 'node:stream'

import {assertJsonValue} from './json-value.js'
import {
  type JsonValue,
  MAX_API_REQUEST_BYTES,
  parseModelSlug,
} from './modellix-client.js'
import {normalizeSafeText} from './safe-text.js'

export type ModelBatchEntry = {
  body: JsonValue
  modelSlug: string
}

export const DEFAULT_BATCH_INPUT_MAX_BYTES = 64 * 1024 * 1024
export const DEFAULT_BATCH_MAX_TASKS = 1000

type ModelBatchLimits = {
  maxBodyBytes?: number
  maxBytes?: number
  maxTasks?: number
}

export async function mapWithConcurrency<T, U>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<U>,
  options: {
    mapSkipped?: (value: T, index: number) => U
    stopWhen?: (result: U) => boolean
  } = {},
): Promise<U[]> {
  const results: U[] = []
  let nextIndex = 0
  let stopped = false
  const worker = async (): Promise<void> => {
    while (!stopped && nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      // Each worker is intentionally sequential; workers themselves run concurrently.
      // eslint-disable-next-line no-await-in-loop
      const result = await mapper(values[index], index)
      results[index] = result
      if (options.stopWhen?.(result)) stopped = true
    }
  }

  await Promise.all(
    Array.from({length: Math.min(concurrency, values.length)}, async () => worker()),
  )
  if (options.mapSkipped) {
    for (const [index, value] of values.entries()) {
      if (!(index in results)) results[index] = options.mapSkipped(value, index)
    }
  }

  return results
}

export async function readModelBatch(
  filePath: string,
  stdin: Readable & {isTTY?: boolean} = process.stdin,
  limits: ModelBatchLimits = {},
): Promise<ModelBatchEntry[]> {
  const maxBytes = limits.maxBytes ?? DEFAULT_BATCH_INPUT_MAX_BYTES
  const maxBodyBytes = limits.maxBodyBytes ?? MAX_API_REQUEST_BYTES
  const maxTasks = limits.maxTasks ?? DEFAULT_BATCH_MAX_TASKS
  assertPositiveByteLimit(maxBytes)
  assertPositiveByteLimit(maxBodyBytes)
  if (!Number.isSafeInteger(maxTasks) || maxTasks <= 0 || maxTasks > DEFAULT_BATCH_MAX_TASKS) {
    throw new Error(`Batch task limit must be between 1 and ${DEFAULT_BATCH_MAX_TASKS}.`)
  }

  const content = filePath === '-'
    ? await readStdin(stdin, maxBytes)
    : await readBatchFile(filePath, maxBytes)
  const entries: ModelBatchEntry[] = []
  for (const {lineNumber, rawLine} of iterateLines(content)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    if (entries.length >= maxTasks) {
      throw new Error(`Batch input exceeds the --max-tasks limit of ${maxTasks}.`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new Error(`Invalid JSON on line ${lineNumber} of the batch input.`)
    }

    entries.push(validateBatchEntry(parsed, lineNumber, maxBodyBytes))
  }

  if (entries.length === 0) {
    throw new Error('Batch input does not contain any tasks.')
  }

  return entries
}

function* iterateLines(content: string): Generator<{lineNumber: number; rawLine: string}> {
  let lineNumber = 1
  let lineStart = 0
  for (let index = 0; index <= content.length; index += 1) {
    if (index < content.length && content[index] !== '\n') continue
    const lineEnd = index > lineStart && content[index - 1] === '\r' ? index - 1 : index
    yield {lineNumber, rawLine: content.slice(lineStart, lineEnd)}
    lineNumber += 1
    lineStart = index + 1
  }
}

async function readBatchFile(filePath: string, maxBytes: number): Promise<string> {
  try {
    return await readLimitedStream(createReadStream(filePath), maxBytes)
  } catch (error) {
    if (error instanceof BatchInputSizeLimitError) throw error
    throw new Error(`Unable to read batch input at path: ${filePath}`)
  }
}

async function readStdin(
  stdin: Readable & {isTTY?: boolean},
  maxBytes: number,
): Promise<string> {
  if (stdin.isTTY) {
    throw new Error('Cannot read batch input from an interactive terminal. Pipe JSONL to stdin.')
  }

  return readLimitedStream(stdin, maxBytes)
}

async function readLimitedStream(stream: Readable, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    totalBytes += buffer.length
    if (totalBytes > maxBytes) {
      stream.destroy()
      throw new BatchInputSizeLimitError(
        `Batch input exceeds the ${maxBytes}-byte limit.`,
      )
    }

    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

class BatchInputSizeLimitError extends Error {}

function assertPositiveByteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Batch input byte limit must be a positive safe integer.')
  }
}

function validateBatchEntry(
  value: unknown,
  lineNumber: number,
  maxBodyBytes: number,
): ModelBatchEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid task on line ${lineNumber}: expected a JSON object.`)
  }

  const record = value as Record<string, unknown>
  if (typeof record.modelSlug !== 'string') {
    throw new TypeError(`Invalid task on line ${lineNumber}: modelSlug must be a non-empty string.`)
  }

  let modelSlug: string
  try {
    modelSlug = normalizeSafeText(record.modelSlug, `Model slug on line ${lineNumber}`, 256)
    parseModelSlug(modelSlug)
  } catch (error) {
    throw new Error(
      `Invalid task on line ${lineNumber}: ${error instanceof Error ? error.message : 'modelSlug is invalid.'}`,
    )
  }

  if (!Object.hasOwn(record, 'body')) {
    throw new Error(`Invalid task on line ${lineNumber}: body must be valid JSON.`)
  }

  try {
    assertJsonValue(record.body, `Body on line ${lineNumber}`)
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : ''
    throw new Error(`Invalid task on line ${lineNumber}: body must be valid JSON.${detail}`)
  }

  if (typeof record.body !== 'object' || record.body === null || Array.isArray(record.body)) {
    throw new TypeError(`Invalid task on line ${lineNumber}: body must be a JSON object.`)
  }

  if (Buffer.byteLength(JSON.stringify(record.body)) > maxBodyBytes) {
    throw new Error(`Invalid task on line ${lineNumber}: body exceeds the ${maxBodyBytes}-byte limit.`)
  }

  return {body: record.body, modelSlug}
}
