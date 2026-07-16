import {confirm} from '@inquirer/prompts'
import {Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../../base-command.js'
import {findApiKey, profileFlag, resolveProfile} from '../../lib/auth.js'
import {getConfigFilePath, removeProfile} from '../../lib/config.js'

export default class AuthLogout extends BaseCommand {
  static description = 'Remove a saved Modellix authentication profile'
  static flags = {
    json: Flags.boolean({description: 'Print one machine-readable JSON result'}),
    profile: profileFlag,
    yes: Flags.boolean({char: 'y', description: 'Confirm logout without prompting'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AuthLogout)
    const outputMode = resolveOutputMode(flags)
    try {
      const selection = await resolveProfile(flags.profile)
      await confirmLogout({...flags, json: outputMode === 'json'}, selection.profile)
      const removal = await removeProfile(selection.profile)
      const active = await findApiKey({profile: flags.profile})
      const result = {
        activeApiKeySource: active?.source ?? 'missing',
        configPath: getConfigFilePath(),
        currentProfile: removal.currentProfile,
        ok: true,
        profile: selection.profile,
        profiles: removal.remainingProfiles,
        removed: removal.removed,
      }

      if (outputMode === 'json') {
        this.log(JSON.stringify(result, null, 2))
        return
      }

      if (outputMode === 'quiet') {
        if (result.removed) this.log(result.profile)
        return
      }

      this.log(
        result.removed
          ? `Logged out of saved profile ${result.profile}.`
          : `No saved profile named ${result.profile} exists.`,
      )
      if (result.activeApiKeySource === 'environment') {
        this.log('MODELLIX_API_KEY remains active in the current environment.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to log out.'
      this.error(message, {exit: 1})
    }
  }
}

async function confirmLogout(
  flags: {json: boolean; yes: boolean},
  profile: string,
): Promise<void> {
  if (flags.yes) {
    return
  }

  const interactive = !flags.json && process.stdin.isTTY === true && process.stdout.isTTY === true
  if (!interactive) {
    throw new Error('Pass --yes to log out in a non-interactive session.')
  }

  const accepted = await confirm({
    default: false,
    message: `Remove the saved Modellix profile ${profile}?`,
  })
  if (!accepted) {
    throw new Error('Authentication configuration was not changed.')
  }
}
