import {Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../../base-command.js'
import {
  apiKeyFlag,
  type ApiKeySource,
  findApiKey,
  MODELLIX_PROFILE_ENV,
  profileFlag,
} from '../../lib/auth.js'
import {DEFAULT_PROFILE, getConfigFilePath, normalizeProfileName} from '../../lib/config.js'
import {getTeamBalance, validateApiKey} from '../../lib/modellix-client.js'

type AuthStatusResult = {
  apiKeySource: 'missing' | ApiKeySource
  authenticated: boolean
  balance?: number
  configPath: string
  credentialStore?: 'file' | 'keychain'
  migrationRequired?: boolean
  ok: boolean
  origin?: string
  profile: string
  profileSource: 'config' | 'default' | 'environment' | 'flag'
  valid: boolean
  warning?: string
}

export default class AuthStatus extends BaseCommand {
  static description = 'Show and verify the active Modellix authentication without revealing the key'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --profile work --json',
    '<%= config.bin %> <%= command.id %> --ignore-env --json',
    '<%= config.bin %> <%= command.id %> --api-key <key>',
  ]
  static flags = {
    'api-key': apiKeyFlag,
    'ignore-env': Flags.boolean({description: 'Ignore MODELLIX_API_KEY and inspect persistent credentials only'}),
    json: Flags.boolean({description: 'Print one machine-readable JSON result'}),
    profile: profileFlag,
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AuthStatus)
    const result = await getStatus(flags['api-key'], flags.profile, flags['ignore-env'])
    const outputMode = resolveOutputMode(flags)

    if (outputMode === 'json') {
      this.log(JSON.stringify(result, null, 2))
    } else if (outputMode === 'quiet') {
      if (result.ok) this.log(result.profile)
    } else {
      this.log(`Profile: ${result.profile} (${result.profileSource})`)
      this.log(`API key source: ${result.apiKeySource}`)
      if (result.origin) this.log(`API origin: ${result.origin}`)
      if (result.migrationRequired) this.log('Migration required: run modellix-cli auth migrate --to keychain')
      this.log(`Validation: ${result.valid ? 'valid' : 'not authenticated'}`)
      if (result.balance !== undefined) {
        this.log(`Team balance: $${result.balance.toFixed(4)} USD`)
      }

      if (result.warning) {
        this.log(`Warning: ${result.warning}`)
      }
    }

    if (!result.ok) {
      this.exit(1)
    }
  }
}

async function getStatus(
  flagApiKey?: string,
  flagProfile?: string,
  ignoreEnvironment = false,
): Promise<AuthStatusResult> {
  const configPath = getConfigFilePath()
  const fallback = getFallbackProfile(flagProfile)
  let resolved: Awaited<ReturnType<typeof findApiKey>>
  try {
    resolved = await findApiKey({apiKey: flagApiKey, ignoreEnvironment, profile: flagProfile})
  } catch (error) {
    return {
      apiKeySource: 'missing',
      authenticated: false,
      configPath,
      ok: false,
      profile: fallback.profile,
      profileSource: fallback.source,
      valid: false,
      warning: errorMessage(error),
    }
  }

  if (!resolved) {
    return {
      apiKeySource: 'missing',
      authenticated: false,
      configPath,
      ok: false,
      profile: fallback.profile,
      profileSource: fallback.source,
      valid: false,
    }
  }

  try {
    const valid = await validateApiKey({apiKey: resolved.apiKey})
    if (!valid) {
      return {
        apiKeySource: resolved.source,
        authenticated: true,
        configPath,
        ...(resolved.source === 'file' || resolved.source === 'keychain'
          ? {credentialStore: resolved.source}
          : {}),
        migrationRequired: resolved.source === 'legacy-file',
        ok: false,
        origin: resolved.origin,
        profile: resolved.profile,
        profileSource: resolved.profileSource,
        valid: false,
      }
    }

    try {
      const balance = await getTeamBalance({apiKey: resolved.apiKey})
      return {
        apiKeySource: resolved.source,
        authenticated: true,
        balance,
        configPath,
        ...(resolved.source === 'file' || resolved.source === 'keychain'
          ? {credentialStore: resolved.source}
          : {}),
        migrationRequired: resolved.source === 'legacy-file',
        ok: true,
        origin: resolved.origin,
        profile: resolved.profile,
        profileSource: resolved.profileSource,
        valid: true,
      }
    } catch (error) {
      return {
        apiKeySource: resolved.source,
        authenticated: true,
        configPath,
        ...(resolved.source === 'file' || resolved.source === 'keychain'
          ? {credentialStore: resolved.source}
          : {}),
        migrationRequired: resolved.source === 'legacy-file',
        ok: true,
        origin: resolved.origin,
        profile: resolved.profile,
        profileSource: resolved.profileSource,
        valid: true,
        warning: `Unable to read team balance. ${errorMessage(error)}`,
      }
    }
  } catch (error) {
    return {
      apiKeySource: resolved.source,
      authenticated: true,
      configPath,
      ...(resolved.source === 'file' || resolved.source === 'keychain'
        ? {credentialStore: resolved.source}
        : {}),
      migrationRequired: resolved.source === 'legacy-file',
      ok: false,
      origin: resolved.origin,
      profile: resolved.profile,
      profileSource: resolved.profileSource,
      valid: false,
      warning: errorMessage(error),
    }
  }
}

function getFallbackProfile(flagProfile?: string): {
  profile: string
  source: 'default' | 'environment' | 'flag'
} {
  const rawProfile = flagProfile || process.env[MODELLIX_PROFILE_ENV]
  const source = flagProfile ? 'flag' : rawProfile ? 'environment' : 'default'
  if (!rawProfile) return {profile: DEFAULT_PROFILE, source}
  try {
    return {profile: normalizeProfileName(rawProfile), source}
  } catch {
    return {profile: 'invalid', source}
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to verify Modellix authentication.'
}
