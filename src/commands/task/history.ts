import {confirm} from '@inquirer/prompts'
import {type Command, Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../../base-command.js'
import {MODELLIX_PROFILE_ENV} from '../../lib/auth.js'
import {DEFAULT_PROFILE, normalizeProfileName} from '../../lib/config.js'
import {
  clearTaskHistory,
  getTaskHistoryFilePath,
  readTaskHistory,
  type TaskHistoryEntry,
} from '../../lib/history.js'

export default class TaskHistory extends BaseCommand {
  static description = 'Show or clear local Modellix task history'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --limit 50 --json',
    '<%= config.bin %> <%= command.id %> --clear --yes',
  ]
  static flags = {
    clear: Flags.boolean({description: 'Clear all local task history'}),
    json: Flags.boolean({
      description: 'Print one stable machine-readable JSON result',
    }),
    limit: Flags.integer({default: 20, description: 'Maximum number of recent entries', min: 1}),
    quiet: Flags.boolean({
      char: 'q',
      description: 'Print only task IDs, one per line',
    }),
    yes: Flags.boolean({
      char: 'y',
      dependsOn: ['clear'],
      description: 'Confirm clearing history without prompting',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(TaskHistory)
    const historyPath = getTaskHistoryFilePath()
    const outputMode = resolveOutputMode(flags)
    const profileFilter = flags.profile || process.env[MODELLIX_PROFILE_ENV]
      ? normalizeProfileName(flags.profile || process.env[MODELLIX_PROFILE_ENV])
      : undefined

    if (flags.clear) {
      await confirmClear({
        ...flags,
        json: outputMode === 'json',
        quiet: outputMode === 'quiet',
      })
      const cleared = await clearTaskHistory(profileFilter ? {profile: profileFilter} : {})
      if (outputMode === 'json') {
        this.log(JSON.stringify({cleared, historyPath, ok: true}, null, 2))
      } else if (outputMode !== 'quiet') {
        this.log(cleared ? `Cleared local task history at ${historyPath}.` : 'No local task history exists.')
      }

      return
    }

    const storedEntries = await readTaskHistory()
    const allEntries = profileFilter
      ? storedEntries.filter((entry) => (entry.profile ?? DEFAULT_PROFILE) === profileFilter)
      : storedEntries
    const entries = allEntries.slice(0, flags.limit)
    if (outputMode === 'json') {
      this.log(
        JSON.stringify(
          {
            entries,
            historyPath,
            ok: true,
            profile: profileFilter,
            total: allEntries.length,
          },
          null,
          2,
        ),
      )
      return
    }

    if (outputMode === 'quiet') {
      if (entries.length > 0) this.log(entries.map((entry) => entry.taskId).join('\n'))
      return
    }

    printHumanHistory(this, entries)
  }
}

function printHumanHistory(command: Command, entries: TaskHistoryEntry[]): void {
  if (entries.length === 0) {
    command.log('No local task history.')
    return
  }

  for (const entry of entries) {
    command.log(
      [
        entry.updatedAt,
        entry.profile ?? DEFAULT_PROFILE,
        entry.taskId,
        entry.modelSlug ?? '-',
        entry.status ?? '-',
        entry.baseUrl ?? '-',
      ].join('\t'),
    )
  }
}

async function confirmClear(flags: {json: boolean; quiet: boolean; yes: boolean}): Promise<void> {
  if (flags.yes) {
    return
  }

  const interactive =
    !flags.json && !flags.quiet && process.stdin.isTTY === true && process.stdout.isTTY === true
  if (!interactive) {
    throw new Error('Pass --yes to clear task history in a non-interactive session.')
  }

  const accepted = await confirm({default: false, message: 'Clear all local Modellix task history?'})
  if (!accepted) {
    throw new Error('Task history was not changed.')
  }
}
