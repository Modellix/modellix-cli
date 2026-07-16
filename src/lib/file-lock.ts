import {chmod, mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'
import {lock} from 'proper-lockfile'

const DEFAULT_LOCK_WAIT_MS = 5000
const LOCK_STALE_MS = 30_000
const LOCK_UPDATE_MS = 10_000

/** Serialize read-modify-write operations across CLI processes. */
export async function withFileLock<T>(
  targetPath: string,
  operation: () => Promise<T>,
  waitMs = DEFAULT_LOCK_WAIT_MS,
): Promise<T> {
  if (!Number.isSafeInteger(waitMs) || waitMs <= 0) {
    throw new Error('File lock wait time must be a positive safe integer.')
  }

  const directory = dirname(targetPath)
  await mkdir(directory, {mode: 0o700, recursive: true})
  if (process.platform !== 'win32') await chmod(directory, 0o700)

  let release: (() => Promise<void>) | undefined
  try {
    release = await lock(targetPath, {
      realpath: false,
      retries: {
        factor: 1.2,
        maxRetryTime: waitMs,
        maxTimeout: 250,
        minTimeout: 25,
        randomize: true,
        retries: 100,
      },
      stale: LOCK_STALE_MS,
      update: LOCK_UPDATE_MS,
    })
  } catch (error) {
    throw new Error(`Unable to acquire exclusive access to ${targetPath}.`, {cause: error})
  }

  try {
    return await operation()
  } finally {
    await release()
  }
}
