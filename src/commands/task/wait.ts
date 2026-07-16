import {Args, type Command, Flags} from '@oclif/core'

import {BaseCommand, type OutputMode, resolveOutputMode} from '../../base-command.js'
import {resolveApiKeyDetails} from '../../lib/auth.js'
import {formatDuration, parseDurationMs} from '../../lib/duration.js'
import {recordTaskHistoryBatchSafely} from '../../lib/history-command.js'
import {resolveBaseUrl} from '../../lib/modellix-client.js'
import {
  extractTaskResources,
  FAILURE_TASK_STATUSES,
  TaskWaitTimeoutError,
  type TerminalTaskResult,
  waitForTaskResults,
} from '../../lib/task.js'

export default class TaskWait extends BaseCommand {
  static args = {
    taskIds: Args.string({
      description: 'One or more task IDs returned by model run',
      multiple: true,
      required: true,
    }),
  }
  static description = 'Wait until one or more Modellix tasks reach terminal states'
  static examples = [
    '<%= config.bin %> <%= command.id %> task-abc123',
    '<%= config.bin %> <%= command.id %> task-a task-b --interval 5s --timeout 10m',
  ]
  static flags = {
    'api-key': Flags.string({
      description: 'Modellix API key (overrides environment and saved configuration)',
    }),
    concurrency: Flags.integer({
      default: 8,
      description: 'Maximum number of simultaneous polling requests',
      max: 20,
      min: 1,
    }),
    interval: Flags.string({
      default: '2s',
      description: 'Polling interval in seconds or duration format (for example 5s or 1m)',
    }),
    timeout: Flags.string({
      default: '5m',
      description: 'Overall timeout in seconds or duration format (for example 30s, 5m, or 2h)',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(TaskWait)
    const authentication = await resolveApiKeyDetails({
      apiKey: flags['api-key'],
      profile: flags.profile,
    })
    const {apiKey} = authentication
    const baseUrl = resolveBaseUrl()
    const intervalMs = parseDurationMs(flags.interval, 'polling interval', {maxMs: 3_600_000})
    const timeoutMs = parseDurationMs(flags.timeout, 'timeout', {maxMs: 604_800_000})
    const outputMode = resolveOutputMode(flags, 'json')

    let results: TerminalTaskResult[]
    try {
      results = await waitForTaskResults({
        apiKey,
        concurrency: flags.concurrency,
        intervalMs,
        taskIds: args.taskIds,
        timeoutMs,
      })
    } catch (error) {
      if (error instanceof TaskWaitTimeoutError) {
        await recordTaskHistoryBatchSafely(
          this,
          error.completed.map((result) => ({
            baseUrl,
            profile: authentication.profile,
            status: result.status,
            taskId: result.taskId,
          })),
        )
        const unfinished = error.taskIds.length - error.completed.length
        const message = `Timed out after ${formatDuration(error.timeoutMs)} while waiting for ${unfinished} unfinished task(s).`
        if (outputMode === 'json') {
          const completedTaskIds = new Set(error.completed.map((result) => result.taskId))
          this.log(
            JSON.stringify(
              {
                completed: error.completed.map((result) => ({
                  response: result.response,
                  status: result.status,
                  taskId: result.taskId,
                })),
                error: {code: 'TASK_WAIT_TIMEOUT', exitCode: 124, message},
                ok: false,
                unfinishedTaskIds: error.taskIds.filter((taskId) => !completedTaskIds.has(taskId)),
              },
              null,
              2,
            ),
          )
          this.exit(124)
        }

        if (error.completed.length > 0) {
          printTerminalResults(this, error.completed, outputMode)
        }

        this.error(
          message,
          {exit: 124},
        )
      }

      throw error
    }

    await recordTaskHistoryBatchSafely(
      this,
      results.map((result) => ({
        baseUrl,
        profile: authentication.profile,
        status: result.status,
        taskId: result.taskId,
      })),
    )
    printTerminalResults(this, results, outputMode)
    if (results.some((result) => FAILURE_TASK_STATUSES.has(result.status))) {
      this.exit(1)
    }
  }
}

function printTerminalResults(
  command: Command,
  results: TerminalTaskResult[],
  outputMode: OutputMode,
): void {
  if (outputMode === 'quiet') {
    const values = results.flatMap((result) => {
      const urls = extractTaskResources(result.response).map((resource) => resource.url)
      return urls.length > 0 ? urls : [result.taskId]
    })
    command.log(values.join('\n'))
    return
  }

  if (outputMode === 'human') {
    for (const result of results) {
      command.log(`${result.taskId}\t${result.status}`)
      for (const resource of extractTaskResources(result.response)) {
        command.log(`  ${resource.url}`)
      }
    }

    return
  }

  if (results.length === 1) {
    command.log(JSON.stringify(results[0].response, null, 2))
    return
  }

  command.log(
    JSON.stringify(
      {
        tasks: results.map((result) => ({response: result.response, taskId: result.taskId})),
      },
      null,
      2,
    ),
  )
}
