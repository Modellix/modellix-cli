import {confirm as promptConfirm, password as promptPassword} from '@inquirer/prompts'
import {Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../../base-command.js'
import {
  apiKeyFlag,
  type ApiKeySource,
  MODELLIX_API_KEY_ENV,
  MODELLIX_PROFILE_ENV,
  profileFlag,
  resolveProfile,
} from '../../lib/auth.js'
import {
  DEFAULT_PROFILE,
  getConfigFilePath,
  normalizeProfileName,
  readConfig,
  writeConfig,
} from '../../lib/config.js'
import {validateApiKey} from '../../lib/modellix-client.js'

type LoginFlags = {
  'api-key'?: string
  check: boolean
  force: boolean
  json: boolean
  profile?: string
  yes: boolean
}

type LoginPrompter = {
  confirm(options: {default: boolean; message: string}): Promise<boolean>
  password(options: {mask: string; message: string}): Promise<string>
}

type LoginResult = {
  apiKeySource: 'prompt' | ApiKeySource
  configPath: string
  ok: true
  profile: string
  saved: boolean
  valid: true
}

const defaultPrompter: LoginPrompter = {
  confirm: promptConfirm,
  password: promptPassword,
}

let prompter = defaultPrompter

export function __setAuthLoginPrompterForTest(testPrompter?: LoginPrompter): void {
  prompter = testPrompter ?? defaultPrompter
}

export default class AuthLogin extends BaseCommand {
  static description = 'Validate and save a Modellix API key for a profile'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --profile work --api-key <key> --yes',
    '<%= config.bin %> <%= command.id %> --api-key <key> --check --json',
  ]
  static flags = {
    'api-key': apiKeyFlag,
    check: Flags.boolean({description: 'Validate the key without writing configuration'}),
    force: Flags.boolean({description: 'Replace the selected saved profile'}),
    json: Flags.boolean({description: 'Print one machine-readable JSON result'}),
    profile: profileFlag,
    yes: Flags.boolean({char: 'y', description: 'Accept profile replacement prompts'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AuthLogin)
    const outputMode = resolveOutputMode(flags)
    try {
      const result = await login({...flags, json: outputMode === 'json'})
      if (outputMode === 'json') {
        this.log(JSON.stringify(result, null, 2))
        return
      }

      if (outputMode === 'quiet') {
        this.log(result.profile)
        return
      }

      this.log(`Authentication succeeded for profile ${result.profile}.`)
      this.log(
        result.saved
          ? `Profile saved to ${result.configPath}.`
          : 'Saved configuration was not changed.',
      )
    } catch (error) {
      const message = errorMessage(error)
      this.error(message, {exit: 1})
    }
  }
}

async function login(flags: LoginFlags): Promise<LoginResult> {
  const interactive = !flags.json && process.stdin.isTTY === true && process.stdout.isTTY === true
  const profile = await selectLoginProfile(flags)
  const savedConfig = await loadConfigForLogin(flags)
  const existingKey = savedConfig?.profiles[profile]?.apiKey
  const selected = await selectLoginKey({existingKey, flags, interactive, profile})
  await confirmReplacement({existingKey, flags, interactive, profile, selectedKey: selected.apiKey})

  const valid = await validateApiKey({apiKey: selected.apiKey})
  if (!valid) {
    throw new Error('The Modellix API key is invalid or inactive. No configuration was written.')
  }

  let saved = false
  if (!flags.check) {
    saved = existingKey !== selected.apiKey || savedConfig?.currentProfile !== profile
    if (saved) {
      await writeConfig({
        apiKey: selected.apiKey,
        expectedApiKey: existingKey ?? null,
        profile,
        recover: flags.force,
      })
    }
  }

  return {
    apiKeySource: selected.source,
    configPath: getConfigFilePath(),
    ok: true,
    profile,
    saved,
    valid: true,
  }
}

async function selectLoginProfile(flags: LoginFlags): Promise<string> {
  try {
    return (await resolveProfile(flags.profile)).profile
  } catch (error) {
    if (!flags.force) {
      throw error
    }

    return normalizeProfileName(
      flags.profile || process.env[MODELLIX_PROFILE_ENV] || DEFAULT_PROFILE,
    )
  }
}

async function loadConfigForLogin(flags: LoginFlags): ReturnType<typeof readConfig> {
  try {
    return await readConfig()
  } catch (error) {
    if (!flags.force) {
      throw new Error(`${errorMessage(error)} Pass --force to replace it.`)
    }
  }
}

async function selectLoginKey(options: {
  existingKey?: string
  flags: LoginFlags
  interactive: boolean
  profile: string
}): Promise<{apiKey: string; source: 'prompt' | ApiKeySource}> {
  const {existingKey, flags, interactive, profile} = options
  const explicitKey = flags['api-key']?.trim()
  if (explicitKey) {
    return {apiKey: explicitKey, source: 'flag'}
  }

  const environmentKey = process.env[MODELLIX_API_KEY_ENV]?.trim()
  if (environmentKey) {
    return {apiKey: environmentKey, source: 'environment'}
  }

  if (existingKey && !flags.force) {
    return {apiKey: existingKey, source: 'config'}
  }

  if (!interactive) {
    throw new Error(
      `No API key is available for profile ${profile}. Pass --api-key or set ${MODELLIX_API_KEY_ENV}.`,
    )
  }

  const apiKey = (await prompter.password({
    mask: '*',
    message: `Enter the Modellix API key for profile ${profile}:`,
  })).trim()
  if (!apiKey) {
    throw new Error('API key must not be empty.')
  }

  return {apiKey, source: 'prompt'}
}

async function confirmReplacement(options: {
  existingKey?: string
  flags: LoginFlags
  interactive: boolean
  profile: string
  selectedKey: string
}): Promise<void> {
  const {existingKey, flags, interactive, profile, selectedKey} = options
  if (!existingKey || existingKey === selectedKey || flags.force || flags.yes || flags.check) {
    return
  }

  if (!interactive) {
    throw new Error(`Profile ${profile} already exists. Pass --force to replace it.`)
  }

  const replace = await prompter.confirm({
    default: false,
    message: `Replace the saved API key for profile ${profile}?`,
  })
  if (!replace) {
    throw new Error('Authentication configuration was not changed.')
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to log in to Modellix.'
}
