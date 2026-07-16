import {confirm} from '@inquirer/prompts'
import {Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../../base-command.js'
import {findApiKey, profileFlag, resolveProfile} from '../../lib/auth.js'
import {getConfigFilePath, removeConfig, removeProfile} from '../../lib/config.js'

type ClearResult = {
  activeApiKeySource: 'config' | 'environment' | 'flag' | 'missing'
  configPath: string
  currentProfile?: string
  ok: true
  profile: string
  profiles: string[]
  removed: boolean
}

export default class ConfigClear extends BaseCommand {
  static description = 'Remove the saved Modellix API key configuration'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --yes --json',
  ]
  static flags = {
    json: Flags.boolean({description: 'Print one machine-readable JSON result'}),
    profile: profileFlag,
    yes: Flags.boolean({char: 'y', description: 'Confirm removal without prompting'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ConfigClear)
    const outputMode = resolveOutputMode(flags)
    try {
      let selection: Awaited<ReturnType<typeof resolveProfile>>
      let configIsUnreadable = false
      try {
        selection = await resolveProfile(flags.profile)
      } catch (error) {
        if (flags.profile) {
          throw error
        }

        selection = {profile: 'default', source: 'default'}
        configIsUnreadable = true
      }

      await confirmRemoval({...flags, json: outputMode === 'json'}, selection.profile)
      const configPath = getConfigFilePath()
      const removal = configIsUnreadable
        ? {remainingProfiles: [], removed: await removeConfig()}
        : await removeProfile(selection.profile)
      const active = await findApiKey({profile: flags.profile})
      const result: ClearResult = {
        activeApiKeySource: active?.source ?? 'missing',
        configPath,
        currentProfile: removal.currentProfile,
        ok: true,
        profile: selection.profile,
        profiles: removal.remainingProfiles,
        removed: removal.removed,
      }

      if (outputMode === 'json') {
        this.log(JSON.stringify(result, null, 2))
      } else if (outputMode === 'quiet') {
        if (result.removed) this.log(result.profile)
      } else {
        this.log(
          removal.removed
            ? `Removed profile ${selection.profile} from ${configPath}.`
            : `No saved profile named ${selection.profile} exists.`,
        )
        if (result.activeApiKeySource === 'environment') {
          this.log('MODELLIX_API_KEY remains active in the current environment.')
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to clear configuration.'
      this.error(message, {exit: 1})
    }
  }
}

async function confirmRemoval(
  flags: {json: boolean; yes: boolean},
  profile: string,
): Promise<void> {
  if (flags.yes) {
    return
  }

  const interactive =
    !flags.json && process.stdin.isTTY === true && process.stdout.isTTY === true
  if (!interactive) {
    throw new Error('Pass --yes to remove the saved configuration in a non-interactive session.')
  }

  const accepted = await confirm({
    default: false,
    message: `Remove the saved Modellix profile ${profile}?`,
  })
  if (!accepted) {
    throw new Error('Configuration was not changed.')
  }
}
