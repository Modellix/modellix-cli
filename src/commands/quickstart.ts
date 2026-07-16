import {Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../base-command.js'
import {
  type ApiKeySource,
  findApiKey,
  type ProfileSource,
  resolveProfile,
} from '../lib/auth.js'
import {DEFAULT_PROFILE} from '../lib/config.js'
import {MODELLIX_API_KEY_URL, MODELLIX_CLI_DOCS_URL} from '../lib/links.js'

type QuickstartReport = {
  apiKeySource: 'missing' | ApiKeySource
  configurationWarning?: string
  configured: boolean
  docs: string
  nextSteps: string[]
  ok: true
  profile: string
  profileSource: ProfileSource
}

export default class Quickstart extends BaseCommand {
  static description = 'Show the Modellix CLI Quickstart'
  static flags = {
    json: Flags.boolean({description: 'Print a machine-readable JSON report'}),
  }
  static hidden = true

  async run(): Promise<void> {
    const {flags} = await this.parse(Quickstart)
    let apiKeySource: 'missing' | ApiKeySource = 'missing'
    let configurationWarning: string | undefined
    let profile = DEFAULT_PROFILE
    let profileSource: ProfileSource = 'default'

    try {
      const resolved = await findApiKey({profile: flags.profile})
      apiKeySource = resolved?.source ?? 'missing'
      if (resolved) {
        profile = resolved.profile
        profileSource = resolved.profileSource
      } else {
        const selection = await resolveProfile(flags.profile)
        profile = selection.profile
        profileSource = selection.source
      }
    } catch (error) {
      configurationWarning = errorMessage(error)
    }

    const configured = apiKeySource !== 'missing'
    const nextSteps = configured
      ? [
          'modellix-cli doctor',
          'modellix-cli model list',
          'modellix-cli model run --model-slug <provider/model> --body \'{"prompt":"Hello"}\'',
          'modellix-cli task get <task_id>',
        ]
      : [
          `Get an API key at ${MODELLIX_API_KEY_URL}`,
          'modellix-cli init',
          'modellix-cli doctor',
        ]
    const report: QuickstartReport = {
      apiKeySource,
      configured,
      docs: MODELLIX_CLI_DOCS_URL,
      nextSteps,
      ok: true,
      profile,
      profileSource,
      ...(configurationWarning ? {configurationWarning} : {}),
    }
    const outputMode = resolveOutputMode(flags)

    if (outputMode === 'json') {
      this.log(JSON.stringify(report, null, 2))
      return
    }

    if (outputMode === 'quiet') {
      this.log(configured ? 'configured' : 'missing')
      return
    }

    this.log('Welcome to Modellix CLI.')
    this.log(
      configured
        ? `Authentication is configured for profile ${profile} (${apiKeySource}).`
        : 'No API key is configured yet.',
    )
    if (configurationWarning) {
      this.log(`Configuration warning: ${configurationWarning}`)
    }

    this.log('')
    this.log('Quickstart:')
    for (const step of nextSteps) {
      this.log(`  ${step}`)
    }

    this.log('')
    this.log('Help: modellix-cli --help')
    this.log(`Docs: ${MODELLIX_CLI_DOCS_URL}`)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to inspect the saved configuration.'
}
