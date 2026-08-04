import {Args, Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../../base-command.js'
import {resolveApiKeyDetails} from '../../lib/auth.js'
import {deleteMediaFile} from '../../lib/modellix-client.js'

export default class FileDelete extends BaseCommand {
  static args = {
    fileId: Args.string({description: 'Modellix file ID returned by file upload', required: true}),
  }
  static description = 'Delete a Modellix reference file'
  static examples = [
    '<%= config.bin %> <%= command.id %> file-abc123',
    '<%= config.bin %> <%= command.id %> file-abc123 --json',
  ]
  static flags = {
    'api-key': Flags.string({
      description: 'Modellix API key (overrides environment and saved configuration)',
    }),
    json: Flags.boolean({description: 'Print one stable machine-readable JSON result'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FileDelete)
    const authentication = await resolveApiKeyDetails({
      apiKey: flags['api-key'],
      profile: flags.profile,
    })
    const fileId = await deleteMediaFile({apiKey: authentication.apiKey, fileId: args.fileId})
    const outputMode = resolveOutputMode(flags)
    if (outputMode === 'quiet') {
      this.log(fileId)
      return
    }

    if (outputMode === 'json') {
      this.log(JSON.stringify({deleted: true, fileId, ok: true}, null, 2))
      return
    }

    this.log(`Deleted Modellix file ${fileId}.`)
  }
}
