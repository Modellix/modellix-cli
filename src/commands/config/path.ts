import {Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../../base-command.js'
import {
  MODELLIX_PROFILE_ENV,
  profileFlag,
  resolveProfile,
} from '../../lib/auth.js'
import {getConfigFilePath, readConfig} from '../../lib/config.js'

export default class ConfigPath extends BaseCommand {
  static description = 'Print the Modellix configuration file path'
  static flags = {
    json: Flags.boolean({description: 'Print a machine-readable JSON result'}),
    profile: profileFlag,
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ConfigPath)
    const configPath = getConfigFilePath()
    const outputMode = resolveOutputMode(flags)
    if (outputMode !== 'json') {
      this.log(configPath)
      return
    }

    try {
      const [config, selection] = await Promise.all([readConfig(), resolveProfile(flags.profile)])
      this.log(JSON.stringify({
        configPath,
        currentProfile: config?.currentProfile,
        profile: selection.profile,
        profiles: config ? Object.keys(config.profiles) : [],
        profileSource: selection.source,
      }, null, 2))
    } catch (error) {
      const environmentProfile = process.env[MODELLIX_PROFILE_ENV]?.trim()
      this.log(JSON.stringify({
        configPath,
        profile: flags.profile?.trim() || environmentProfile || 'default',
        profiles: [],
        profileSource: flags.profile?.trim()
          ? 'flag'
          : environmentProfile
            ? 'environment'
            : 'default',
        warning: error instanceof Error ? error.message : 'Unable to read configuration.',
      }, null, 2))
    }
  }
}
