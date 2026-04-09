import {Command, Flags} from '@oclif/core'

import {resolveApiKey} from '../../lib/auth.js'
import {parseModelInvokeBody} from '../../lib/body.js'
import {invokeModelAsync} from '../../lib/modellix-client.js'

export default class ModelInvoke extends Command {
  static description = 'Create an async Modellix model task'
  static examples = [
    '<%= config.bin %> <%= command.id %> --model-slug bytedance/seedream-4.5-t2i --body \'{"prompt":"A cute cat"}\'',
    '<%= config.bin %> <%= command.id %> --model-slug alibaba/qwen-image-edit --body-file ./payload.json --api-key <key>',
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
    'model-slug': Flags.string({
      description: 'Model slug in provider/model format, for example bytedance/seedream-4.5-t2i',
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
      modelSlug: flags['model-slug'],
    })

    this.log(JSON.stringify(response, null, 2))
  }
}
