import {Args, Command, Flags} from '@oclif/core'

import {resolveApiKey} from '../../lib/auth.js'
import {getTaskResult} from '../../lib/modellix-client.js'

export default class TaskGet extends Command {
  static args = {
    taskId: Args.string({description: 'Task ID returned by model invoke', required: true}),
  }
  static description = 'Get Modellix task result by task ID'
  static examples = [
    '<%= config.bin %> <%= command.id %> task-abc123 --api-key <key>',
    '<%= config.bin %> <%= command.id %> task-abc123',
  ]
  static flags = {
    'api-key': Flags.string({
      description: 'Modellix API key (falls back to MODELLIX_API_KEY)',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(TaskGet)
    const apiKey = resolveApiKey(flags['api-key'])
    const response = await getTaskResult({apiKey, taskId: args.taskId})
    this.log(JSON.stringify(response, null, 2))
  }
}
