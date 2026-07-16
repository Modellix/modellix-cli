import {randomUUID} from 'node:crypto'
import {chmod, lstat, mkdir, open, rename, unlink} from 'node:fs/promises'
import {homedir} from 'node:os'
import {dirname, isAbsolute, join} from 'node:path'

import {withFileLock} from './file-lock.js'
import {InputFileSizeLimitError, readUtf8FileLimited} from './limited-input.js'
import {normalizeApiKey, normalizeSafeText} from './safe-text.js'

export const DEFAULT_PROFILE = 'default'
const RESERVED_PROFILE_NAMES = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_API_KEY_LENGTH = 16_384
const MAX_CONFIG_BYTES = 1024 * 1024
const MAX_PROFILE_COUNT = 100
const MAX_PROFILE_NAME_LENGTH = 64

export type ConfigPathOptions = {
  configHome?: string
  homeDirectory?: string
}

export type ModellixProfile = {
  apiKey: string
}

/**
 * The top-level apiKey is a compatibility alias for the current profile.
 * Profile metadata is exposed to callers but kept non-enumerable so legacy
 * callers that compare or serialize `{apiKey}` continue to behave as before.
 */
export type ModellixConfig = {
  apiKey: string
  currentProfile: string
  profiles: Record<string, ModellixProfile>
}

export type ProfileRemovalResult = {
  currentProfile?: string
  remainingProfiles: string[]
  removed: boolean
}

export type WriteConfigInput = {
  apiKey: string
  expectedApiKey?: null | string
  profile?: string
  recover?: boolean
  setCurrent?: boolean
}

type StoredConfig = {
  currentProfile: string
  profiles: Record<string, ModellixProfile>
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

  const configHome = configuredHome || join(userHome, '.config')

  return join(configHome, 'modellix', 'config.json')
}

export function normalizeProfileName(profile?: string): string {
  const normalized = profile?.trim() || DEFAULT_PROFILE
  if (normalized.length > MAX_PROFILE_NAME_LENGTH) {
    throw new Error(`Invalid profile name. Maximum length is ${MAX_PROFILE_NAME_LENGTH} characters.`)
  }

  if (!/^[\w.-]+$/u.test(normalized)) {
    throw new Error(
      'Invalid profile name. Use only letters, numbers, underscores, dots, and hyphens.',
    )
  }

  if (RESERVED_PROFILE_NAMES.has(normalized.toLowerCase())) {
    throw new Error(`Invalid profile name: ${normalized} is reserved.`)
  }

  return normalized
}

export async function readConfig(
  options: ConfigPathOptions = {},
): Promise<ModellixConfig | undefined> {
  const stored = await readStoredConfig(options)
  if (!stored) {
    return
  }

  return createCompatibleConfig(stored)
}

export async function writeConfig(
  input: WriteConfigInput,
  options: ConfigPathOptions = {},
): Promise<string> {
  const apiKey = normalizeApiKey(input.apiKey, 'Cannot save Modellix config: apiKey')

  const configPath = getConfigFilePath(options)
  return withFileLock(configPath, async () => {
    let existing: StoredConfig | undefined
    try {
      existing = await readStoredConfig(options)
    } catch (error) {
      if (!input.recover) throw error
    }

    const profile = input.profile
      ? normalizeProfileName(input.profile)
      : existing?.currentProfile ?? DEFAULT_PROFILE
    if (Object.hasOwn(input, 'expectedApiKey')) {
      const currentApiKey = existing?.profiles[profile]?.apiKey
      const expectationMatches = input.expectedApiKey === null
        ? currentApiKey === undefined
        : currentApiKey === input.expectedApiKey
      if (!expectationMatches) {
        throw new Error(
          `Profile ${profile} changed while the API key was being validated. Review the current profile and retry.`,
        )
      }
    }

    const profiles = cloneProfiles(existing?.profiles)
    if (!Object.hasOwn(profiles, profile) && Object.keys(profiles).length >= MAX_PROFILE_COUNT) {
      throw new Error(`Cannot save Modellix config: at most ${MAX_PROFILE_COUNT} profiles are allowed.`)
    }

    profiles[profile] = {apiKey}
    const currentProfile = input.setCurrent === false
      ? existing?.currentProfile ?? profile
      : profile

    return writeStoredConfig({currentProfile, profiles}, options)
  })
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
        remainingProfiles: stored ? Object.keys(stored.profiles) : [],
        removed: false,
      }
    }

    const profiles = cloneProfiles(stored.profiles)
    delete profiles[normalizedProfile]
    const remainingProfiles = Object.keys(profiles)
    if (remainingProfiles.length === 0) {
      await removeConfigUnlocked(options)
      return {remainingProfiles, removed: true}
    }

    const currentProfile = stored.currentProfile === normalizedProfile
      ? remainingProfiles[0]
      : stored.currentProfile
    await writeStoredConfig({currentProfile, profiles}, options)
    return {currentProfile, remainingProfiles, removed: true}
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
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false
    }

    throw new Error(`Unable to remove Modellix config at ${configPath}.`, {cause: error})
  }
}

// Schema migration, size/security validation, and legacy compatibility are centralized here.
// eslint-disable-next-line complexity
async function readStoredConfig(
  options: ConfigPathOptions,
): Promise<StoredConfig | undefined> {
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
    if (isNodeError(error) && error.code === 'ENOENT') {
      return
    }

    if (error instanceof InputFileSizeLimitError) throw error
    throw new Error(`Unable to read Modellix config at ${configPath}.`, {cause: error})
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents) as unknown
  } catch (error) {
    throw new Error(`Invalid JSON in Modellix config at ${configPath}.`, {cause: error})
  }

  if (!isRecord(parsed)) {
    throw invalidConfigError(configPath)
  }

  if (isRecord(parsed.profiles)) {
    if (Object.keys(parsed.profiles).length > MAX_PROFILE_COUNT) {
      throw invalidConfigError(configPath)
    }

    const profiles = createProfileMap()
    for (const [rawName, rawProfile] of Object.entries(parsed.profiles)) {
      const profileName = normalizeProfileName(rawName)
      if (
        !isRecord(rawProfile)
        || typeof rawProfile.apiKey !== 'string'
        || !rawProfile.apiKey.trim()
        || rawProfile.apiKey.trim().length > MAX_API_KEY_LENGTH
      ) {
        throw invalidConfigError(configPath)
      }

      let apiKey: string
      try {
        apiKey = normalizeApiKey(rawProfile.apiKey, 'Saved Modellix apiKey')
      } catch {
        throw invalidConfigError(configPath)
      }

      profiles[profileName] = {apiKey}
    }

    const profileNames = Object.keys(profiles)
    if (profileNames.length === 0) {
      throw invalidConfigError(configPath)
    }

    const currentProfile = typeof parsed.currentProfile === 'string'
      ? normalizeProfileName(parsed.currentProfile)
      : DEFAULT_PROFILE
    if (!Object.hasOwn(profiles, currentProfile)) {
      throw new Error(
        `Invalid Modellix config at ${configPath}: currentProfile does not exist in profiles.`,
      )
    }

    return {currentProfile, profiles}
  }

  // Backward compatibility with the original `{apiKey}` file format.
  if (
    typeof parsed.apiKey === 'string'
    && parsed.apiKey.trim()
    && parsed.apiKey.trim().length <= MAX_API_KEY_LENGTH
  ) {
    const profiles = createProfileMap()
    let apiKey: string
    try {
      apiKey = normalizeApiKey(parsed.apiKey, 'Saved Modellix apiKey')
    } catch {
      throw invalidConfigError(configPath)
    }

    profiles[DEFAULT_PROFILE] = {apiKey}
    return {currentProfile: DEFAULT_PROFILE, profiles}
  }

  throw invalidConfigError(configPath)
}

async function writeStoredConfig(
  config: StoredConfig,
  options: ConfigPathOptions,
): Promise<string> {
  const configPath = getConfigFilePath(options)
  const configDirectory = dirname(configPath)
  const serializableProfiles = Object.fromEntries(
    Object.entries(config.profiles).map(([profile, value]) => [profile, {apiKey: value.apiKey}]),
  )
  const temporaryPath = join(
    configDirectory,
    `.config.${process.pid}.${randomUUID()}.tmp`,
  )
  const payload = `${JSON.stringify({currentProfile: config.currentProfile, profiles: serializableProfiles}, null, 2)}\n`
  if (Buffer.byteLength(payload) > MAX_CONFIG_BYTES) {
    throw new Error(`Modellix config exceeds the ${MAX_CONFIG_BYTES}-byte limit.`)
  }

  let temporaryHandle: Awaited<ReturnType<typeof open>> | undefined

  try {
    await mkdir(configDirectory, {mode: 0o700, recursive: true})

    if (process.platform !== 'win32') {
      await chmod(configDirectory, 0o700)
    }

    temporaryHandle = await open(temporaryPath, 'wx', 0o600)
    await temporaryHandle.writeFile(payload, 'utf8')
    await temporaryHandle.sync()
    await temporaryHandle.close()
    temporaryHandle = undefined
    await rename(temporaryPath, configPath)

    if (process.platform !== 'win32') {
      await chmod(configPath, 0o600)
    }
  } catch (error) {
    await temporaryHandle?.close().catch(() => {})
    await unlink(temporaryPath).catch(() => {})
    throw new Error(`Unable to write Modellix config at ${configPath}.`, {cause: error})
  }

  return configPath
}

function cloneProfiles(
  profiles?: Record<string, ModellixProfile>,
): Record<string, ModellixProfile> {
  const cloned = createProfileMap()
  for (const [profile, value] of Object.entries(profiles ?? {})) {
    cloned[profile] = {apiKey: value.apiKey}
  }

  return cloned
}

function createProfileMap(): Record<string, ModellixProfile> {
  return Object.create(null) as Record<string, ModellixProfile>
}

function createCompatibleConfig(stored: StoredConfig): ModellixConfig {
  const result = {apiKey: stored.profiles[stored.currentProfile].apiKey} as ModellixConfig
  Object.defineProperties(result, {
    currentProfile: {enumerable: false, value: stored.currentProfile},
    profiles: {enumerable: false, value: cloneProfiles(stored.profiles)},
  })
  return result
}

function invalidConfigError(configPath: string): Error {
  return new Error(
    `Invalid Modellix config at ${configPath}: expected a non-empty apiKey or profiles map.`,
  )
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
