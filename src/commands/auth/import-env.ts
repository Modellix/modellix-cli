import {Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../../base-command.js'
import {
  credentialStoreFlag,
  findApiKey,
  MODELLIX_API_KEY_ENV,
  profileFlag,
  resolveProfile,
  saveApiKey,
} from '../../lib/auth.js'
import {type CredentialStoreKind, readConfig} from '../../lib/config.js'
import {validateApiKey} from '../../lib/modellix-client.js'
import {normalizeApiKey} from '../../lib/safe-text.js'

export default class AuthImportEnv extends BaseCommand {
  static description = 'Validate an API key from an environment variable and import it into persistent storage'
  static examples = [
    '<%= config.bin %> <%= command.id %> --env-var MODELLIX_API_KEY --json',
    '<%= config.bin %> <%= command.id %> --env-var CURSOR_MODELLIX_API_KEY --profile cursor --json',
  ]
  static flags = {
    'env-var': Flags.string({
      default: MODELLIX_API_KEY_ENV,
      description: 'Environment variable containing the API key',
    }),
    force: Flags.boolean({description: 'Replace a different saved credential for the profile'}),
    json: Flags.boolean({description: 'Print one machine-readable JSON result'}),
    profile: profileFlag,
    store: credentialStoreFlag,
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AuthImportEnv)
    const outputMode = resolveOutputMode(flags)
    const environmentName = normalizeEnvironmentName(flags['env-var'])
    const rawKey = process.env[environmentName]
    if (!rawKey?.trim()) {
      this.error(`Environment variable ${environmentName} is empty or missing.`, {exit: 1})
    }

    const apiKey = normalizeApiKey(rawKey)
    const {profile} = await resolveProfile(flags.profile)
    const existing = await findApiKey({ignoreEnvironment: true, profile})
    if (existing && existing.apiKey !== apiKey && !flags.force) {
      this.error(`Profile ${profile} already has a different credential. Pass --force to replace it.`, {exit: 1})
    }

    if (!(await validateApiKey({apiKey}))) {
      this.error('The API key is invalid or inactive. Nothing was imported.', {exit: 1})
    }

    const currentProfile = (await readConfig())?.currentProfile
    const saved = !existing
      || existing.apiKey !== apiKey
      || existing.source !== flags.store
      || currentProfile !== profile
    const stored = saved
      ? await saveApiKey({
        apiKey,
        expectedApiKey: existing?.apiKey ?? null,
        profile,
        store: flags.store as CredentialStoreKind,
      })
      : {
        configPath: '',
        credentialRef: existing.credentialRef ?? '',
        origin: existing.origin,
        profile,
        store: existing.source as CredentialStoreKind,
      }
    const result = {
      clearEnvironmentVariable: environmentName,
      credentialStore: stored.store,
      ok: true,
      origin: stored.origin,
      profile,
      saved,
      valid: true,
    }

    if (outputMode === 'json') {
      this.log(JSON.stringify(result, null, 2))
    } else if (outputMode === 'quiet') {
      this.log(profile)
    } else {
      this.log(saved ? `Imported ${environmentName} into ${stored.store}.` : 'The saved credential is already current.')
      this.log(`The parent launcher should now remove ${environmentName} from the MCP child environment.`)
    }
  }
}

function normalizeEnvironmentName(value: string): string {
  const normalized = value.trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(normalized)) {
    throw new Error('Environment variable name is invalid.')
  }

  return normalized
}
