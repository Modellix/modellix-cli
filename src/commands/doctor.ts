import {Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../base-command.js'
import {
  type ApiKeySource,
  findApiKey,
  MODELLIX_PROFILE_ENV,
  type ProfileSource,
  resolveProfile,
} from '../lib/auth.js'
import {DEFAULT_PROFILE, normalizeProfileName} from '../lib/config.js'
import {getTeamBalance, validateApiKey} from '../lib/modellix-client.js'

type DoctorCheck = {
  detail: string
  name: string
  ok: boolean
  required: boolean
}

type DoctorReport = {
  apiKeySource: 'missing' | ApiKeySource
  checks: DoctorCheck[]
  ok: boolean
  profile: string
  profileSource: ProfileSource
}

export default class Doctor extends BaseCommand {
  static description = 'Check the local environment and Modellix API access'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --api-key <key>',
  ]
  static flags = {
    'api-key': Flags.string({
      description: 'Modellix API key (overrides environment and saved configuration)',
    }),
    json: Flags.boolean({description: 'Print one machine-readable JSON report'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Doctor)
    const report = await this.diagnose(flags['api-key'], flags.profile)
    const outputMode = resolveOutputMode(flags)

    if (outputMode === 'json') {
      this.log(JSON.stringify(report, null, 2))
    } else if (outputMode === 'quiet') {
      this.log(report.ok ? 'ok' : 'failed')
    } else {
      this.log('Modellix CLI doctor')
      for (const check of report.checks) {
        const label = check.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN'
        this.log(`[${label}] ${check.name}: ${check.detail}`)
      }

      this.log(report.ok ? 'All required checks passed.' : 'One or more required checks failed.')
    }

    if (!report.ok) {
      this.exit(1)
    }
  }

  private async diagnose(flagApiKey?: string, flagProfile?: string): Promise<DoctorReport> {
    const checks: DoctorCheck[] = [
      {
        detail: `Node.js ${process.versions.node} (requires 18.17 or later)`,
        name: 'node',
        ok: isSupportedNodeVersion(process.versions.node),
        required: true,
      },
    ]
    let resolved: Awaited<ReturnType<typeof findApiKey>>
    const profileSelection = await safeProfileSelection(flagProfile)

    try {
      resolved = await findApiKey({apiKey: flagApiKey, profile: flagProfile})
    } catch (error) {
      checks.push({detail: errorMessage(error), name: 'apiKey', ok: false, required: true})
      return buildReport('missing', checks, profileSelection)
    }

    if (!resolved) {
      checks.push({
        detail: 'Missing. Run modellix-cli init or set MODELLIX_API_KEY.',
        name: 'apiKey',
        ok: false,
        required: true,
      }, {
        detail: 'Skipped because no API key is available.',
        name: 'connectivity',
        ok: false,
        required: true,
      })
      return buildReport('missing', checks, profileSelection)
    }

    checks.push({
      detail: `Present from ${resolved.source}; format is verified by the API.`,
      name: 'apiKey',
      ok: true,
      required: true,
    })

    let valid: boolean
    try {
      valid = await validateApiKey({apiKey: resolved.apiKey})
      checks.push({
        detail: 'Reached the API-key validation endpoint.',
        name: 'connectivity',
        ok: true,
        required: true,
      })
    } catch (error) {
      checks.push({detail: errorMessage(error), name: 'connectivity', ok: false, required: true})
      return buildReport(resolved.source, checks, resolved)
    }

    checks.push({
      detail: valid ? 'The API key is valid.' : 'The API key is invalid or inactive.',
      name: 'validation',
      ok: valid,
      required: true,
    })
    if (!valid) {
      return buildReport(resolved.source, checks, resolved)
    }

    try {
      const balance = await getTeamBalance({apiKey: resolved.apiKey})
      checks.push({
        detail: `$${balance.toFixed(4)} USD`,
        name: 'balance',
        ok: true,
        required: false,
      })
    } catch (error) {
      checks.push({detail: errorMessage(error), name: 'balance', ok: false, required: false})
    }

    return buildReport(resolved.source, checks, resolved)
  }
}

function isSupportedNodeVersion(version: string): boolean {
  const [major, minor] = version.split('.').map((part) => Number.parseInt(part, 10))
  return major > 18 || (major === 18 && minor >= 17)
}

function buildReport(
  apiKeySource: 'missing' | ApiKeySource,
  checks: DoctorCheck[],
  profileSelection: {profile: string; profileSource?: ProfileSource; source?: ProfileSource},
): DoctorReport {
  return {
    apiKeySource,
    checks,
    ok: checks.filter((check) => check.required).every((check) => check.ok),
    profile: profileSelection.profile,
    profileSource: profileSelection.profileSource ?? profileSelection.source ?? 'default',
  }
}

async function safeProfileSelection(
  flagProfile?: string,
): Promise<{profile: string; source: ProfileSource}> {
  try {
    return await resolveProfile(flagProfile)
  } catch {
    try {
      const explicit = flagProfile?.trim()
      if (explicit) return {profile: normalizeProfileName(explicit), source: 'flag'}
      const environment = process.env[MODELLIX_PROFILE_ENV]?.trim()
      if (environment) {
        return {profile: normalizeProfileName(environment), source: 'environment'}
      }
    } catch {
      // The detailed profile/config error is reported by the API-key check.
    }

    return {profile: DEFAULT_PROFILE, source: 'default'}
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown diagnostic error.'
}
