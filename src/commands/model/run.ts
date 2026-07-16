import {Flags} from '@oclif/core'

import {BaseCommand, resolveOutputValue} from '../../base-command.js'
import {resolveApiKeyDetails} from '../../lib/auth.js'
import {DEFAULT_MODEL_BODY_MAX_BYTES, parseModelInvokeBody} from '../../lib/body.js'
import {recordTaskHistory} from '../../lib/history.js'
import {
  getTaskId,
  getTaskResourceUrls,
  ModelTaskTimeoutError,
  parseModelDuration,
  waitForModelTask,
} from '../../lib/model-task.js'
import {resolveBaseUrl, runModel} from '../../lib/modellix-client.js'

export default class ModelRun extends BaseCommand {
  static aliases = ['model:invoke']
  static description = 'Submit a Modellix model task'
  static examples = [
    '<%= config.bin %> <%= command.id %> --model-slug bytedance/seedream-4.5-t2i --body \'{"prompt":"A cute cat"}\'',
    '<%= config.bin %> <%= command.id %> --model-slug alibaba/qwen-image-edit --body-file ./payload.json --api-key <key>',
    '<%= config.bin %> <%= command.id %> --model-slug google/nano-banana-2 --body-file - --wait',
  ]
  static flags = {
    'api-key': Flags.string({
      description: 'Modellix API key (overrides environment and saved configuration)',
    }),
    body: Flags.string({
      description: 'JSON string request body',
      exclusive: ['body-file'],
    }),
    'body-file': Flags.string({
      description: 'Path to a JSON file used as request body',
      exclusive: ['body'],
    }),
    interval: Flags.string({
      default: '2s',
      description: 'Polling interval when --wait is enabled (for example 5s or 1m)',
    }),
    'max-body-bytes': Flags.integer({
      default: DEFAULT_MODEL_BODY_MAX_BYTES,
      description: 'Maximum JSON request body size in bytes',
      max: DEFAULT_MODEL_BODY_MAX_BYTES,
      min: 1,
    }),
    'model-slug': Flags.string({
      description: 'Model slug in provider/model format, for example bytedance/seedream-4.5-t2i',
      required: true,
    }),
    output: Flags.string({
      default: 'json',
      description: 'Output format',
      options: ['human', 'json', 'quiet', 'task-id'],
    }),
    quiet: Flags.boolean({
      char: 'q',
      description: 'Output only the task ID, or resource URLs when waiting',
    }),
    timeout: Flags.string({
      default: '5m',
      description: 'Maximum time to wait (for example 30s, 5m, or 1h)',
    }),
    wait: Flags.boolean({
      allowNo: true,
      default: false,
      description: 'Wait for the submitted task to reach a terminal state',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ModelRun)
    const output = resolveOutputValue(flags, 'json')
    const authentication = await resolveApiKeyDetails({
      apiKey: flags['api-key'],
      profile: flags.profile,
    })
    const {apiKey} = authentication
    const historyContext = {baseUrl: resolveBaseUrl(), profile: authentication.profile}
    const body = await parseModelInvokeBody({
      bodyFile: flags['body-file'],
      bodyText: flags.body,
      maxBytes: flags['max-body-bytes'],
    })
    const intervalMs = flags.wait
      ? parseModelDuration(flags.interval, 'interval', 3_600_000)
      : undefined
    const timeoutMs = flags.wait
      ? parseModelDuration(flags.timeout, 'timeout', 604_800_000)
      : undefined

    const response = await runModel({
      apiKey,
      body,
      modelSlug: flags['model-slug'],
    })
    const taskId = getTaskId(response)

    await this.recordHistory({
      ...historyContext,
      modelSlug: flags['model-slug'],
      status: 'submitted',
      taskId,
    })
    if (!flags.wait) {
      this.outputSubmittedResult(response, taskId, output)
      return
    }

    let result: Awaited<ReturnType<typeof waitForModelTask>>
    try {
      result = await waitForModelTask({apiKey, intervalMs: intervalMs!, taskId, timeoutMs: timeoutMs!})
    } catch (error) {
      if (error instanceof ModelTaskTimeoutError) {
        this.error(
          `Task ${taskId} was submitted but did not finish before the timeout. It may still be running. Resume with: modellix-cli task wait ${taskId}`,
          {exit: 124},
        )
      }

      const message = error instanceof Error ? error.message : 'Unknown polling error.'
      this.error(
        `Task ${taskId} was submitted, but status polling failed: ${message} Resume with: modellix-cli task wait ${taskId}`,
        {exit: 1},
      )
    }

    await this.recordHistory({...historyContext, status: result.status, taskId})
    this.outputSubmittedResult(result.response, taskId, output)
    if (result.failed) {
      this.exit(1)
    }
  }

  private outputResult(
    response: Parameters<typeof getTaskId>[0],
    taskId: string,
    output: string,
  ): void {
    if (output === 'quiet') {
      const resourceUrls = getTaskResourceUrls(response)
      this.log(resourceUrls.length > 0 ? resourceUrls.join('\n') : taskId)
      return
    }

    if (output === 'task-id') {
      this.log(taskId)
      return
    }

    if (output === 'human') {
      const resourceUrls = getTaskResourceUrls(response)
      this.log(`Task: ${taskId}`)
      if (resourceUrls.length > 0) {
        this.log(`Resources:\n${resourceUrls.join('\n')}`)
      }

      return
    }

    this.log(JSON.stringify(response, null, 2))
  }

  private outputSubmittedResult(
    response: Parameters<typeof getTaskId>[0],
    taskId: string,
    output: string,
  ): void {
    try {
      this.outputResult(response, taskId, output)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown output error.'
      this.error(
        `Task ${taskId} was submitted, but its response could not be displayed: ${message} Resume with: modellix-cli task wait ${taskId}`,
        {exit: 1},
      )
    }
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
      const message = error instanceof Error ? error.message : 'Unknown history error.'
      this.warn(`Task ${input.taskId} was submitted, but local history could not be updated: ${message}`)
    }
  }
}
