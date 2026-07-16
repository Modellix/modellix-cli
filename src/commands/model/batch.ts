import {Args, Flags} from '@oclif/core'

import {BaseCommand, resolveOutputValue} from '../../base-command.js'
import {resolveApiKeyDetails} from '../../lib/auth.js'
import {recordTaskHistory} from '../../lib/history.js'
import {
  DEFAULT_BATCH_INPUT_MAX_BYTES,
  DEFAULT_BATCH_MAX_TASKS,
  mapWithConcurrency,
  type ModelBatchEntry,
  readModelBatch,
} from '../../lib/model-batch.js'
import {
  getTaskId,
  getTaskResourceUrls,
  ModelTaskTimeoutError,
  parseModelDuration,
  waitForModelTask,
} from '../../lib/model-task.js'
import {
  MAX_API_REQUEST_BYTES,
  PaidSubmissionOutcomeUnknownError,
  resolveBaseUrl,
  runModel,
} from '../../lib/modellix-client.js'
import {sanitizeTerminalText} from '../../lib/safe-text.js'

type BatchTaskResult = {
  error?: string
  index: number
  modelSlug: string
  ok: boolean
  resourceUrls?: string[]
  status: string
  submissionState: 'accepted' | 'rejected' | 'skipped' | 'unknown'
  taskId?: string
}

export default class ModelBatch extends BaseCommand {
  static args = {
    file: Args.string({description: 'JSONL batch file, or - to read from stdin', required: true}),
  }
  static description = 'Submit multiple Modellix model tasks from JSONL input'
  static examples = [
    '<%= config.bin %> <%= command.id %> tasks.jsonl --max-tasks 20',
    'cat tasks.jsonl | <%= config.bin %> <%= command.id %> - --yes --wait',
  ]
  static flags = {
    'api-key': Flags.string({
      description: 'Modellix API key (overrides environment and saved configuration)',
    }),
    concurrency: Flags.integer({
      default: 3,
      description: 'Maximum simultaneous submissions',
      max: 10,
      min: 1,
    }),
    'continue-on-unknown': Flags.boolean({
      description: 'Continue submitting new paid tasks after an outcome-unknown error',
    }),
    interval: Flags.string({
      default: '2s',
      description: 'Polling interval when --wait is enabled (for example 5s or 1m)',
    }),
    'max-body-bytes': Flags.integer({
      default: MAX_API_REQUEST_BYTES,
      description: 'Maximum JSON body size for each task',
      max: MAX_API_REQUEST_BYTES,
      min: 1,
    }),
    'max-input-bytes': Flags.integer({
      default: DEFAULT_BATCH_INPUT_MAX_BYTES,
      description: 'Maximum JSONL input size in bytes',
      max: DEFAULT_BATCH_INPUT_MAX_BYTES,
      min: 1,
    }),
    'max-tasks': Flags.integer({
      description: 'Safety limit for the number of paid tasks submitted',
      max: DEFAULT_BATCH_MAX_TASKS,
      min: 1,
    }),
    output: Flags.string({
      default: 'json',
      description: 'Output format',
      options: ['human', 'json', 'quiet'],
    }),
    quiet: Flags.boolean({
      char: 'q',
      description: 'Output only task IDs, or resource URLs when waiting',
    }),
    timeout: Flags.string({
      default: '5m',
      description: 'Maximum time to wait for each task',
    }),
    wait: Flags.boolean({
      allowNo: true,
      default: false,
      description: 'Wait for every submitted task to reach a terminal state',
    }),
    yes: Flags.boolean({
      char: 'y',
      description: 'Acknowledge that every input line can create a paid task',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ModelBatch)
    const entries = await readModelBatch(args.file, process.stdin, {
      maxBodyBytes: flags['max-body-bytes'],
      maxBytes: flags['max-input-bytes'],
      maxTasks: flags['max-tasks'] ?? DEFAULT_BATCH_MAX_TASKS,
    })
    this.enforceCostGuard(entries.length, flags['max-tasks'], flags.yes)

    const intervalMs = flags.wait
      ? parseModelDuration(flags.interval, 'interval', 3_600_000)
      : undefined
    const timeoutMs = flags.wait
      ? parseModelDuration(flags.timeout, 'timeout', 604_800_000)
      : undefined
    const authentication = await resolveApiKeyDetails({
      apiKey: flags['api-key'],
      profile: flags.profile,
    })
    const {apiKey} = authentication
    const results = await mapWithConcurrency<ModelBatchEntry, BatchTaskResult>(
      entries,
      flags.concurrency,
      async (entry, index) =>
        this.submitEntry(entry, index, {
          apiKey,
          baseUrl: resolveBaseUrl(),
          intervalMs,
          profile: authentication.profile,
          timeoutMs,
          wait: flags.wait,
        }),
      {
        mapSkipped: (entry, index) => ({
          error: 'Skipped after an earlier paid submission returned an unknown outcome.',
          index: index + 1,
          modelSlug: entry.modelSlug,
          ok: false,
          status: 'skipped',
          submissionState: 'skipped',
        }),
        stopWhen: (result) =>
          result.submissionState === 'unknown' && !flags['continue-on-unknown'],
      },
    )

    this.outputResults(results, resolveOutputValue(flags, 'json'), flags.wait)
    if (results.some((result) => !result.ok)) {
      const onlyTimeouts = results
        .filter((result) => !result.ok)
        .every((result) => result.status === 'timeout')
      this.exit(onlyTimeouts ? 124 : 1)
    }
  }

  private enforceCostGuard(taskCount: number, maxTasks: number | undefined, yes: boolean): void {
    if (maxTasks !== undefined && taskCount > maxTasks) {
      this.error(
        `Batch contains ${taskCount} tasks, which exceeds the --max-tasks limit of ${maxTasks}.`,
        {exit: 2},
      )
    }

    if (maxTasks === undefined && !yes) {
      this.error(
        `Refusing to submit ${taskCount} potentially paid tasks without --max-tasks or explicit --yes.`,
        {exit: 2},
      )
    }
  }

  private outputResults(results: BatchTaskResult[], output: string, wait: boolean): void {
    if (output === 'quiet') {
      for (const result of results) {
        if (!result.ok) {
          this.warn(`Task ${result.index} (${result.modelSlug}) failed: ${result.error}`)
          continue
        }

        const values = wait && result.resourceUrls?.length ? result.resourceUrls : [result.taskId!]
        this.log(values.join('\n'))
      }

      return
    }

    if (output === 'human') {
      for (const result of results) {
        const task = result.taskId ? ` (${result.taskId})` : ''
        const error = result.error ? ` - ${result.error}` : ''
        this.log(
          `${result.index}. ${result.modelSlug}${task}: ${result.status} [${result.submissionState}]${error}`,
        )
      }

      return
    }

    const failed = results.filter((result) => !result.ok).length
    this.log(
      JSON.stringify(
        {
          failed,
          succeeded: results.length - failed,
          tasks: results,
          total: results.length,
        },
        null,
        2,
      ),
    )
  }

  private async recordHistory(input: {
    baseUrl: string
    modelSlug?: string
    profile: string
    status: string
    taskId: string
  }): Promise<void> {
    try {
      await recordTaskHistory(input)
    } catch (error) {
      // History failure must not make a paid submission look failed and invite a duplicate retry.
      const message = error instanceof Error ? error.message : 'Unknown history error.'
      this.warn(
        `Task ${input.taskId} was submitted, but local history could not be updated: ${message}`,
      )
    }
  }

  private async submitEntry(
    entry: ModelBatchEntry,
    index: number,
    options: {
      apiKey: string
      baseUrl: string
      intervalMs?: number
      profile: string
      timeoutMs?: number
      wait: boolean
    },
  ): Promise<BatchTaskResult> {
    let taskId: string | undefined
    try {
      const submission = await runModel({
        apiKey: options.apiKey,
        body: entry.body,
        modelSlug: entry.modelSlug,
      })
      taskId = getTaskId(submission)

      await this.recordHistory({
        baseUrl: options.baseUrl,
        modelSlug: entry.modelSlug,
        profile: options.profile,
        status: 'submitted',
        taskId,
      })
      if (!options.wait) {
        return {
          index: index + 1,
          modelSlug: entry.modelSlug,
          ok: true,
          status: 'submitted',
          submissionState: 'accepted',
          taskId,
        }
      }

      const completed = await waitForModelTask({
        apiKey: options.apiKey,
        intervalMs: options.intervalMs!,
        taskId,
        timeoutMs: options.timeoutMs!,
      })
      await this.recordHistory({
        baseUrl: options.baseUrl,
        profile: options.profile,
        status: completed.status,
        taskId,
      })
      return {
        error: completed.failed ? `Task reached terminal status ${completed.status}.` : undefined,
        index: index + 1,
        modelSlug: entry.modelSlug,
        ok: !completed.failed,
        resourceUrls: getTaskResourceUrls(completed.response),
        status: completed.status,
        submissionState: 'accepted',
        taskId,
      }
    } catch (error) {
      const submissionState = taskId
        ? 'accepted'
        : error instanceof PaidSubmissionOutcomeUnknownError
          ? 'unknown'
          : 'rejected'
      const recovery = taskId
        ? ` Resume with: modellix-cli task wait ${taskId}`
        : ''
      return {
        error: `${sanitizeError(error, options.apiKey, entry.body)}${recovery}`,
        index: index + 1,
        modelSlug: entry.modelSlug,
        ok: false,
        status: error instanceof ModelTaskTimeoutError ? 'timeout' : 'error',
        submissionState,
        taskId,
      }
    }
  }
}

function sanitizeError(error: unknown, apiKey: string, body: ModelBatchEntry['body']): string {
  let message = error instanceof Error ? error.message : 'Unknown error.'
  const sensitiveValues = new Set([apiKey, JSON.stringify(body)])
  for (const value of sensitiveValues) {
    if (value) {
      message = message.replaceAll(value, '[redacted]')
    }
  }

  return sanitizeTerminalText(message, 2000)
}
