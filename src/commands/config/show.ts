import {Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../../base-command.js'
import {
  type ApiKeySource,
  findApiKey,
  MODELLIX_PROFILE_ENV,
  profileFlag,
} from '../../lib/auth.js'
import {
  DEFAULT_PROFILE,
  getConfigFilePath,
  normalizeProfileName,
  readConfig,
} from '../../lib/config.js'

type ConfigStatus = {
  apiKeySource: 'missing' | ApiKeySource
  configPath: string
  configured: boolean
  currentProfile?: string
  ok: boolean
  profile: string
  profiles: string[]
  profileSource: 'config' | 'default' | 'environment' | 'flag'
  warning?: string
}

export default class ConfigShow extends BaseCommand {
  static description = 'Show Modellix configuration status without revealing the API key'
  static flags = {
    json: Flags.boolean({description: 'Print a machine-readable JSON result'}),
    profile: profileFlag,
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ConfigShow)
    const status = await getConfigStatus(flags.profile)
    const outputMode = resolveOutputMode(flags)

    if (outputMode === 'json') {
      this.log(JSON.stringify(status, null, 2))
    } else if (outputMode === 'quiet') {
      this.log(status.profile)
    } else {
      this.log(`Configuration path: ${status.configPath}`)
      this.log(`Selected profile: ${status.profile} (${status.profileSource})`)
      this.log(`Saved profiles: ${status.profiles.join(', ') || 'none'}`)
      this.log(
        status.configured
          ? `Active API key source: ${status.apiKeySource}`
          : 'Active API key source: missing',
      )
      if (status.warning) {
        this.log(`Configuration warning: ${status.warning}`)
      }
    }

    if (!status.ok) {
      this.exit(1)
    }
  }
}

// Configuration recovery intentionally distinguishes saved state from higher-priority key sources.
// eslint-disable-next-line complexity
async function getConfigStatus(flagProfile?: string): Promise<ConfigStatus> {
  const configPath = getConfigFilePath()
  let config: Awaited<ReturnType<typeof readConfig>>
  let warning: string | undefined
  try {
    config = await readConfig()
  } catch (error) {
    warning = error instanceof Error ? error.message : 'Unable to read Modellix configuration.'
  }

  let resolved: Awaited<ReturnType<typeof findApiKey>>
  try {
    resolved = await findApiKey({profile: flagProfile})
  } catch (error) {
    warning ??= error instanceof Error ? error.message : 'Unable to resolve Modellix authentication.'
  }

  const fallbackProfile = normalizeProfileName(
    flagProfile || process.env[MODELLIX_PROFILE_ENV] || config?.currentProfile || DEFAULT_PROFILE,
  )
  const profileSource = flagProfile?.trim()
    ? 'flag'
    : process.env[MODELLIX_PROFILE_ENV]?.trim()
      ? 'environment'
      : config
        ? 'config'
        : 'default'
  return {
    apiKeySource: resolved?.source ?? 'missing',
    configPath,
    configured: Boolean(resolved),
    currentProfile: config?.currentProfile,
    ok: !warning || Boolean(resolved),
    profile: resolved?.profile ?? fallbackProfile,
    profiles: config ? Object.keys(config.profiles) : [],
    profileSource: resolved?.profileSource ?? profileSource,
    ...(warning ? {warning} : {}),
  }
}
