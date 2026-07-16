import {randomUUID} from 'node:crypto'
import {chmod, lstat, mkdir, open, rename, unlink} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {type ConfigPathOptions, getConfigFilePath} from './config.js'
import {withFileLock} from './file-lock.js'
import {InputFileSizeLimitError, readUtf8FileLimited} from './limited-input.js'
import {DEFAULT_BASE_URL} from './modellix-client.js'
import {isSafeStoredText, normalizeSafeText, normalizeTaskId} from './safe-text.js'

const HISTORY_VERSION = 1
const MAX_HISTORY_ENTRIES = 1000
const MAX_HISTORY_FILE_BYTES = 4 * 1024 * 1024

export type TaskHistoryEntry = {
  baseUrl?: string
  createdAt: string
  modelSlug?: string
  profile?: string
  status?: string
  taskId: string
  updatedAt: string
}

export type RecordTaskHistoryInput = {
  baseUrl?: string
  modelSlug?: string
  profile?: string
  status?: string
  taskId: string
}

export type HistoryOptions = ConfigPathOptions & {
  now?: Date
}

export type ClearHistoryOptions = ConfigPathOptions & {
  profile?: string
}

type TaskHistoryFile = {
  entries: TaskHistoryEntry[]
  version: typeof HISTORY_VERSION
}

let historyWriteQueue = Promise.resolve()

export function getTaskHistoryFilePath(options: ConfigPathOptions = {}): string {
  return join(dirname(getConfigFilePath(options)), 'history.json')
}

export async function readTaskHistory(
  options: ConfigPathOptions = {},
): Promise<TaskHistoryEntry[]> {
  const historyPath = getTaskHistoryFilePath(options)
  let contents: string
  try {
    const historyStats = await lstat(historyPath)
    if (!historyStats.isFile() || historyStats.isSymbolicLink()) {
      throw new Error('Task history must be a regular file, not a symbolic link.')
    }

    contents = await readUtf8FileLimited(historyPath, MAX_HISTORY_FILE_BYTES, 'Task history')
    if (process.platform !== 'win32') await chmod(historyPath, 0o600)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return []
    }

    if (error instanceof InputFileSizeLimitError) throw error
    throw new Error(`Unable to read Modellix task history at ${historyPath}.`, {cause: error})
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents) as unknown
  } catch (error) {
    throw new Error(`Invalid JSON in Modellix task history at ${historyPath}.`, {cause: error})
  }

  if (!isHistoryFile(parsed)) {
    throw new Error(`Invalid Modellix task history at ${historyPath}.`)
  }

  return parsed.entries.map((entry) => ({
    createdAt: entry.createdAt,
    taskId: entry.taskId,
    updatedAt: entry.updatedAt,
    ...(entry.baseUrl ? {baseUrl: entry.baseUrl} : {}),
    ...(entry.modelSlug ? {modelSlug: entry.modelSlug} : {}),
    ...(entry.profile ? {profile: entry.profile} : {}),
    ...(entry.status ? {status: entry.status} : {}),
  }))
}

/**
 * Add or update a whitelisted history entry. API keys and request bodies are never accepted or stored.
 */
export async function recordTaskHistory(
  input: RecordTaskHistoryInput,
  options: HistoryOptions = {},
): Promise<TaskHistoryEntry> {
  return (await recordTaskHistoryBatch([input], options))[0]
}

export async function recordTaskHistoryBatch(
  inputs: RecordTaskHistoryInput[],
  options: HistoryOptions = {},
): Promise<TaskHistoryEntry[]> {
  if (inputs.length === 0) return []
  const normalizedInputs = inputs.map((input) => ({
    baseUrl: normalizeHistoryBaseUrl(input.baseUrl),
    modelSlug: normalizeOptional(input.modelSlug, 'Task history model slug', 256),
    profile: normalizeOptional(input.profile, 'Task history profile', 64),
    status: normalizeOptional(input.status, 'Task history status', 64),
    taskId: normalizeTaskId(input.taskId, 'Task history taskId'),
  }))

  const operation = historyWriteQueue.then(async () => {
    const historyPath = getTaskHistoryFilePath(options)
    return withFileLock(historyPath, async () => {
      let entries = await readTaskHistory(options)
      const timestamp = (options.now ?? new Date()).toISOString()
      const recorded: TaskHistoryEntry[] = []
      for (const input of normalizedInputs) {
        const identity = createHistoryIdentity(input)
        const previous = entries.find((entry) => createHistoryIdentity(entry) === identity)
        const modelSlug = input.modelSlug ?? previous?.modelSlug
        const status = input.status ?? previous?.status
        const entry: TaskHistoryEntry = {
          createdAt: previous?.createdAt ?? timestamp,
          taskId: input.taskId,
          updatedAt: timestamp,
          ...(input.baseUrl ? {baseUrl: input.baseUrl} : {}),
          ...(modelSlug ? {modelSlug} : {}),
          ...(input.profile ? {profile: input.profile} : {}),
          ...(status ? {status} : {}),
        }
        entries = [
          entry,
          ...entries.filter((item) => createHistoryIdentity(item) !== identity),
        ].slice(0, MAX_HISTORY_ENTRIES)
        recorded.push(entry)
      }

      await writeTaskHistory(entries, options)
      return recorded
    })
  })

  historyWriteQueue = operation.then(
    () => {},
    () => {},
  )
  return operation
}

export async function clearTaskHistory(options: ClearHistoryOptions = {}): Promise<boolean> {
  const operation = historyWriteQueue.then(async () => {
    const historyPath = getTaskHistoryFilePath(options)
    return withFileLock(historyPath, async () => {
      if (options.profile) {
        const profile = normalizeSafeText(options.profile, 'Task history profile', 64)
        const entries = await readTaskHistory(options)
        const remaining = entries.filter((entry) => (entry.profile ?? 'default') !== profile)
        if (remaining.length === entries.length) return false
        if (remaining.length > 0) {
          await writeTaskHistory(remaining, options)
          return true
        }
      }

      try {
        await unlink(historyPath)
        return true
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          return false
        }

        throw new Error(`Unable to clear Modellix task history at ${historyPath}.`, {cause: error})
      }
    })
  })

  historyWriteQueue = operation.then(
    () => {},
    () => {},
  )
  return operation
}

async function writeTaskHistory(
  entries: TaskHistoryEntry[],
  options: ConfigPathOptions,
): Promise<void> {
  const historyPath = getTaskHistoryFilePath(options)
  const historyDirectory = dirname(historyPath)
  const temporaryPath = `${historyPath}.${process.pid}.${randomUUID()}.tmp`
  const payload: TaskHistoryFile = {entries, version: HISTORY_VERSION}
  let temporaryHandle: Awaited<ReturnType<typeof open>> | undefined

  try {
    await mkdir(historyDirectory, {mode: 0o700, recursive: true})
    if (process.platform !== 'win32') {
      await chmod(historyDirectory, 0o700)
    }

    temporaryHandle = await open(temporaryPath, 'wx', 0o600)
    await temporaryHandle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await temporaryHandle.sync()
    await temporaryHandle.close()
    temporaryHandle = undefined
    await rename(temporaryPath, historyPath)
    if (process.platform !== 'win32') {
      await chmod(historyPath, 0o600)
    }
  } catch (error) {
    await temporaryHandle?.close().catch(() => {})
    await unlink(temporaryPath).catch(() => {})
    throw new Error(`Unable to write Modellix task history at ${historyPath}.`, {cause: error})
  }
}

function isHistoryFile(value: unknown): value is TaskHistoryFile {
  return (
    isRecord(value) &&
    value.version === HISTORY_VERSION &&
    Array.isArray(value.entries) &&
    value.entries.length <= MAX_HISTORY_ENTRIES &&
    value.entries.every((entry) => isHistoryEntry(entry))
  )
}

function isHistoryEntry(value: unknown): value is TaskHistoryEntry {
  return (
    isRecord(value) &&
    typeof value.taskId === 'string' &&
    isSafeStoredText(value.taskId) &&
    typeof value.createdAt === 'string' &&
    isValidIsoDate(value.createdAt) &&
    typeof value.updatedAt === 'string' &&
    isValidIsoDate(value.updatedAt) &&
    (value.modelSlug === undefined
      || (typeof value.modelSlug === 'string' && isSafeStoredText(value.modelSlug, 256))) &&
    (value.profile === undefined
      || (typeof value.profile === 'string' && isSafeStoredText(value.profile, 64))) &&
    (value.baseUrl === undefined
      || (typeof value.baseUrl === 'string' && isValidHistoryBaseUrl(value.baseUrl))) &&
    (value.status === undefined
      || (typeof value.status === 'string' && isSafeStoredText(value.status, 64)))
  )
}

function isValidIsoDate(value: string): boolean {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function createHistoryIdentity(entry: {
  baseUrl?: string
  profile?: string
  taskId: string
}): string {
  return `${entry.baseUrl ?? DEFAULT_BASE_URL}\u0000${entry.profile ?? 'default'}\u0000${entry.taskId}`
}

function isValidHistoryBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.origin === value && (parsed.protocol === 'https:' || parsed.protocol === 'http:')
  } catch {
    return false
  }
}

function normalizeHistoryBaseUrl(value: string | undefined): string | undefined {
  if (value === undefined) return
  const normalized = normalizeSafeText(value, 'Task history base URL', 2048)
  if (!isValidHistoryBaseUrl(normalized)) {
    throw new Error('Task history base URL must be an HTTP(S) origin.')
  }

  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeOptional(
  value: string | undefined,
  label: string,
  maxLength: number,
): string | undefined {
  return value === undefined ? undefined : normalizeSafeText(value, label, maxLength)
}
