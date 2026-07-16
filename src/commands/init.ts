import {confirm as promptConfirm, password as promptPassword} from '@inquirer/prompts'
import {Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../base-command.js'
import {
  type ApiKeySource,
  findApiKey,
  MODELLIX_PROFILE_ENV,
  resolveProfile,
} from '../lib/auth.js'
import {
  DEFAULT_PROFILE,
  getConfigFilePath,
  normalizeProfileName,
  readConfig,
  writeConfig,
} from '../lib/config.js'
import {MODELLIX_API_KEY_URL, MODELLIX_CLI_DOCS_URL} from '../lib/links.js'
import {validateApiKey} from '../lib/modellix-client.js'

type InitKeySource = 'prompt' | ApiKeySource

type InitFlags = {
  'api-key'?: string
  check: boolean
  force: boolean
  json: boolean
  profile?: string
  yes: boolean
}

type InitPrompter = {
  confirm(options: {default: boolean; message: string}): Promise<boolean>
  password(options: {mask: string; message: string}): Promise<string>
}

type InitResult = {
  apiKeySource: InitKeySource
  configPath: string
  docs: string
  nextSteps: string[]
  ok: true
  profile: string
  saved: boolean
  valid: true
}

const defaultPrompter: InitPrompter = {
  confirm: promptConfirm,
  password: promptPassword,
}

let prompter = defaultPrompter

export function __setInitPrompterForTest(testPrompter?: InitPrompter): void {
  prompter = testPrompter ?? defaultPrompter
}

export default class Init extends BaseCommand {
  static description = 'Configure and validate a Modellix API key'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --api-key <key> --yes',
    '<%= config.bin %> <%= command.id %> --api-key <key> --check --json',
  ]
  static flags = {
    'api-key': Flags.string({description: 'Modellix API key to validate and optionally save'}),
    check: Flags.boolean({description: 'Validate the key without writing configuration'}),
    force: Flags.boolean({description: 'Replace an existing saved API key'}),
    json: Flags.boolean({description: 'Print one machine-readable JSON result'}),
    yes: Flags.boolean({char: 'y', description: 'Accept configuration replacement prompts'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Init)
    const outputMode = resolveOutputMode(flags)

    try {
      const result = await this.initialize({...flags, json: outputMode === 'json'})
      if (outputMode === 'json') {
        this.log(JSON.stringify(result, null, 2))
        return
      }

      if (outputMode === 'quiet') {
        this.log(result.saved ? result.configPath : 'valid')
        return
      }

      this.log('Welcome to Modellix CLI setup.')
      this.log('API key validation succeeded.')
      this.log(
        result.saved
          ? `Configuration saved to ${result.configPath}.`
          : 'Configuration was not changed.',
      )
      this.log('Next steps:')
      for (const step of result.nextSteps) {
        this.log(`  ${step}`)
      }

      this.log(`Docs: ${result.docs}`)
    } catch (error) {
      const message = errorMessage(error)
      this.error(message, {exit: 1})
    }
  }

  private async initialize(flags: InitFlags): Promise<InitResult> {
    const interactive =
      !flags.json && process.stdin.isTTY === true && process.stdout.isTTY === true
    const profile = await selectInitProfile(flags)
    const {apiKey, apiKeySource, shouldSave} = await selectApiKey(flags, interactive, profile)
    const savedConfig = await loadSavedConfig(flags, shouldSave)
    const savedApiKey = savedConfig?.profiles[profile]?.apiKey
    await confirmReplacement({apiKey, flags, interactive, savedApiKey, shouldSave})

    const valid = await validateApiKey({apiKey})
    if (!valid) {
      throw new Error('The Modellix API key is invalid or no longer active. No configuration was written.')
    }

    let saved = false
    const configPath = getConfigFilePath()
    if (shouldSave && (savedApiKey !== apiKey || savedConfig?.currentProfile !== profile)) {
      await writeConfig({
        apiKey,
        expectedApiKey: savedApiKey ?? null,
        profile,
        recover: flags.force,
      })
      saved = true
    }

    return {
      apiKeySource,
      configPath,
      docs: MODELLIX_CLI_DOCS_URL,
      nextSteps: [
        'modellix-cli doctor',
        'modellix-cli model list',
        'modellix-cli model run --model-slug <provider/model> --body \'{"prompt":"A cute cat"}\'',
        'modellix-cli task get <task_id>',
      ],
      ok: true,
      profile,
      saved,
      valid: true,
    }
  }
}

async function confirmReplacement(options: {
  apiKey: string
  flags: InitFlags
  interactive: boolean
  savedApiKey?: string
  shouldSave: boolean
}): Promise<void> {
  const {apiKey, flags, interactive, savedApiKey, shouldSave} = options
  if (!shouldSave || !savedApiKey || savedApiKey === apiKey || flags.force || flags.yes) {
    return
  }

  if (!interactive) {
    throw new Error('A saved API key already exists. Pass --force to replace it.')
  }

  const replace = await prompter.confirm({
    default: false,
    message: 'Replace the existing saved API key?',
  })
  if (!replace) {
    throw new Error('Configuration was not changed.')
  }
}

async function loadSavedConfig(
  flags: InitFlags,
  shouldSave: boolean,
): ReturnType<typeof readConfig> {
  if (!shouldSave) {
    return
  }

  try {
    return await readConfig()
  } catch (error) {
    if (!flags.force) {
      throw new Error(`${errorMessage(error)} Pass --force to replace it.`)
    }
  }
}

async function selectApiKey(
  flags: InitFlags,
  interactive: boolean,
  profile: string,
): Promise<{apiKey: string; apiKeySource: InitKeySource; shouldSave: boolean}> {
  const explicitKey = flags['api-key']?.trim()
  if (explicitKey) {
    return {apiKey: explicitKey, apiKeySource: 'flag', shouldSave: !flags.check}
  }

  const resolved = await findApiKey({profile})
  if (resolved) {
    if (resolved.source === 'config' && flags.force) {
      if (!interactive) {
        throw new Error('Pass --api-key with --force in a non-interactive session.')
      }

      return {
        apiKey: await promptForApiKey(),
        apiKeySource: 'prompt',
        shouldSave: !flags.check,
      }
    }

    return {
      apiKey: resolved.apiKey,
      apiKeySource: resolved.source,
      shouldSave: !flags.check && resolved.source !== 'config',
    }
  }

  if (!interactive) {
    throw new Error(
      'No API key is available in this non-interactive session. Pass --api-key or set MODELLIX_API_KEY.',
    )
  }

  return {apiKey: await promptForApiKey(), apiKeySource: 'prompt', shouldSave: !flags.check}
}

async function selectInitProfile(flags: InitFlags): Promise<string> {
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

async function promptForApiKey(): Promise<string> {
  const apiKey = (
    await prompter.password({
      mask: '*',
      message: `Enter your Modellix API key (${MODELLIX_API_KEY_URL}):`,
    })
  ).trim()
  if (!apiKey) {
    throw new Error('API key must not be empty.')
  }

  return apiKey
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to initialize Modellix CLI.'
}
