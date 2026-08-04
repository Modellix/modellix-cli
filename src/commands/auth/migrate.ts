import {confirm} from '@inquirer/prompts'
import {Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../../base-command.js'
import {migrateLegacyCredentials} from '../../lib/auth.js'
import {type CredentialStoreKind} from '../../lib/config.js'

export default class AuthMigrate extends BaseCommand {
  static description = 'Migrate legacy plaintext API-key profiles to a safer credential store'
  static examples = [
    '<%= config.bin %> <%= command.id %> --to keychain',
    '<%= config.bin %> <%= command.id %> --to keychain --yes --json',
    '<%= config.bin %> <%= command.id %> --to file --yes --json',
  ]
  static flags = {
    json: Flags.boolean({description: 'Print one machine-readable JSON result'}),
    to: Flags.string({
      default: 'keychain',
      description: 'Migration target (file is an explicit plaintext fallback)',
      options: ['keychain', 'file'],
    }),
    yes: Flags.boolean({char: 'y', description: 'Confirm migration without prompting'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(AuthMigrate)
    const outputMode = resolveOutputMode(flags)
    if (!flags.yes) {
      const interactive = outputMode !== 'json' && process.stdin.isTTY && process.stdout.isTTY
      if (!interactive) this.error('Pass --yes to migrate in a non-interactive session.', {exit: 1})
      const accepted = await confirm({
        default: true,
        message: `Migrate every legacy profile to ${flags.to}?`,
      })
      if (!accepted) this.error('Authentication configuration was not changed.', {exit: 1})
    }

    const result = await migrateLegacyCredentials({to: flags.to as CredentialStoreKind})
    const output = {ok: true, ...result}
    if (outputMode === 'json') {
      this.log(JSON.stringify(output, null, 2))
    } else if (outputMode === 'quiet') {
      if (result.migrated) this.log(result.store)
    } else {
      this.log(
        result.migrated
          ? `Migrated ${result.profiles.length} profile(s) to ${result.store}.`
          : 'No legacy plaintext credentials require migration.',
      )
      this.log(`Configuration: ${result.configPath}`)
    }
  }
}
