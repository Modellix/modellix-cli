import {Args, Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../../base-command.js'
import {resolveApiKeyDetails} from '../../lib/auth.js'
import {recordTaskHistorySafely} from '../../lib/history-command.js'
import {getTaskResult, resolveBaseUrl} from '../../lib/modellix-client.js'
import {normalizeTaskId} from '../../lib/safe-text.js'
import {extractTaskResources, validateTaskResponse} from '../../lib/task.js'

export default class TaskGet extends BaseCommand {
  static args = {
    taskId: Args.string({description: 'Task ID returned by model run', required: true}),
  }
  static description = 'Get Modellix task result by task ID'
  static examples = [
    '<%= config.bin %> <%= command.id %> task-abc123 --api-key <key>',
    '<%= config.bin %> <%= command.id %> task-abc123',
  ]
  static flags = {
    'api-key': Flags.string({
      description: 'Modellix API key (overrides environment and saved configuration)',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(TaskGet)
    const taskId = normalizeTaskId(args.taskId)
    const authentication = await resolveApiKeyDetails({
      apiKey: flags['api-key'],
      profile: flags.profile,
    })
    const response = await getTaskResult({apiKey: authentication.apiKey, taskId})
    const {status} = validateTaskResponse(response, taskId)
    await recordTaskHistorySafely(this, {
      baseUrl: resolveBaseUrl(),
      profile: authentication.profile,
      status,
      taskId,
    })
    const outputMode = resolveOutputMode(flags, 'json')
    if (outputMode === 'quiet') {
      const urls = extractTaskResources(response).map((resource) => resource.url)
      this.log((urls.length > 0 ? urls : [taskId]).join('\n'))
      return
    }

    if (outputMode === 'human') {
      this.log(`Task: ${taskId}`)
      this.log(`Status: ${status}`)
      for (const resource of extractTaskResources(response)) this.log(`Resource: ${resource.url}`)
      return
    }

    this.log(JSON.stringify(response, null, 2))
  }
}
