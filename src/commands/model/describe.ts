import {Args, Flags} from '@oclif/core'

import {BaseCommand, resolveOutputValue} from '../../base-command.js'
import {resolveApiKey} from '../../lib/auth.js'
import {formatModelDetails, getModels} from '../../lib/model-data.js'
import {listModels} from '../../lib/modellix-client.js'
import {normalizeSafeText} from '../../lib/safe-text.js'

export default class ModelDescribe extends BaseCommand {
  static args = {
    slug: Args.string({description: 'Model slug in provider/model format', required: true}),
  }
  static description = 'Show details for a Modellix model'
  static examples = [
    '<%= config.bin %> <%= command.id %> google/nano-banana-2',
    '<%= config.bin %> <%= command.id %> google/nano-banana-2 --json',
    '<%= config.bin %> <%= command.id %> google/nano-banana-2 --quiet',
  ]
  static flags = {
    'api-key': Flags.string({
      description: 'Modellix API key (overrides environment and saved configuration)',
    }),
    json: Flags.boolean({description: 'Output model details as JSON'}),
    output: Flags.string({
      default: 'human',
      description: 'Output format',
      options: ['human', 'json', 'quiet'],
    }),
    quiet: Flags.boolean({char: 'q', description: 'Output only the model slug'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ModelDescribe)
    const output = resolveOutputValue(flags, 'human')
    const apiKey = await resolveApiKey({apiKey: flags['api-key'], profile: flags.profile})
    const models = getModels(await listModels({apiKey}))
    const normalizedSlug = normalizeSafeText(args.slug, 'Model slug', 256)
    const requestedSlug = normalizedSlug.toLowerCase()
    const model = models.find((candidate) => candidate.slug.toLowerCase() === requestedSlug)
    if (!model) {
      this.error(`Model not found: ${normalizedSlug}`, {exit: 2})
    }

    if (output === 'quiet') {
      this.log(model.slug)
      return
    }

    this.log(output === 'json' ? JSON.stringify(model, null, 2) : formatModelDetails(model))
  }
}
