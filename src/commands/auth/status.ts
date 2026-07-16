import {Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../../base-command.js'
import {
  apiKeyFlag,
  findApiKey,
  MODELLIX_PROFILE_ENV,
  profileFlag,
} from '../../lib/auth.js'
import {DEFAULT_PROFILE, getConfigFilePath, normalizeProfileName} from '../../lib/config.js'
import {getTeamBalance, validateApiKey} from '../../lib/modellix-client.js'

type AuthStatusResult = {
  apiKeySource: 'config' | 'environment' | 'flag' | 'missing'
  authenticated: boolean
  balance?: number
  configPath: string
  ok: boolean
  profile: string
  profileSource: 'config' | 'default' | 'environment' | 'flag'
  valid: boolean
  warning?: string
}

export default class AuthStatus extends BaseCommand {
  static description = 'Show and verify the active Modellix authentication without revealing the key'
  static flags = {
    'api-key': apiKeyFlag,
    json: Flags.boolean({description: 'Print one machine-readable JSON result'}),
    profile: profileFlag,
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AuthStatus)
    const result = await getStatus(flags['api-key'], flags.profile)
    const outputMode = resolveOutputMode(flags)

    if (outputMode === 'json') {
      this.log(JSON.stringify(result, null, 2))
    } else if (outputMode === 'quiet') {
      if (result.ok) this.log(result.profile)
    } else {
      this.log(`Profile: ${result.profile} (${result.profileSource})`)
      this.log(`API key source: ${result.apiKeySource}`)
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

async function getStatus(flagApiKey?: string, flagProfile?: string): Promise<AuthStatusResult> {
  const configPath = getConfigFilePath()
  const fallback = getFallbackProfile(flagProfile)
  let resolved: Awaited<ReturnType<typeof findApiKey>>
  try {
    resolved = await findApiKey({apiKey: flagApiKey, profile: flagProfile})
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
        ok: false,
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
        ok: true,
        profile: resolved.profile,
        profileSource: resolved.profileSource,
        valid: true,
      }
    } catch (error) {
      return {
        apiKeySource: resolved.source,
        authenticated: true,
        configPath,
        ok: true,
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
      ok: false,
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
