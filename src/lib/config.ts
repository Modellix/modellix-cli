import {randomUUID} from 'node:crypto'
import {chmod, lstat, mkdir, open, rename, unlink} from 'node:fs/promises'
import {homedir} from 'node:os'
import {dirname, isAbsolute, join} from 'node:path'

import {withFileLock} from './file-lock.js'
import {InputFileSizeLimitError, readUtf8FileLimited} from './limited-input.js'
import {normalizeApiKey, normalizeSafeText} from './safe-text.js'

const DEFAULT_API_ORIGIN = 'https://api.modellix.ai'

export const CONFIG_SCHEMA_VERSION = 2
export const DEFAULT_PROFILE = 'default'
const RESERVED_PROFILE_NAMES = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_CONFIG_BYTES = 1024 * 1024
const MAX_PROFILE_COUNT = 100
const MAX_PROFILE_NAME_LENGTH = 64

export type ConfigPathOptions = {
  configHome?: string
  homeDirectory?: string
}

export type CredentialStoreKind = 'file' | 'keychain'

export type CredentialMetadata = {
  credentialRef: string
  store: CredentialStoreKind
}

export type ModellixProfile = {
  origins: Record<string, CredentialMetadata>
}

/**
 * API keys from v0.0.7 and older are exposed only through a non-enumerable
 * property so they cannot leak through JSON output or diagnostics.
 */
export type ModellixConfig = {
  currentProfile: string
  legacyApiKeys?: Record<string, string>
  profiles: Record<string, ModellixProfile>
  schemaVersion: number
}

export type ProfileRemovalResult = {
  currentProfile?: string
  legacyApiKey?: string
  origins: Array<{metadata: CredentialMetadata; origin: string}>
  remainingProfiles: string[]
  removed: boolean
}

export type WriteProfileMetadataInput = {
  credential: CredentialMetadata
  origin: string
  profile?: string
  recover?: boolean
  setCurrent?: boolean
}

/**
 * Backward-compatible internal writer. Unlike the v0.0.7 implementation, this
 * never writes an API key to config.json; the key is stored in the explicit
 * file credential backend and config.json contains metadata only.
 */
export type WriteConfigInput = {
  apiKey: string
  expectedApiKey?: null | string
  origin?: string
  profile?: string
  recover?: boolean
  setCurrent?: boolean
}

type StoredConfig = {
  currentProfile: string
  profiles: Record<string, ModellixProfile>
  schemaVersion: number
}

export class LegacyCredentialMigrationRequiredError extends Error {
  constructor() {
    super('Legacy plaintext credentials must be migrated first. Run modellix-cli auth migrate --to keychain.')
    this.name = 'LegacyCredentialMigrationRequiredError'
  }
}

export function getConfigFilePath(options: ConfigPathOptions = {}): string {
  const configuredHome = options.configHome?.trim() || process.env.XDG_CONFIG_HOME?.trim()
  const userHome = options.homeDirectory?.trim() || homedir()
  if (configuredHome) normalizeSafeText(configuredHome, 'Modellix config home', 32_767)
  normalizeSafeText(userHome, 'User home directory', 32_767)
  if (configuredHome && !isAbsolute(configuredHome)) {
    throw new Error('Modellix config home must be an absolute path.')
  }

  if (!isAbsolute(userHome)) {
    throw new Error('User home directory must be an absolute path.')
  }

  return join(configuredHome || join(userHome, '.config'), 'modellix', 'config.json')
}

export function normalizeProfileName(profile?: string): string {
  const normalized = profile?.trim() || DEFAULT_PROFILE
  if (normalized.length > MAX_PROFILE_NAME_LENGTH) {
    throw new Error(`Invalid profile name. Maximum length is ${MAX_PROFILE_NAME_LENGTH} characters.`)
  }

  if (!/^[\w.-]+$/u.test(normalized)) {
    throw new Error('Invalid profile name. Use only letters, numbers, underscores, dots, and hyphens.')
  }

  if (RESERVED_PROFILE_NAMES.has(normalized.toLowerCase())) {
    throw new Error(`Invalid profile name: ${normalized} is reserved.`)
  }

  return normalized
}

export function normalizeCredentialOrigin(rawOrigin: string): string {
  const normalized = normalizeSafeText(rawOrigin, 'Credential origin', 2048)
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error('Credential origin must be a valid URL origin.')
  }

  const isLocalHttp = url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('Credential origin must use HTTPS (HTTP is allowed only for localhost).')
  }

  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error('Credential origin must not include credentials, a path, query, or fragment.')
  }

  return url.origin
}

export async function readConfig(options: ConfigPathOptions = {}): Promise<ModellixConfig | undefined> {
  return readStoredConfig(options)
}

export async function writeProfileMetadata(
  input: WriteProfileMetadataInput,
  options: ConfigPathOptions = {},
): Promise<string> {
  const profile = normalizeProfileName(input.profile)
  const origin = normalizeCredentialOrigin(input.origin)
  const credential = normalizeCredentialMetadata(input.credential)
  const configPath = getConfigFilePath(options)
  return withFileLock(configPath, async () => {
    let existing: ModellixConfig | undefined
    try {
      existing = await readStoredConfig(options)
    } catch (error) {
      if (!input.recover) throw error
    }

    if (existing?.legacyApiKeys && Object.keys(existing.legacyApiKeys).length > 0) {
      throw new LegacyCredentialMigrationRequiredError()
    }

    const profiles = cloneProfiles(existing?.profiles)
    if (!Object.hasOwn(profiles, profile) && Object.keys(profiles).length >= MAX_PROFILE_COUNT) {
      throw new Error(`Cannot save Modellix config: at most ${MAX_PROFILE_COUNT} profiles are allowed.`)
    }

    const origins = cloneOrigins(profiles[profile]?.origins)
    origins[origin] = credential
    profiles[profile] = {origins}
    const currentProfile = input.setCurrent === false
      ? existing?.currentProfile ?? profile
      : profile
    return writeStoredConfig({
      currentProfile,
      profiles,
      schemaVersion: CONFIG_SCHEMA_VERSION,
    }, options)
  })
}

export async function writeConfig(
  input: WriteConfigInput,
  options: ConfigPathOptions = {},
): Promise<string> {
  const origin = normalizeCredentialOrigin(
    input.origin || process.env.MODELLIX_BASE_URL || DEFAULT_API_ORIGIN,
  )
  const profile = normalizeProfileName(input.profile)
  const apiKey = normalizeApiKey(input.apiKey)
  const {
    createCredentialReference,
    deleteStoredCredential,
    readStoredCredential,
    writeStoredCredential,
  } = await import('./credential-store.js')
  const credentialRef = createCredentialReference(origin, profile)
  const metadata: CredentialMetadata = {credentialRef, store: 'file'}
  let config: ModellixConfig | undefined
  try {
    config = await readConfig(options)
  } catch (error) {
    if (!input.recover) throw error
  }

  const previousMetadata = config?.profiles[profile]?.origins[origin]
  const previousApiKey = previousMetadata
    ? await readStoredCredential(previousMetadata, options)
    : undefined
  if (Object.hasOwn(input, 'expectedApiKey')) {
    const matches = input.expectedApiKey === null
      ? previousApiKey === undefined
      : previousApiKey === input.expectedApiKey
    if (!matches) {
      throw new Error(`Profile ${profile} changed while the API key was being validated. Review it and retry.`)
    }
  }

  await writeStoredCredential('file', credentialRef, apiKey, options)
  try {
    const configPath = await writeProfileMetadata({
      credential: metadata,
      origin,
      profile,
      recover: input.recover,
      setCurrent: input.setCurrent,
    }, options)
    if (previousMetadata && previousMetadata.store !== 'file') {
      await deleteStoredCredential(previousMetadata, options).catch(() => {})
    }

    return configPath
  } catch (error) {
    const rollbackErrors: unknown[] = []
    try {
      await deleteStoredCredential(metadata, options)
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError)
    }

    if (previousApiKey && previousMetadata) {
      try {
        await writeStoredCredential(
          previousMetadata.store,
          previousMetadata.credentialRef,
          previousApiKey,
          options,
        )
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }

    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Unable to write profile ${profile}; restoring its previous credential state also failed.`,
      )
    }

    throw error
  }
}

export async function replaceWithMetadata(
  input: {currentProfile: string; profiles: Record<string, ModellixProfile>},
  options: ConfigPathOptions = {},
): Promise<string> {
  const currentProfile = normalizeProfileName(input.currentProfile)
  const profiles = normalizeProfiles(input.profiles)
  if (!Object.hasOwn(profiles, currentProfile)) {
    throw new Error('Cannot write Modellix config: currentProfile does not exist in profiles.')
  }

  const configPath = getConfigFilePath(options)
  return withFileLock(configPath, async () => writeStoredConfig({
    currentProfile,
    profiles,
    schemaVersion: CONFIG_SCHEMA_VERSION,
  }, options))
}

export async function removeProfile(
  profile: string,
  options: ConfigPathOptions = {},
): Promise<ProfileRemovalResult> {
  const normalizedProfile = normalizeProfileName(profile)
  const configPath = getConfigFilePath(options)
  return withFileLock(configPath, async () => {
    const stored = await readStoredConfig(options)
    if (!stored || !Object.hasOwn(stored.profiles, normalizedProfile)) {
      return {
        currentProfile: stored?.currentProfile,
        origins: [],
        remainingProfiles: stored ? Object.keys(stored.profiles) : [],
        removed: false,
      }
    }

    const profileValue = stored.profiles[normalizedProfile]
    const origins = Object.entries(profileValue.origins).map(([origin, metadata]) => ({metadata, origin}))
    const legacyApiKey = stored.legacyApiKeys?.[normalizedProfile]
    const profiles = cloneProfiles(stored.profiles)
    delete profiles[normalizedProfile]
    const remainingProfiles = Object.keys(profiles)
    if (remainingProfiles.length === 0) {
      await removeConfigUnlocked(options)
      return {legacyApiKey, origins, remainingProfiles, removed: true}
    }

    const currentProfile = stored.currentProfile === normalizedProfile
      ? remainingProfiles[0]
      : stored.currentProfile
    if (stored.legacyApiKeys) {
      const remainingLegacy = cloneLegacyKeys(stored.legacyApiKeys)
      delete remainingLegacy[normalizedProfile]
      await writeLegacyConfig({currentProfile, legacyApiKeys: remainingLegacy}, options)
    } else {
      await writeStoredConfig({
        currentProfile,
        profiles,
        schemaVersion: CONFIG_SCHEMA_VERSION,
      }, options)
    }

    return {currentProfile, legacyApiKey, origins, remainingProfiles, removed: true}
  })
}

export async function removeConfig(options: ConfigPathOptions = {}): Promise<boolean> {
  const configPath = getConfigFilePath(options)
  return withFileLock(configPath, async () => removeConfigUnlocked(options))
}

async function removeConfigUnlocked(options: ConfigPathOptions): Promise<boolean> {
  const configPath = getConfigFilePath(options)
  try {
    await unlink(configPath)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw new Error(`Unable to remove Modellix config at ${configPath}.`, {cause: error})
  }
}


async function readStoredConfig(options: ConfigPathOptions): Promise<ModellixConfig | undefined> {
  const configPath = getConfigFilePath(options)
  let contents: string
  try {
    const configStats = await lstat(configPath)
    if (!configStats.isFile() || configStats.isSymbolicLink()) {
      throw new Error('Modellix config must be a regular file, not a symbolic link.')
    }

    contents = await readUtf8FileLimited(configPath, MAX_CONFIG_BYTES, 'Modellix config')
    if (process.platform !== 'win32') await chmod(configPath, 0o600)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    if (error instanceof InputFileSizeLimitError) throw error
    throw new Error(`Unable to read Modellix config at ${configPath}.`, {cause: error})
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents) as unknown
  } catch (error) {
    throw new Error(`Invalid JSON in Modellix config at ${configPath}.`, {cause: error})
  }

  if (!isRecord(parsed)) throw invalidConfigError(configPath)
  if (parsed.schemaVersion === CONFIG_SCHEMA_VERSION) {
    const profiles = normalizeProfiles(parsed.profiles)
    const currentProfile = typeof parsed.currentProfile === 'string'
      ? normalizeProfileName(parsed.currentProfile)
      : DEFAULT_PROFILE
    if (!Object.hasOwn(profiles, currentProfile)) {
      throw new Error(`Invalid Modellix config at ${configPath}: currentProfile does not exist in profiles.`)
    }

    return {currentProfile, profiles, schemaVersion: CONFIG_SCHEMA_VERSION}
  }

  return parseLegacyConfig(parsed, configPath)
}

function parseLegacyConfig(parsed: Record<string, unknown>, configPath: string): ModellixConfig {
  const legacyApiKeys = createLegacyMap()
  if (isRecord(parsed.profiles)) {
    if (Object.keys(parsed.profiles).length > MAX_PROFILE_COUNT) throw invalidConfigError(configPath)
    for (const [rawName, rawProfile] of Object.entries(parsed.profiles)) {
      if (!isRecord(rawProfile) || typeof rawProfile.apiKey !== 'string') throw invalidConfigError(configPath)
      const profileName = normalizeProfileName(rawName)
      legacyApiKeys[profileName] = normalizeApiKey(rawProfile.apiKey, 'Saved Modellix apiKey')
    }
  } else if (typeof parsed.apiKey === 'string') {
    legacyApiKeys[DEFAULT_PROFILE] = normalizeApiKey(parsed.apiKey, 'Saved Modellix apiKey')
  } else {
    throw invalidConfigError(configPath)
  }

  const profileNames = Object.keys(legacyApiKeys)
  if (profileNames.length === 0) throw invalidConfigError(configPath)
  const currentProfile = typeof parsed.currentProfile === 'string'
    ? normalizeProfileName(parsed.currentProfile)
    : profileNames[0]
  if (!Object.hasOwn(legacyApiKeys, currentProfile)) {
    throw new Error(`Invalid Modellix config at ${configPath}: currentProfile does not exist in profiles.`)
  }

  const profiles = createProfileMap()
  for (const profile of profileNames) profiles[profile] = {origins: createOriginMap()}
  const config = {currentProfile, profiles, schemaVersion: 1} as ModellixConfig
  Object.defineProperty(config, 'legacyApiKeys', {enumerable: false, value: legacyApiKeys})
  return config
}

async function writeLegacyConfig(
  input: {currentProfile: string; legacyApiKeys: Record<string, string>},
  options: ConfigPathOptions,
): Promise<string> {
  const serializableProfiles = Object.fromEntries(
    Object.entries(input.legacyApiKeys).map(([profile, apiKey]) => [profile, {apiKey}]),
  )
  return writePayload({currentProfile: input.currentProfile, profiles: serializableProfiles}, options)
}

async function writeStoredConfig(config: StoredConfig, options: ConfigPathOptions): Promise<string> {
  const serializableProfiles = Object.fromEntries(
    Object.entries(config.profiles).map(([profile, value]) => [profile, {
      origins: Object.fromEntries(Object.entries(value.origins)),
    }]),
  )
  return writePayload({
    currentProfile: config.currentProfile,
    profiles: serializableProfiles,
    schemaVersion: CONFIG_SCHEMA_VERSION,
  }, options)
}

async function writePayload(payloadValue: unknown, options: ConfigPathOptions): Promise<string> {
  const configPath = getConfigFilePath(options)
  const configDirectory = dirname(configPath)
  const temporaryPath = join(configDirectory, `.config.${process.pid}.${randomUUID()}.tmp`)
  const payload = `${JSON.stringify(payloadValue, null, 2)}\n`
  if (Buffer.byteLength(payload) > MAX_CONFIG_BYTES) {
    throw new Error(`Modellix config exceeds the ${MAX_CONFIG_BYTES}-byte limit.`)
  }

  let temporaryHandle: Awaited<ReturnType<typeof open>> | undefined
  try {
    await mkdir(configDirectory, {mode: 0o700, recursive: true})
    if (process.platform !== 'win32') await chmod(configDirectory, 0o700)
    temporaryHandle = await open(temporaryPath, 'wx', 0o600)
    await temporaryHandle.writeFile(payload, 'utf8')
    await temporaryHandle.sync()
    await temporaryHandle.close()
    temporaryHandle = undefined
    await rename(temporaryPath, configPath)
    if (process.platform !== 'win32') await chmod(configPath, 0o600)
  } catch (error) {
    await temporaryHandle?.close().catch(() => {})
    await unlink(temporaryPath).catch(() => {})
    throw new Error(`Unable to write Modellix config at ${configPath}.`, {cause: error})
  }

  return configPath
}

function normalizeProfiles(value: unknown): Record<string, ModellixProfile> {
  if (!isRecord(value) || Object.keys(value).length === 0 || Object.keys(value).length > MAX_PROFILE_COUNT) {
    throw new Error('Invalid Modellix config: expected a non-empty profiles map.')
  }

  const profiles = createProfileMap()
  for (const [rawProfile, rawValue] of Object.entries(value)) {
    const profile = normalizeProfileName(rawProfile)
    if (!isRecord(rawValue) || !isRecord(rawValue.origins)) {
      throw new Error('Invalid Modellix config: expected profile origins metadata.')
    }

    const origins = createOriginMap()
    for (const [rawOrigin, rawMetadata] of Object.entries(rawValue.origins)) {
      const origin = normalizeCredentialOrigin(rawOrigin)
      if (!isRecord(rawMetadata)) throw new Error('Invalid Modellix credential metadata.')
      origins[origin] = normalizeCredentialMetadata(rawMetadata)
    }

    profiles[profile] = {origins}
  }

  return profiles
}

function normalizeCredentialMetadata(value: unknown): CredentialMetadata {
  if (!isRecord(value) || (value.store !== 'keychain' && value.store !== 'file')) {
    throw new Error('Invalid Modellix credential metadata store.')
  }

  if (typeof value.credentialRef !== 'string') {
    throw new TypeError('Invalid Modellix credential metadata reference.')
  }

  return {
    credentialRef: normalizeSafeText(value.credentialRef, 'Credential reference', 512),
    store: value.store,
  }
}

function cloneProfiles(profiles?: Record<string, ModellixProfile>): Record<string, ModellixProfile> {
  const cloned = createProfileMap()
  for (const [profile, value] of Object.entries(profiles ?? {})) {
    cloned[profile] = {origins: cloneOrigins(value.origins)}
  }

  return cloned
}

function cloneOrigins(origins?: Record<string, CredentialMetadata>): Record<string, CredentialMetadata> {
  const cloned = createOriginMap()
  for (const [origin, value] of Object.entries(origins ?? {})) cloned[origin] = {...value}
  return cloned
}

function cloneLegacyKeys(keys: Record<string, string>): Record<string, string> {
  const cloned = createLegacyMap()
  for (const [profile, value] of Object.entries(keys)) cloned[profile] = value
  return cloned
}

function createProfileMap(): Record<string, ModellixProfile> {
  return Object.create(null) as Record<string, ModellixProfile>
}

function createOriginMap(): Record<string, CredentialMetadata> {
  return Object.create(null) as Record<string, CredentialMetadata>
}

function createLegacyMap(): Record<string, string> {
  return Object.create(null) as Record<string, string>
}

function invalidConfigError(configPath: string): Error {
  return new Error(`Invalid Modellix config at ${configPath}: expected schemaVersion 2 metadata or a legacy API-key profile.`)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
