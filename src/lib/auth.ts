import {Flags} from '@oclif/core'
import {dirname, join} from 'node:path'

import {
  type ConfigPathOptions,
  type CredentialMetadata,
  type CredentialStoreKind,
  DEFAULT_PROFILE,
  getConfigFilePath,
  type ModellixConfig,
  type ModellixProfile,
  normalizeCredentialOrigin,
  normalizeProfileName,
  readConfig,
  removeProfile,
  replaceWithMetadata,
  writeProfileMetadata,
} from './config.js'
import {
  createCredentialReference,
  deleteStoredCredential,
  readStoredCredential,
  writeStoredCredential,
} from './credential-store.js'
import {withFileLock} from './file-lock.js'
import {resolveBaseUrl} from './modellix-client.js'
import {normalizeApiKey} from './safe-text.js'

export const MODELLIX_API_KEY_ENV = 'MODELLIX_API_KEY'
export const MODELLIX_PROFILE_ENV = 'MODELLIX_PROFILE'

export const apiKeyFlag = Flags.string({
  description: 'Modellix API key (overrides environment and saved configuration)',
})

export const profileFlag = Flags.string({
  description: `Configuration profile (overrides ${MODELLIX_PROFILE_ENV} and the current profile)`,
})

export const credentialStoreFlag = Flags.string({
  default: 'keychain',
  description: 'Persistent credential store (file is an explicit plaintext fallback)',
  options: ['keychain', 'file'],
})

export type ApiKeySource = 'environment' | 'file' | 'flag' | 'keychain' | 'legacy-file'
export type ProfileSource = 'config' | 'default' | 'environment' | 'flag'

export type ApiKeyLookupOptions = ConfigPathOptions & {
  apiKey?: string
  ignoreEnvironment?: boolean
  origin?: string
  profile?: string
}

export type ProfileSelection = {
  profile: string
  source: ProfileSource
}

export type ResolvedApiKey = {
  apiKey: string
  credentialRef?: string
  origin: string
  profile: string
  profileSource: ProfileSource
  source: ApiKeySource
}

export type SaveApiKeyInput = ConfigPathOptions & {
  apiKey: string
  expectedApiKey?: null | string
  origin?: string
  profile?: string
  recover?: boolean
  setCurrent?: boolean
  store?: CredentialStoreKind
}

export async function resolveProfile(
  flagProfile?: string,
  options: ConfigPathOptions = {},
): Promise<ProfileSelection> {
  const config = await readConfig(options)
  return selectProfile(flagProfile, config)
}

export async function findApiKey(
  flagApiKeyOrOptions?: ApiKeyLookupOptions | string,
  flagProfile?: string,
): Promise<ResolvedApiKey | undefined> {
  const options = normalizeLookupOptions(flagApiKeyOrOptions, flagProfile)
  const flagKey = options.apiKey?.trim()
  const environmentKey = options.ignoreEnvironment
    ? undefined
    : process.env[MODELLIX_API_KEY_ENV]?.trim()
  const origin = options.origin ? normalizeCredentialOrigin(options.origin) : resolveBaseUrl()
  let config: ModellixConfig | undefined

  try {
    config = await readConfig(options)
  } catch (error) {
    if (!flagKey && !environmentKey) throw error
  }

  const selected = selectProfile(options.profile, config)
  if (flagKey) {
    return {
      apiKey: normalizeApiKey(flagKey),
      origin,
      profile: selected.profile,
      profileSource: selected.source,
      source: 'flag',
    }
  }

  if (environmentKey) {
    return {
      apiKey: normalizeApiKey(environmentKey),
      origin,
      profile: selected.profile,
      profileSource: selected.source,
      source: 'environment',
    }
  }

  const legacyApiKey = config?.legacyApiKeys?.[selected.profile]
  if (legacyApiKey) {
    return {
      apiKey: legacyApiKey,
      origin,
      profile: selected.profile,
      profileSource: selected.source,
      source: 'legacy-file',
    }
  }

  const metadata = config?.profiles[selected.profile]?.origins[origin]
  if (!metadata) return
  const apiKey = await readStoredCredential(metadata, options)
  if (!apiKey) return
  return {
    apiKey,
    credentialRef: metadata.credentialRef,
    origin,
    profile: selected.profile,
    profileSource: selected.source,
    source: metadata.store,
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
      `Missing API key for the selected profile and API origin. Provide --api-key, set ${MODELLIX_API_KEY_ENV}, or run modellix-cli auth login.`,
    )
  }

  return resolved
}

export async function saveApiKey(input: SaveApiKeyInput): Promise<{
  configPath: string
  credentialRef: string
  origin: string
  profile: string
  store: CredentialStoreKind
}> {
  const apiKey = normalizeApiKey(input.apiKey)
  const profile = normalizeProfileName(input.profile)
  const origin = input.origin ? normalizeCredentialOrigin(input.origin) : resolveBaseUrl()
  const store = input.store ?? 'keychain'
  const credentialRef = createCredentialReference(origin, profile)
  const metadata: CredentialMetadata = {credentialRef, store}
  const options = configOptions(input)
  const transactionPath = getAuthTransactionPath(options)

  return withFileLock(transactionPath, async () => {
    let config: ModellixConfig | undefined
    try {
      config = await readConfig(options)
    } catch (error) {
      if (!input.recover) throw error
    }

    if (config?.legacyApiKeys && Object.keys(config.legacyApiKeys).length > 0) {
      throw new Error('Legacy plaintext credentials are still configured. Run modellix-cli auth migrate --to keychain before saving another profile.')
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

    await writeStoredCredential(store, credentialRef, apiKey, options)
    let metadataCommitted = false
    try {
      const configPath = await writeProfileMetadata({
        credential: metadata,
        origin,
        profile,
        recover: input.recover,
        setCurrent: input.setCurrent,
      }, options)
      metadataCommitted = true
      if (previousMetadata && previousMetadata.store !== store) {
        await deleteStoredCredential(previousMetadata, options)
      }

      return {configPath, credentialRef, origin, profile, store}
    } catch (error) {
      const rollbackErrors = metadataCommitted && previousMetadata && config
        ? await rollbackCommittedReplacement({
          config,
          metadata,
          options,
          previousApiKey,
          previousMetadata,
        })
        : await rollbackUncommittedCredential({
          metadata,
          options,
          previousApiKey,
          previousMetadata,
        })
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          `Unable to save profile ${profile}; restoring its previous credential state also failed.`,
        )
      }

      throw error
    }
  })
}

export async function removeSavedProfile(
  profile: string,
  options: ConfigPathOptions = {},
): Promise<Awaited<ReturnType<typeof removeProfile>>> {
  const normalizedProfile = normalizeProfileName(profile)
  return withFileLock(getAuthTransactionPath(options), async () => {
    const config = await readConfig(options)
    const profileConfig = config?.profiles[normalizedProfile]
    const backups: Array<{apiKey?: string; metadata: CredentialMetadata}> = []
    try {
      for (const metadata of Object.values(profileConfig?.origins ?? {})) {
        // Sequential access avoids racing platform credential-store prompts.
        // eslint-disable-next-line no-await-in-loop
        const apiKey = await readStoredCredential(metadata, options)
        backups.push({apiKey, metadata})
        // eslint-disable-next-line no-await-in-loop
        await deleteStoredCredential(metadata, options)
      }

      return await removeProfile(normalizedProfile, options)
    } catch (error) {
      const rollbackErrors = await restoreCredentialBackups(backups, options)
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          `Unable to remove profile ${normalizedProfile}; restoring its credentials also failed.`,
        )
      }

      throw error
    }
  })
}

export async function migrateLegacyCredentials(input: ConfigPathOptions & {
  origin?: string
  to: CredentialStoreKind
}): Promise<{
  configPath: string
  migrated: boolean
  origin: string
  profiles: string[]
  store: CredentialStoreKind
}> {
  const options = configOptions(input)
  const origin = input.origin ? normalizeCredentialOrigin(input.origin) : resolveBaseUrl()
  return withFileLock(getAuthTransactionPath(options), async () => {
    const config = await readConfig(options)
    const legacyApiKeys = config?.legacyApiKeys
    if (!config || !legacyApiKeys || Object.keys(legacyApiKeys).length === 0) {
      return {
        configPath: getConfigFilePath(options),
        migrated: false,
        origin,
        profiles: config ? Object.keys(config.profiles) : [],
        store: input.to,
      }
    }

    const profiles = createProfileMap()
    const written: Array<{metadata: CredentialMetadata; previous?: string}> = []
    try {
      for (const [profile, apiKey] of Object.entries(legacyApiKeys)) {
        const credentialRef = createCredentialReference(origin, profile)
        const metadata: CredentialMetadata = {credentialRef, store: input.to}
        // eslint-disable-next-line no-await-in-loop
        const previous = await readStoredCredential(metadata, options)
        // eslint-disable-next-line no-await-in-loop
        await writeStoredCredential(input.to, credentialRef, apiKey, options)
        written.push({metadata, previous})
        profiles[profile] = {origins: {[origin]: metadata}}
      }

      const configPath = await replaceWithMetadata({
        currentProfile: config.currentProfile,
        profiles,
      }, options)
      return {
        configPath,
        migrated: true,
        origin,
        profiles: Object.keys(profiles),
        store: input.to,
      }
    } catch (error) {
      const rollbackErrors: unknown[] = []
      for (const item of written.reverse()) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await rollbackCredential({
            apiKey: item.previous,
            metadata: item.metadata,
            options,
          })
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }

      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          'Credential migration failed, and restoring the previous credential state also failed.',
        )
      }

      throw error
    }
  })
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
  if (explicitProfile) return {profile: normalizeProfileName(explicitProfile), source: 'flag'}
  const environmentProfile = process.env[MODELLIX_PROFILE_ENV]?.trim()
  if (environmentProfile) {
    return {profile: normalizeProfileName(environmentProfile), source: 'environment'}
  }

  if (config) return {profile: config.currentProfile, source: 'config'}
  return {profile: DEFAULT_PROFILE, source: 'default'}
}

function configOptions(input: ConfigPathOptions): ConfigPathOptions {
  return {configHome: input.configHome, homeDirectory: input.homeDirectory}
}

function getAuthTransactionPath(options: ConfigPathOptions): string {
  return join(dirname(getConfigFilePath(options)), 'auth-transaction.json')
}

async function rollbackCredential(input: {
  apiKey?: string
  metadata: CredentialMetadata
  options: ConfigPathOptions
}): Promise<void> {
  await (input.apiKey ? writeStoredCredential(
      input.metadata.store,
      input.metadata.credentialRef,
      input.apiKey,
      input.options,
    ) : deleteStoredCredential(input.metadata, input.options));
}

async function rollbackCommittedReplacement(input: {
  config: ModellixConfig
  metadata: CredentialMetadata
  options: ConfigPathOptions
  previousApiKey?: string
  previousMetadata: CredentialMetadata
}): Promise<unknown[]> {
  const rollbackErrors: unknown[] = []
  if (input.previousApiKey) {
    try {
      await writeStoredCredential(
        input.previousMetadata.store,
        input.previousMetadata.credentialRef,
        input.previousApiKey,
        input.options,
      )
    } catch (error) {
      rollbackErrors.push(error)
      return rollbackErrors
    }
  }

  try {
    await replaceWithMetadata({
      currentProfile: input.config.currentProfile,
      profiles: input.config.profiles,
    }, input.options)
  } catch (error) {
    rollbackErrors.push(error)
    return rollbackErrors
  }

  try {
    await deleteStoredCredential(input.metadata, input.options)
  } catch (error) {
    rollbackErrors.push(error)
  }

  return rollbackErrors
}

async function rollbackUncommittedCredential(input: {
  metadata: CredentialMetadata
  options: ConfigPathOptions
  previousApiKey?: string
  previousMetadata?: CredentialMetadata
}): Promise<unknown[]> {
  const rollbackErrors: unknown[] = []
  try {
    await deleteStoredCredential(input.metadata, input.options)
  } catch (error) {
    rollbackErrors.push(error)
  }

  if (input.previousApiKey && input.previousMetadata) {
    try {
      await writeStoredCredential(
        input.previousMetadata.store,
        input.previousMetadata.credentialRef,
        input.previousApiKey,
        input.options,
      )
    } catch (error) {
      rollbackErrors.push(error)
    }
  }

  return rollbackErrors
}

async function restoreCredentialBackups(
  backups: Array<{apiKey?: string; metadata: CredentialMetadata}>,
  options: ConfigPathOptions,
): Promise<unknown[]> {
  const rollbackErrors: unknown[] = []
  for (const backup of backups.reverse()) {
    if (!backup.apiKey) continue
    try {
      // Credential stores may prompt, so restoration remains deliberately sequential.
      // eslint-disable-next-line no-await-in-loop
      await writeStoredCredential(
        backup.metadata.store,
        backup.metadata.credentialRef,
        backup.apiKey,
        options,
      )
    } catch (error) {
      rollbackErrors.push(error)
    }
  }

  return rollbackErrors
}

function createProfileMap(): Record<string, ModellixProfile> {
  return Object.create(null) as Record<string, ModellixProfile>
}
