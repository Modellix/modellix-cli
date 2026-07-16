import {randomUUID} from 'node:crypto'
import {lookup as dnsLookup} from 'node:dns/promises'
import {createWriteStream, constants as fsConstants} from 'node:fs'
import {chmod, copyFile, lstat, mkdir, mkdtemp, rename, rmdir, stat, unlink} from 'node:fs/promises'
import {get as httpGet} from 'node:http'
import {get as httpsGet} from 'node:https'
import {isIP, type LookupFunction} from 'node:net'
import {basename, dirname, extname, resolve} from 'node:path'
import {Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {setTimeout as delay} from 'node:timers/promises'

import {getTaskResult, type JsonValue, RetryableReadError} from './modellix-client.js'
import {normalizeSafeText, normalizeTaskId} from './safe-text.js'

const DOWNLOAD_TIMEOUT_MS = 30_000
export const DEFAULT_DOWNLOAD_MAX_BYTES = 1024 * 1024 * 1024
export const DEFAULT_DOWNLOAD_MAX_RESOURCES = 100
export const DEFAULT_DOWNLOAD_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
export const DEFAULT_DOWNLOAD_TOTAL_TIMEOUT_MS = 10 * 60 * 1000
const MAX_REDIRECTS = 5
const MAX_FILENAME_LENGTH = 160
const MAX_FILENAME_BYTES = 240
const MAX_TASK_RESOURCES = 1000
const MAX_WAIT_TASKS = 1000

export const FAILURE_TASK_STATUSES = new Set(['canceled', 'cancelled', 'error', 'failed'])
export const SUCCESS_TASK_STATUSES = new Set(['completed', 'succeeded', 'success'])

export type TerminalTaskResult = {
  response: JsonValue
  status: string
  taskId: string
}

export type WaitForTaskResultsInput = {
  apiKey: string
  concurrency?: number
  intervalMs: number
  onTerminal?: (result: TerminalTaskResult) => Promise<void> | void
  taskIds: string[]
  timeoutMs: number
}

export type TaskResource = {
  type?: string
  url: string
}

export type DownloadedTaskResource = {
  bytes: number
  path: string
  type?: string
}

export class TaskWaitTimeoutError extends Error {
  completed: TerminalTaskResult[]
  taskIds: string[]
  timeoutMs: number

  constructor(input: {
    completed: TerminalTaskResult[]
    taskIds: string[]
    timeoutMs: number
  }) {
    super('Timed out while waiting for Modellix tasks.')
    this.name = 'TaskWaitTimeoutError'
    this.completed = input.completed
    this.taskIds = input.taskIds
    this.timeoutMs = input.timeoutMs
  }
}

// Polling coordinates deadlines, bounded concurrency, terminal callbacks, and status validation.
// eslint-disable-next-line complexity
export async function waitForTaskResults(
  input: WaitForTaskResultsInput,
): Promise<TerminalTaskResult[]> {
  const taskIds = normalizeTaskIds(input.taskIds)
  if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs <= 0) {
    throw new Error('Polling interval must be greater than zero.')
  }

  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error('Wait timeout must be greater than zero.')
  }

  const concurrency = input.concurrency ?? 8
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 20) {
    throw new Error('Polling concurrency must be an integer between 1 and 20.')
  }

  const deadline = Date.now() + input.timeoutMs
  const completed = new Map<string, TerminalTaskResult>()

  while (completed.size < taskIds.length) {
    if (deadline - Date.now() <= 0) {
      throw createTimeoutError(taskIds, completed, input.timeoutMs)
    }

    const pendingTaskIds = taskIds.filter((taskId) => !completed.has(taskId))
    // A polling round is concurrent, while rounds themselves remain sequential.
    // eslint-disable-next-line no-await-in-loop
    const round = await mapConcurrently(
      pendingTaskIds,
      concurrency,
      async (taskId) => {
        // A request can sit behind other work when the queue is larger than the
        // concurrency limit, so calculate its budget when it actually starts.
        const requestTimeoutMs = deadline - Date.now()
        if (requestTimeoutMs <= 0) {
          throw createTimeoutError(taskIds, completed, input.timeoutMs)
        }

        try {
          return {
            response: await getTaskResult({
              apiKey: input.apiKey,
              taskId,
              timeoutMs: requestTimeoutMs,
            }),
            taskId,
          }
        } catch (error) {
          if (error instanceof RetryableReadError) return {taskId, transientError: error}
          throw error
        }
      },
    )

    for (const item of round.results) {
      if (!item) continue
      const {response, taskId, transientError} = item
      if (transientError) continue
      if (response === undefined) {
        throw new Error(`Internal polling error for task ${taskId}: missing response.`)
      }

      const {status} = validateTaskResponse(response, taskId)
      const normalizedStatus = status.toLowerCase()
      if (
        SUCCESS_TASK_STATUSES.has(normalizedStatus) ||
        FAILURE_TASK_STATUSES.has(normalizedStatus)
      ) {
        const result = {response, status: normalizedStatus, taskId}
        completed.set(taskId, result)
        if (input.onTerminal) {
          // Terminal callbacks are intentionally ordered like the input IDs.
          // eslint-disable-next-line no-await-in-loop
          await input.onTerminal(result)
        }
      }
    }

    if (round.failure) {
      if (Date.now() >= deadline || round.failure.error instanceof TaskWaitTimeoutError) {
        throw createTimeoutError(taskIds, completed, input.timeoutMs)
      }

      throw round.failure.error
    }

    if (completed.size === taskIds.length) {
      break
    }

    const delayMs = Math.min(input.intervalMs, deadline - Date.now())
    if (delayMs <= 0) {
      throw createTimeoutError(taskIds, completed, input.timeoutMs)
    }

    // Polling rounds must not overlap.
    // eslint-disable-next-line no-await-in-loop
    await delay(delayMs)
  }

  return taskIds.map((taskId) => completed.get(taskId) as TerminalTaskResult)
}

export function getTaskStatus(response: JsonValue): string | undefined {
  if (!isRecord(response) || !isRecord(response.data)) {
    return
  }

  if (typeof response.data.status !== 'string') return
  try {
    return normalizeSafeText(response.data.status, 'Modellix task status', 64)
  } catch {}
}

export function validateTaskResponse(
  response: JsonValue,
  expectedTaskId: string,
): {status: string; taskId: string} {
  const status = getTaskStatus(response)
  if (!status) {
    throw new Error(
      `Invalid response from Modellix API for task ${expectedTaskId}: expected data.status to be a non-empty safe string.`,
    )
  }

  const taskId = getResponseTaskId(response)
  if (!taskId) {
    throw new Error(
      `Invalid response from Modellix API for task ${expectedTaskId}: expected data.task_id to be a non-empty safe string.`,
    )
  }

  if (taskId !== expectedTaskId) {
    throw new Error(
      `Invalid response from Modellix API for task ${expectedTaskId}: received a different task ID.`,
    )
  }

  return {status, taskId}
}

export function extractTaskResources(response: JsonValue): TaskResource[] {
  if (!isRecord(response) || !isRecord(response.data)) {
    throw new Error('Invalid response from Modellix API: expected data to be an object.')
  }

  const result = isRecord(response.data.result) ? response.data.result : undefined
  const rawResources = Array.isArray(result?.resources)
    ? result.resources
    : Array.isArray(response.data.resources)
      ? response.data.resources
      : undefined
  if (!rawResources) {
    return []
  }

  if (rawResources.length > MAX_TASK_RESOURCES) {
    throw new Error(`Task response exceeds the ${MAX_TASK_RESOURCES}-resource limit.`)
  }

  return rawResources.map((resource, index) => {
    const url =
      typeof resource === 'string'
        ? resource
        : isRecord(resource) && typeof resource.url === 'string'
          ? resource.url
          : undefined
    if (!url) {
      throw new Error(`Invalid task resource at index ${index}: expected an HTTP(S) URL.`)
    }

    const normalizedUrl = validateHttpUrl(url).href
    const rawType = isRecord(resource) && typeof resource.type === 'string' ? resource.type : undefined
    const type = rawType ? normalizeSafeText(rawType, 'Task resource type', 128) : undefined
    return {url: normalizedUrl, ...(type ? {type} : {})}
  })
}

type DownloadTaskResourcesInput = {
  allowInsecureHttp?: boolean
  allowPrivateNetwork?: boolean
  maxBytes?: number
  maxResources?: number
  maxTotalBytes?: number
  outputDirectory: string
  overwrite: boolean
  resources: TaskResource[]
  timeoutMs?: number
}

type ResourceDownloadOptions = {
  allowInsecureHttp: boolean
  allowPrivateNetwork: boolean
  maxBytes: number
  timeoutMs: number
}

type ResourceDownloadContext = {
  deadline: number
  destination: string
  options: ResourceDownloadOptions
}

type ResourceDownloader = (
  url: string,
  destination: string,
  options: ResourceDownloadOptions,
) => Promise<void>

let resourceDownloader: ResourceDownloader = performResourceDownload

export function __setResourceDownloaderForTest(downloader?: ResourceDownloader): void {
  resourceDownloader = downloader ?? performResourceDownload
}

// Resource policy, aggregate limits, staging, and atomic installation form one transaction flow.
// eslint-disable-next-line complexity
export async function downloadTaskResources(
  input: DownloadTaskResourcesInput,
): Promise<DownloadedTaskResource[]> {
  const downloadOptions: ResourceDownloadOptions = {
    allowInsecureHttp: input.allowInsecureHttp ?? false,
    allowPrivateNetwork: input.allowPrivateNetwork ?? false,
    maxBytes: input.maxBytes ?? DEFAULT_DOWNLOAD_MAX_BYTES,
    timeoutMs: input.timeoutMs ?? DEFAULT_DOWNLOAD_TOTAL_TIMEOUT_MS,
  }
  if (!Number.isSafeInteger(downloadOptions.maxBytes) || downloadOptions.maxBytes <= 0) {
    throw new Error('Download byte limit must be a positive safe integer.')
  }

  if (!Number.isSafeInteger(downloadOptions.timeoutMs) || downloadOptions.timeoutMs <= 0) {
    throw new Error('Download timeout must be a positive safe integer.')
  }

  const maxResources = input.maxResources ?? DEFAULT_DOWNLOAD_MAX_RESOURCES
  const maxTotalBytes = input.maxTotalBytes ?? DEFAULT_DOWNLOAD_MAX_TOTAL_BYTES
  if (!Number.isSafeInteger(maxResources) || maxResources <= 0) {
    throw new Error('Download resource limit must be a positive safe integer.')
  }

  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes <= 0) {
    throw new Error('Download total byte limit must be a positive safe integer.')
  }

  if (input.resources.length > maxResources) {
    throw new Error(`Task has more than the allowed ${maxResources} downloadable resources.`)
  }

  const outputDirectory = resolve(input.outputDirectory)
  await mkdir(outputDirectory, {recursive: true})
  const directoryStats = await stat(outputDirectory)
  if (!directoryStats.isDirectory()) {
    throw new Error(`Download output path is not a directory: ${outputDirectory}`)
  }

  const reservedNames = new Set<string>()
  const downloads: DownloadedTaskResource[] = []
  const stagingDirectory = await mkdtemp(resolve(outputDirectory, '.modellix-download-'))
  assertContainedPath(outputDirectory, stagingDirectory)
  if (process.platform !== 'win32') await chmod(stagingDirectory, 0o700)
  let totalBytes = 0
  const temporaryPaths = new Set<string>()

  try {
    for (const [index, resource] of input.resources.entries()) {
      validateDownloadUrlPolicy(resource.url, downloadOptions)
      const preferredName = createSafeFilename(resource.url, index)
      // Downloads are intentionally sequential to avoid exhausting bandwidth and file handles.
      // eslint-disable-next-line no-await-in-loop
      const targetPath = await chooseTargetPath({
        outputDirectory,
        overwrite: input.overwrite,
        preferredName,
        reservedNames,
      })
      const temporaryPath = resolve(stagingDirectory, `${index}-${randomUUID()}.part`)
      assertContainedPath(stagingDirectory, temporaryPath)
      temporaryPaths.add(temporaryPath)
      const remainingTotalBytes = maxTotalBytes - totalBytes
      if (remainingTotalBytes <= 0) {
        throw new Error(`Task downloads exceed the ${maxTotalBytes}-byte total limit.`)
      }

      const resourceOptions = {
        ...downloadOptions,
        maxBytes: Math.min(downloadOptions.maxBytes, remainingTotalBytes),
      }

      // eslint-disable-next-line no-await-in-loop
      await resourceDownloader(resource.url, temporaryPath, resourceOptions)
      // Never follow a replaced path, even when a test/custom downloader bypasses `wx`.
      // eslint-disable-next-line no-await-in-loop
      const temporaryStats = await lstat(temporaryPath)
      if (!temporaryStats.isFile() || temporaryStats.isSymbolicLink()) {
        throw new Error('Resource downloader did not produce a regular file.')
      }

      if (temporaryStats.size > downloadOptions.maxBytes) {
        throw new Error(`Resource download exceeds the ${downloadOptions.maxBytes}-byte limit.`)
      }

      if (temporaryStats.size > remainingTotalBytes) {
        throw new Error(`Task downloads exceed the ${maxTotalBytes}-byte total limit.`)
      }

      totalBytes += temporaryStats.size
      if (totalBytes > maxTotalBytes) {
        throw new Error(`Task downloads exceed the ${maxTotalBytes}-byte total limit.`)
      }

      // eslint-disable-next-line no-await-in-loop
      await installDownloadedFile(temporaryPath, targetPath, input.overwrite)
      downloads.push({
        bytes: temporaryStats.size,
        path: targetPath,
        ...(resource.type ? {type: resource.type} : {}),
      })
    }
  } finally {
    for (const temporaryPath of temporaryPaths) {
      // Every path was generated and containment-checked above.
      // eslint-disable-next-line no-await-in-loop
      await unlink(temporaryPath).catch(() => {})
    }

    await rmdir(stagingDirectory).catch(() => {})
  }

  return downloads
}

async function chooseTargetPath(input: {
  outputDirectory: string
  overwrite: boolean
  preferredName: string
  reservedNames: Set<string>
}): Promise<string> {
  let sequence = 1
  while (true) {
    const name = sequence === 1 ? input.preferredName : addFilenameSuffix(input.preferredName, sequence)
    const normalizedName = name.toLowerCase()
    const targetPath = resolve(input.outputDirectory, name)
    assertContainedPath(input.outputDirectory, targetPath)

    // Candidate checks are sequential so names remain deterministic.
    // eslint-disable-next-line no-await-in-loop
    const available = input.overwrite || !(await pathExists(targetPath))
    if (!input.reservedNames.has(normalizedName) && available) {
      input.reservedNames.add(normalizedName)
      return targetPath
    }

    sequence += 1
  }
}

async function installDownloadedFile(
  temporaryPath: string,
  targetPath: string,
  overwrite: boolean,
): Promise<void> {
  if (overwrite) {
    let targetExists = false
    try {
      const targetStats = await lstat(targetPath)
      if (!targetStats.isFile() || targetStats.isSymbolicLink()) {
        throw new Error(`Refusing to overwrite a non-regular file: ${targetPath}`)
      }

      targetExists = true
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error
      }
    }

    if (!targetExists) {
      await rename(temporaryPath, targetPath)
      return
    }

    const backupPath = `${targetPath}.modellix-backup-${randomUUID()}`
    await rename(targetPath, backupPath)
    const backupStats = await lstat(backupPath)
    if (!backupStats.isFile() || backupStats.isSymbolicLink()) {
      await rename(backupPath, targetPath)
      throw new Error(`Refusing to overwrite a non-regular file: ${targetPath}`)
    }

    try {
      await rename(temporaryPath, targetPath)
    } catch (error) {
      await unlink(targetPath).catch(() => {})
      await rename(backupPath, targetPath).catch(() => {})
      throw error
    }

    await unlink(backupPath)

    return
  }

  try {
    await copyFile(temporaryPath, targetPath, fsConstants.COPYFILE_EXCL)
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      throw new Error(`Download target already exists: ${targetPath}. Retry or pass --overwrite.`)
    }

    throw error
  }
}

async function performResourceDownload(
  url: string,
  destination: string,
  options: ResourceDownloadOptions,
): Promise<void> {
  await downloadWithRedirects(
    validateDownloadUrlPolicy(url, options),
    0,
    {deadline: Date.now() + options.timeoutMs, destination, options},
  )
}

async function downloadWithRedirects(
  url: URL,
  redirectCount: number,
  context: ResourceDownloadContext,
): Promise<void> {
  const {deadline, destination, options} = context
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) {
    throw new Error('Resource download exceeded its total time limit.')
  }

  const response = await requestResource(url, options, remainingMs)
  const statusCode = response.statusCode ?? 0
  if (statusCode >= 300 && statusCode < 400) {
    const {location} = response.headers
    response.destroy()
    if (!location) {
      throw new Error(`Resource download redirect (${statusCode}) did not include a Location header.`)
    }

    if (redirectCount >= MAX_REDIRECTS) {
      throw new Error(`Resource download exceeded ${MAX_REDIRECTS} redirects.`)
    }

    await downloadWithRedirects(
      validateDownloadUrlPolicy(new URL(location, url).toString(), options),
      redirectCount + 1,
      context,
    )
    return
  }

  if (statusCode < 200 || statusCode >= 300) {
    response.destroy()
    throw new Error(`Resource download failed with HTTP status ${statusCode}.`)
  }

  const contentLength = Number(firstHeaderValue(response.headers['content-length']))
  if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
    response.destroy()
    throw new Error(`Resource download exceeds the ${options.maxBytes}-byte limit.`)
  }

  const bodyRemainingMs = deadline - Date.now()
  if (bodyRemainingMs <= 0) {
    response.destroy()
    throw new Error('Resource download exceeded its total time limit.')
  }

  const deadlineTimer = setTimeout(() => {
    response.destroy(new Error('Resource download exceeded its total time limit.'))
  }, bodyRemainingMs)
  deadlineTimer.unref()
  try {
    await pipeline(
      response,
      createByteLimit(options.maxBytes),
      createWriteStream(destination, {flags: 'wx', mode: 0o600}),
    )
  } finally {
    clearTimeout(deadlineTimer)
  }
}

async function requestResource(
  url: URL,
  options: ResourceDownloadOptions,
  remainingMs: number,
): Promise<import('node:http').IncomingMessage> {
  return new Promise((resolveRequest, rejectRequest) => {
    const get = url.protocol === 'https:' ? httpsGet : httpGet
    const request = get(
      url,
      {
        headers: {'User-Agent': 'modellix-cli'},
        ...(options.allowPrivateNetwork ? {} : {lookup: safePublicLookup}),
      },
      resolveRequest,
    )
    const totalTimer = setTimeout(() => {
      request.destroy(new Error('Resource download exceeded its total time limit.'))
    }, remainingMs)
    totalTimer.unref()
    request.once('response', () => clearTimeout(totalTimer))
    request.on('error', (error) => {
      clearTimeout(totalTimer)
      rejectRequest(error)
    })
    request.setTimeout(Math.min(DOWNLOAD_TIMEOUT_MS, remainingMs), () => {
      request.destroy(new Error('Resource download timed out after 30 seconds of inactivity.'))
    })
  })
}

function createByteLimit(maxBytes: number): Transform {
  let bytes = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length
      if (bytes > maxBytes) {
        callback(new Error(`Resource download exceeds the ${maxBytes}-byte limit.`))
        return
      }

      callback(null, chunk)
    },
  })
}

const safePublicLookup: LookupFunction = (hostname, lookupOptions, callback) => {
  dnsLookup(hostname, {all: true, verbatim: true}).then(
    (addresses) => {
      if (addresses.length === 0 || addresses.some(({address}) => isBlockedNetworkAddress(address))) {
        callback(
          new Error('Resource host resolves to a private or reserved network address.'),
          '',
        )
        return
      }

      if (lookupOptions.all) {
        callback(null, addresses)
        return
      }

      const selected = addresses.find(({family}) => !lookupOptions.family || family === lookupOptions.family)
        ?? addresses[0]
      callback(null, selected.address, selected.family)
    },
    (error: NodeJS.ErrnoException) => callback(error, ''),
  )
}

function validateHttpUrl(value: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    // Resource URLs can contain signed query parameters, so never echo the full value.
    throw new Error('Invalid task resource URL.')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported task resource URL protocol: ${parsed.protocol || 'unknown'}`)
  }

  if (parsed.username || parsed.password) {
    throw new Error('Task resource URLs must not contain embedded credentials.')
  }

  return parsed
}

function validateDownloadUrlPolicy(value: string, options: ResourceDownloadOptions): URL {
  const parsed = validateHttpUrl(value)
  if (parsed.protocol === 'http:' && !options.allowInsecureHttp) {
    throw new Error(
      'Refusing an insecure HTTP resource URL. Pass --allow-insecure-http only for a trusted source.',
    )
  }

  if (!options.allowPrivateNetwork) {
    const hostname = parsed.hostname.replaceAll(/^\[|\]$/g, '').toLowerCase()
    if (
      hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || (isIP(hostname) !== 0 && isBlockedNetworkAddress(hostname))
    ) {
      throw new Error(
        'Refusing a private or reserved resource host. Pass --allow-private-network only for a trusted source.',
      )
    }
  }

  return parsed
}

function isBlockedNetworkAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]
  const version = isIP(normalized)
  if (version === 4) return isBlockedIpv4Address(normalized)
  if (version === 6) return isBlockedIpv6Address(normalized)
  return true
}

// The branches intentionally enumerate non-public IPv4 ranges for auditability.
// eslint-disable-next-line complexity
function isBlockedIpv4Address(address: string): boolean {
  const [first, second, third] = address.split('.').map(Number)
  return (
    first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && (third === 0 || third === 2))
    || (first === 192 && second === 88 && third === 99)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224
  )
}

function isBlockedIpv6Address(address: string): boolean {
  if (address === '::' || address === '::1' || address.startsWith('::ffff:')) return true
  const groups = address.split(':')
  const firstGroup = Number.parseInt(groups[0] || '0', 16)
  const secondGroup = Number.parseInt(groups[1] || '0', 16)
  return (
    firstGroup < 8192
    || firstGroup > 16_383
    || (firstGroup === 0x20_01 && (secondGroup <= 0x01_FF || secondGroup === 0x0D_B8))
    || firstGroup === 0x20_02
    || (firstGroup === 0x3F_FF && secondGroup <= 0x0F_FF)
  )
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function createSafeFilename(url: string, index: number): string {
  const parsed = validateHttpUrl(url)
  let decoded = ''
  try {
    decoded = decodeURIComponent(basename(parsed.pathname))
  } catch {
    decoded = basename(parsed.pathname)
  }

  let filename = stripUnsafeFilenameCharacters(decoded.normalize('NFKC'))
    .replaceAll(/^\.+|[. ]+$/g, '')
    .trim()
  if (!filename || filename === '.' || filename === '..') {
    filename = `resource-${index + 1}`
  }

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) {
    filename = `resource-${filename}`
  }

  if (filename.length > MAX_FILENAME_LENGTH) {
    const extension = extname(filename).slice(0, 20)
    filename = `${filename.slice(0, MAX_FILENAME_LENGTH - extension.length)}${extension}`
  }

  return truncateFilename(filename)
}

function stripUnsafeFilenameCharacters(value: string): string {
  const unsafePrintable = new Set(String.raw`<>:"/\|?*`)
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint < 32
        || codePoint === 127
        || /\p{C}|\p{Zl}|\p{Zp}/u.test(character)
        || unsafePrintable.has(character)
        ? '-'
        : character
    })
    .join('')
}

function addFilenameSuffix(filename: string, sequence: number): string {
  const rawExtension = extname(filename)
  const extension = truncateUtf8(rawExtension, 20)
  const stem = filename.slice(0, filename.length - rawExtension.length)
  const suffix = `-${sequence}`
  const stemBytes = MAX_FILENAME_BYTES
    - Buffer.byteLength(suffix)
    - Buffer.byteLength(extension)
  return `${truncateUtf8(stem, Math.max(0, stemBytes))}${suffix}${extension}`
}

function truncateFilename(filename: string): string {
  if (Buffer.byteLength(filename) <= MAX_FILENAME_BYTES) return filename
  const extension = truncateUtf8(extname(filename), 20)
  const stem = filename.slice(0, filename.length - extname(filename).length)
  return `${truncateUtf8(stem, MAX_FILENAME_BYTES - Buffer.byteLength(extension))}${extension}`
}

function truncateUtf8(value: string, maxBytes: number): string {
  let bytes = 0
  let result = ''
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character)
    if (bytes + characterBytes > maxBytes) break
    bytes += characterBytes
    result += character
  }

  return result
}

function assertContainedPath(outputDirectory: string, targetPath: string): void {
  if (dirname(targetPath) !== outputDirectory) {
    throw new Error(`Refusing to write outside the output directory: ${targetPath}`)
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

function normalizeTaskIds(taskIds: string[]): string[] {
  const normalized = taskIds.map((taskId) => normalizeTaskId(taskId))
  const unique = [...new Set(normalized)]
  if (unique.length === 0) {
    throw new Error('At least one task ID is required.')
  }

  if (unique.length > MAX_WAIT_TASKS) {
    throw new Error(`Cannot wait for more than ${MAX_WAIT_TASKS} tasks at once.`)
  }

  return unique
}

async function mapConcurrently<T, U>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<U>,
): Promise<{failure?: {error: unknown}; results: Array<U | undefined>}> {
  const results: Array<U | undefined> = []
  let nextIndex = 0
  let failure: undefined | {error: unknown}
  let stopped = false
  const worker = async (): Promise<void> => {
    while (!stopped && nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      try {
        // Workers are sequential internally and bounded collectively.
        // eslint-disable-next-line no-await-in-loop
        results[index] = await mapper(values[index])
      } catch (error) {
        failure ??= {error}
        stopped = true
      }
    }
  }

  await Promise.all(
    Array.from({length: Math.min(concurrency, values.length)}, async () => worker()),
  )
  return {failure, results}
}

function getResponseTaskId(response: JsonValue): string | undefined {
  if (!isRecord(response) || !isRecord(response.data)) return
  if (typeof response.data.task_id !== 'string') return
  try {
    return normalizeTaskId(response.data.task_id, 'Modellix task ID')
  } catch {}
}

function createTimeoutError(
  taskIds: string[],
  completed: Map<string, TerminalTaskResult>,
  timeoutMs: number,
): TaskWaitTimeoutError {
  return new TaskWaitTimeoutError({
    completed: taskIds.flatMap((taskId) => {
      const result = completed.get(taskId)
      return result ? [result] : []
    }),
    taskIds,
    timeoutMs,
  })
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function isRecord(value: JsonValue): value is {[key: string]: JsonValue} {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
