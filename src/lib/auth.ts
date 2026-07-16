import {Flags} from '@oclif/core'

import {
  DEFAULT_PROFILE,
  type ModellixConfig,
  normalizeProfileName,
  readConfig,
} from './config.js'

export const MODELLIX_API_KEY_ENV = 'MODELLIX_API_KEY'
export const MODELLIX_PROFILE_ENV = 'MODELLIX_PROFILE'

export const apiKeyFlag = Flags.string({
  description: 'Modellix API key (overrides environment and saved configuration)',
})

export const profileFlag = Flags.string({
  description: `Configuration profile (overrides ${MODELLIX_PROFILE_ENV} and the current profile)`,
})

export type ApiKeySource = 'config' | 'environment' | 'flag'
export type ProfileSource = 'config' | 'default' | 'environment' | 'flag'

export type ApiKeyLookupOptions = {
  apiKey?: string
  profile?: string
}

export type ProfileSelection = {
  profile: string
  source: ProfileSource
}

export type ResolvedApiKey = {
  apiKey: string
  profile: string
  profileSource: ProfileSource
  source: ApiKeySource
}

export async function resolveProfile(flagProfile?: string): Promise<ProfileSelection> {
  const config = await readConfig()
  return selectProfile(flagProfile, config)
}

export async function findApiKey(
  flagApiKeyOrOptions?: ApiKeyLookupOptions | string,
  flagProfile?: string,
): Promise<ResolvedApiKey | undefined> {
  const options = normalizeLookupOptions(flagApiKeyOrOptions, flagProfile)
  const flagKey = options.apiKey?.trim()
  const environmentKey = process.env[MODELLIX_API_KEY_ENV]?.trim()
  let config: ModellixConfig | undefined

  try {
    config = await readConfig()
  } catch (error) {
    // A higher-priority key remains usable even when the saved config needs repair.
    if (!flagKey && !environmentKey) {
      throw error
    }
  }

  const selected = selectProfile(options.profile, config)
  if (flagKey) {
    return {
      apiKey: flagKey,
      profile: selected.profile,
      profileSource: selected.source,
      source: 'flag',
    }
  }

  if (environmentKey) {
    return {
      apiKey: environmentKey,
      profile: selected.profile,
      profileSource: selected.source,
      source: 'environment',
    }
  }

  const profileConfig = config && Object.hasOwn(config.profiles, selected.profile)
    ? config.profiles[selected.profile]
    : undefined
  if (profileConfig) {
    return {
      apiKey: profileConfig.apiKey,
      profile: selected.profile,
      profileSource: selected.source,
      source: 'config',
    }
  }
}

export async function resolveApiKey(
  flagApiKeyOrOptions?: ApiKeyLookupOptions | string,
  flagProfile?: string,
): Promise<string> {
  return (await resolveApiKeyDetails(flagApiKeyOrOptions, flagProfile)).apiKey
}

export async function resolveApiKeyDetails(
  flagApiKeyOrOptions?: ApiKeyLookupOptions | string,
  flagProfile?: string,
): Promise<ResolvedApiKey> {
  const resolved = await findApiKey(flagApiKeyOrOptions, flagProfile)
  if (!resolved) {
    throw new Error(
      `Missing API key for the selected profile. Provide --api-key, set ${MODELLIX_API_KEY_ENV}, or run modellix-cli auth login.`,
    )
  }

  return resolved
}

function normalizeLookupOptions(
  flagApiKeyOrOptions?: ApiKeyLookupOptions | string,
  flagProfile?: string,
): ApiKeyLookupOptions {
  if (typeof flagApiKeyOrOptions === 'string' || flagApiKeyOrOptions === undefined) {
    return {apiKey: flagApiKeyOrOptions, profile: flagProfile}
  }

  return flagApiKeyOrOptions
}

function selectProfile(
  flagProfile: string | undefined,
  config: ModellixConfig | undefined,
): ProfileSelection {
  const explicitProfile = flagProfile?.trim()
  if (explicitProfile) {
    return {profile: normalizeProfileName(explicitProfile), source: 'flag'}
  }

  const environmentProfile = process.env[MODELLIX_PROFILE_ENV]?.trim()
  if (environmentProfile) {
    return {profile: normalizeProfileName(environmentProfile), source: 'environment'}
  }

  if (config) {
    return {profile: config.currentProfile, source: 'config'}
  }

  return {profile: DEFAULT_PROFILE, source: 'default'}
}
