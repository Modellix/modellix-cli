import {Command, Flags} from '@oclif/core'

import {MODEL_TYPES} from '../../lib/model-types.js'

export default class ModelTypes extends Command {
  static description = 'List supported values for --model-type'
  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]
  static flags = {
    json: Flags.boolean({
      description: 'Output values as a JSON array',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ModelTypes)
    if (flags.json) {
      this.log(JSON.stringify(MODEL_TYPES, null, 2))
      return
    }

    for (const modelType of MODEL_TYPES) {
      this.log(modelType)
    }
  }
}
