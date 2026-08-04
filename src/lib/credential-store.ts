import {createHash, randomUUID} from 'node:crypto'
import {chmod, lstat, mkdir, open, rename, unlink} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {
  type ConfigPathOptions,
  type CredentialMetadata,
  type CredentialStoreKind,
  getConfigFilePath,
  normalizeCredentialOrigin,
  normalizeProfileName,
} from './config.js'
import {withFileLock} from './file-lock.js'
import {InputFileSizeLimitError, readUtf8FileLimited} from './limited-input.js'
import {normalizeApiKey, normalizeSafeText} from './safe-text.js'

const KEYRING_SERVICE = 'ai.modellix.cli.api-key'
const MAX_CREDENTIAL_FILE_BYTES = 2 * 1024 * 1024
const MAX_CREDENTIAL_COUNT = 500

type KeyringModule = typeof import('@napi-rs/keyring')
type KeyringLoader = () => Promise<KeyringModule>

type FileCredentialStore = {
  credentials: Record<string, {apiKey: string}>
  schemaVersion: 1
}

export class CredentialStoreUnavailableError extends Error {
  readonly code = 'CREDENTIAL_STORE_UNAVAILABLE'

  constructor(store: CredentialStoreKind, cause?: unknown) {
    super(
      store === 'keychain'
        ? 'The operating-system credential store is unavailable. Use a session key or explicitly choose --store file.'
        : 'The explicit file credential store is unavailable.',
      {cause},
    )
    this.name = 'CredentialStoreUnavailableError'
  }
}

let keyringLoader: KeyringLoader = () => import('@napi-rs/keyring')

export function __setKeyringLoaderForTest(loader?: KeyringLoader): void {
  keyringLoader = loader ?? (() => import('@napi-rs/keyring'))
}

export function createCredentialReference(origin: string, profile: string): string {
  const normalizedOrigin = normalizeCredentialOrigin(origin)
  const normalizedProfile = normalizeProfileName(profile)
  const digest = createHash('sha256')
    .update(`${normalizedOrigin}\0${normalizedProfile}`, 'utf8')
    .digest('base64url')
  return `v1-${digest}`
}

export function getCredentialFilePath(options: ConfigPathOptions = {}): string {
  return join(dirname(getConfigFilePath(options)), 'credentials.json')
}

export async function readStoredCredential(
  metadata: CredentialMetadata,
  options: ConfigPathOptions = {},
): Promise<string | undefined> {
  const credentialRef = normalizeSafeText(metadata.credentialRef, 'Credential reference', 512)
  if (metadata.store === 'file') return readFileCredential(credentialRef, options)
  return readKeychainCredential(credentialRef)
}

export async function writeStoredCredential(
  store: CredentialStoreKind,
  credentialRef: string,
  apiKey: string,
  options: ConfigPathOptions = {},
): Promise<void> {
  const normalizedRef = normalizeSafeText(credentialRef, 'Credential reference', 512)
  const normalizedKey = normalizeApiKey(apiKey)
  if (store === 'file') {
    await writeFileCredential(normalizedRef, normalizedKey, options)
    return
  }

  await writeKeychainCredential(normalizedRef, normalizedKey)
}

export async function deleteStoredCredential(
  metadata: CredentialMetadata,
  options: ConfigPathOptions = {},
): Promise<boolean> {
  const credentialRef = normalizeSafeText(metadata.credentialRef, 'Credential reference', 512)
  if (metadata.store === 'file') return deleteFileCredential(credentialRef, options)
  return deleteKeychainCredential(credentialRef)
}

export async function checkCredentialStore(
  store: CredentialStoreKind,
  options: ConfigPathOptions = {},
): Promise<{available: boolean; store: CredentialStoreKind; warning?: string}> {
  try {
    await (store === 'file' ? readFileStore(options) : readKeychainCredential('v1-capability-probe-does-not-exist'));

    return {available: true, store}
  } catch (error) {
    return {
      available: false,
      store,
      warning: error instanceof Error ? error.message : 'Credential store is unavailable.',
    }
  }
}

async function readKeychainCredential(credentialRef: string): Promise<string | undefined> {
  try {
    const {AsyncEntry} = await keyringLoader()
    const value = await new AsyncEntry(KEYRING_SERVICE, credentialRef).getPassword()
    return value ? normalizeApiKey(value, 'Saved Modellix API key') : undefined
  } catch (error) {
    if (isMissingCredentialError(error)) return
    throw new CredentialStoreUnavailableError('keychain', error)
  }
}

async function writeKeychainCredential(credentialRef: string, apiKey: string): Promise<void> {
  try {
    const {AsyncEntry} = await keyringLoader()
    await new AsyncEntry(KEYRING_SERVICE, credentialRef).setPassword(apiKey)
  } catch (error) {
    throw new CredentialStoreUnavailableError('keychain', error)
  }
}

async function deleteKeychainCredential(credentialRef: string): Promise<boolean> {
  try {
    const {AsyncEntry} = await keyringLoader()
    return await new AsyncEntry(KEYRING_SERVICE, credentialRef).deleteCredential()
  } catch (error) {
    if (isMissingCredentialError(error)) return false
    throw new CredentialStoreUnavailableError('keychain', error)
  }
}

async function readFileCredential(
  credentialRef: string,
  options: ConfigPathOptions,
): Promise<string | undefined> {
  const store = await readFileStore(options)
  const apiKey = store?.credentials[credentialRef]?.apiKey
  return apiKey ? normalizeApiKey(apiKey, 'Saved Modellix API key') : undefined
}

async function writeFileCredential(
  credentialRef: string,
  apiKey: string,
  options: ConfigPathOptions,
): Promise<void> {
  const storePath = getCredentialFilePath(options)
  await withFileLock(storePath, async () => {
    const existing = await readFileStore(options)
    const credentials = cloneFileCredentials(existing?.credentials)
    if (!Object.hasOwn(credentials, credentialRef) && Object.keys(credentials).length >= MAX_CREDENTIAL_COUNT) {
      throw new Error(`File credential store allows at most ${MAX_CREDENTIAL_COUNT} entries.`)
    }

    credentials[credentialRef] = {apiKey}
    await writeFileStore({credentials, schemaVersion: 1}, options)
  })
}

async function deleteFileCredential(
  credentialRef: string,
  options: ConfigPathOptions,
): Promise<boolean> {
  const storePath = getCredentialFilePath(options)
  return withFileLock(storePath, async () => {
    const existing = await readFileStore(options)
    if (!existing || !Object.hasOwn(existing.credentials, credentialRef)) return false
    const credentials = cloneFileCredentials(existing.credentials)
    delete credentials[credentialRef]
    await (Object.keys(credentials).length === 0 ? unlink(storePath).catch((error) => {
        if (!isNodeError(error) || error.code !== 'ENOENT') throw error
      }) : writeFileStore({credentials, schemaVersion: 1}, options));

    return true
  })
}

async function readFileStore(options: ConfigPathOptions): Promise<FileCredentialStore | undefined> {
  const storePath = getCredentialFilePath(options)
  let contents: string
  try {
    const stats = await lstat(storePath)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error('Credential file must be a regular file, not a symbolic link.')
    }

    contents = await readUtf8FileLimited(storePath, MAX_CREDENTIAL_FILE_BYTES, 'Credential file')
    if (process.platform !== 'win32') await chmod(storePath, 0o600)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    if (error instanceof InputFileSizeLimitError) throw error
    throw new CredentialStoreUnavailableError('file', error)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents) as unknown
  } catch (error) {
    throw new CredentialStoreUnavailableError('file', error)
  }

  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.credentials)) {
    throw new CredentialStoreUnavailableError('file', new Error('Invalid credential file schema.'))
  }

  if (Object.keys(parsed.credentials).length > MAX_CREDENTIAL_COUNT) {
    throw new CredentialStoreUnavailableError('file', new Error('Credential file entry limit exceeded.'))
  }

  const credentials = createCredentialMap()
  for (const [rawRef, rawValue] of Object.entries(parsed.credentials)) {
    const credentialRef = normalizeSafeText(rawRef, 'Credential reference', 512)
    if (!isRecord(rawValue) || typeof rawValue.apiKey !== 'string') {
      throw new CredentialStoreUnavailableError('file', new Error('Invalid credential entry.'))
    }

    credentials[credentialRef] = {apiKey: normalizeApiKey(rawValue.apiKey, 'Saved Modellix API key')}
  }

  return {credentials, schemaVersion: 1}
}

async function writeFileStore(store: FileCredentialStore, options: ConfigPathOptions): Promise<void> {
  const storePath = getCredentialFilePath(options)
  const storeDirectory = dirname(storePath)
  const temporaryPath = join(storeDirectory, `.credentials.${process.pid}.${randomUUID()}.tmp`)
  const payload = `${JSON.stringify(store, null, 2)}\n`
  if (Buffer.byteLength(payload) > MAX_CREDENTIAL_FILE_BYTES) {
    throw new Error(`Credential file exceeds the ${MAX_CREDENTIAL_FILE_BYTES}-byte limit.`)
  }

  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    await mkdir(storeDirectory, {mode: 0o700, recursive: true})
    if (process.platform !== 'win32') await chmod(storeDirectory, 0o700)
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(payload, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, storePath)
    if (process.platform !== 'win32') await chmod(storePath, 0o600)
  } catch (error) {
    await handle?.close().catch(() => {})
    await unlink(temporaryPath).catch(() => {})
    throw new CredentialStoreUnavailableError('file', error)
  }
}

function cloneFileCredentials(
  source?: Record<string, {apiKey: string}>,
): Record<string, {apiKey: string}> {
  const result = createCredentialMap()
  for (const [credentialRef, value] of Object.entries(source ?? {})) {
    result[credentialRef] = {apiKey: value.apiKey}
  }

  return result
}

function createCredentialMap(): Record<string, {apiKey: string}> {
  return Object.create(null) as Record<string, {apiKey: string}>
}

function isMissingCredentialError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /no\s*entry|not\s*found|does not exist|missing credential/iu.test(message)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
