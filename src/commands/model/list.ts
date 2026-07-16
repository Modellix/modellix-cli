import {Flags} from '@oclif/core'

import {BaseCommand, resolveOutputValue} from '../../base-command.js'
import {resolveApiKey} from '../../lib/auth.js'
import {filterModels, getModels, isRecord} from '../../lib/model-data.js'
import {listModels} from '../../lib/modellix-client.js'
import {sanitizeTerminalText} from '../../lib/safe-text.js'

export default class ModelList extends BaseCommand {
  static description = 'List available Modellix models'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --type text-to-image --output slugs',
    '<%= config.bin %> <%= command.id %> --provider google --limit 20',
    '<%= config.bin %> <%= command.id %> --search banana',
    '<%= config.bin %> <%= command.id %> --api-key <key>',
  ]
  static flags = {
    'api-key': Flags.string({
      description: 'Modellix API key (overrides environment and saved configuration)',
    }),
    limit: Flags.integer({
      description: 'Maximum number of models to return',
      min: 1,
    }),
    output: Flags.string({
      default: 'json',
      description: 'Output format',
      options: ['human', 'json', 'quiet', 'slugs'],
    }),
    provider: Flags.string({description: 'Filter by exact provider name'}),
    quiet: Flags.boolean({char: 'q', description: 'Output one model slug per line'}),
    search: Flags.string({description: 'Filter by slug or description substring'}),
    type: Flags.string({description: 'Filter by exact model type, for example text-to-image'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ModelList)
    const output = resolveOutputValue(flags, 'json')
    const apiKey = await resolveApiKey({apiKey: flags['api-key'], profile: flags.profile})
    const response = await listModels({apiKey})
    if (!isRecord(response)) {
      throw new Error('Invalid response from Modellix API: expected an object response.')
    }

    const models = filterModels(getModels(response), {
      limit: flags.limit,
      provider: flags.provider,
      search: flags.search,
      type: flags.type,
    })

    if (output === 'quiet' || output === 'slugs') {
      if (models.length > 0) this.log(models.map((model) => model.slug).join('\n'))
      return
    }

    if (output === 'human') {
      this.log(
        models
          .map((model) => {
            const type = typeof model.type === 'string'
              ? `\t${sanitizeTerminalText(model.type, 128)}`
              : ''
            return `${model.slug}${type}`
          })
          .join('\n'),
      )
      return
    }

    this.log(JSON.stringify({...response, models}, null, 2))
  }
}
