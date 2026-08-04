import {Args, Flags} from '@oclif/core'

import {BaseCommand, resolveOutputMode} from '../../base-command.js'
import {resolveApiKeyDetails} from '../../lib/auth.js'
import {prepareMediaFile} from '../../lib/media-file.js'
import {uploadMediaFile} from '../../lib/modellix-client.js'

export default class FileUpload extends BaseCommand {
  static args = {
    path: Args.string({description: 'PNG, JPEG, or WebP file to upload', required: true}),
  }
  static description = 'Upload a local image for use as a Modellix model reference'
  static examples = [
    '<%= config.bin %> <%= command.id %> ./reference.png --json',
    '<%= config.bin %> <%= command.id %> ./reference.webp --quiet',
  ]
  static flags = {
    'api-key': Flags.string({
      description: 'Modellix API key (overrides environment and saved configuration)',
    }),
    json: Flags.boolean({description: 'Print one stable machine-readable JSON result'}),
    quiet: Flags.boolean({char: 'q', description: 'Print only the uploaded file URL'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FileUpload)
    const authentication = await resolveApiKeyDetails({
      apiKey: flags['api-key'],
      profile: flags.profile,
    })
    const prepared = await prepareMediaFile(args.path)
    const file = await uploadMediaFile({
      apiKey: authentication.apiKey,
      bytes: prepared.bytes,
      filename: prepared.filename,
      mimeType: prepared.mimeType,
    })
    const outputMode = resolveOutputMode(flags)
    if (outputMode === 'quiet') {
      this.log(file.url)
      return
    }

    if (outputMode === 'json') {
      this.log(JSON.stringify({file, ok: true}, null, 2))
      return
    }

    this.log(`Uploaded ${file.filename} (${file.size} bytes).`)
    this.log(`File ID: ${file.fileId}`)
    this.log(`URL: ${file.url}`)
  }
}
