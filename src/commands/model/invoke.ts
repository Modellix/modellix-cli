import {Command, Flags} from '@oclif/core'

import {resolveApiKey} from '../../lib/auth.js'
import {parseModelInvokeBody} from '../../lib/body.js'
import {MODEL_TYPES} from '../../lib/model-types.js'
import {invokeModelAsync} from '../../lib/modellix-client.js'

export default class ModelInvoke extends Command {
  static description = 'Create an async Modellix model task'
  static examples = [
    '<%= config.bin %> <%= command.id %> --model-type text-to-image --model-id qwen-image-plus --body \'{"prompt":"A cute cat"}\'',
    '<%= config.bin %> <%= command.id %> --model-type text-to-image --model-id qwen-image-plus --body-file ./payload.json --api-key <key>',
  ]
  static flags = {
    'api-key': Flags.string({
      description: 'Modellix API key (falls back to MODELLIX_API_KEY)',
    }),
    body: Flags.string({
      description: 'JSON string request body',
      exclusive: ['body-file'],
    }),
    'body-file': Flags.string({
      description: 'Path to a JSON file used as request body',
      exclusive: ['body'],
    }),
    'model-id': Flags.string({
      description: 'Model ID, for example qwen-image-plus',
      required: true,
    }),
    'model-type': Flags.string({
      description: 'Model type path segment, for example text-to-image',
      options: [...MODEL_TYPES],
      required: true,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ModelInvoke)
    const apiKey = resolveApiKey(flags['api-key'])
    const body = await parseModelInvokeBody({
      bodyFile: flags['body-file'],
      bodyText: flags.body,
    })

    const response = await invokeModelAsync({
      apiKey,
      body,
      modelId: flags['model-id'],
      modelType: flags['model-type'],
    })

    this.log(JSON.stringify(response, null, 2))
  }
}
