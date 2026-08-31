import {Args, Flags} from '@oclif/core'

import {BaseCommand, resolveOutputValue} from '../../base-command.js'
import {formatModelSchemaHuman, parseModelSchema} from '../../lib/model-schema.js'
import {getModelSchema, parseModelSlug} from '../../lib/modellix-client.js'

export default class ModelGetSchema extends BaseCommand {
  static args = {
    slug: Args.string({
      description: 'Model slug from `modellix-cli model list --output slugs`',
      required: true,
    }),
  }
  static description = 'Get a public model schema; use model list --output slugs to discover models'
  static examples = [
    '<%= config.bin %> <%= command.id %> alibaba/qwen-image-3.0-pro',
    '<%= config.bin %> <%= command.id %> alibaba/qwen-image-3.0-pro --output human',
    '<%= config.bin %> <%= command.id %> alibaba/qwen-image-3.0-pro --quiet',
  ]
  static flags = {
    json: Flags.boolean({description: 'Output the complete schema as JSON'}),
    output: Flags.string({
      default: 'json',
      description: 'Output format',
      options: ['human', 'json', 'quiet'],
    }),
    quiet: Flags.boolean({char: 'q', description: 'Output only the model inference URL'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(ModelGetSchema)
    let parsedSlug: ReturnType<typeof parseModelSlug>
    try {
      parsedSlug = parseModelSlug(args.slug)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid model slug.'
      this.error(
        `${message} Run modellix-cli model list --output slugs to see available model slugs.`,
        {exit: 2},
      )
    }

    const {modelId, provider} = parsedSlug
    const modelSlug = `${provider}/${modelId}`
    const schema = parseModelSchema(await getModelSchema({
      baseUrl: flags['base-url'],
      modelSlug,
    }))
    const output = resolveOutputValue(flags, 'json')

    if (output === 'quiet') {
      this.log(schema.endpoint)
      return
    }

    this.log(
      output === 'human'
        ? formatModelSchemaHuman(modelSlug, schema)
        : JSON.stringify(schema.raw, null, 2),
    )
  }
}
