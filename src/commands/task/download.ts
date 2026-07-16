import {Args, Flags} from '@oclif/core'
import {resolve} from 'node:path'

import {BaseCommand, resolveOutputMode} from '../../base-command.js'
import {resolveApiKeyDetails} from '../../lib/auth.js'
import {parseDurationMs} from '../../lib/duration.js'
import {recordTaskHistorySafely} from '../../lib/history-command.js'
import {getTaskResult, resolveBaseUrl} from '../../lib/modellix-client.js'
import {normalizeSafeText, normalizeTaskId} from '../../lib/safe-text.js'
import {
  DEFAULT_DOWNLOAD_MAX_BYTES,
  DEFAULT_DOWNLOAD_MAX_RESOURCES,
  DEFAULT_DOWNLOAD_MAX_TOTAL_BYTES,
  downloadTaskResources,
  extractTaskResources,
  SUCCESS_TASK_STATUSES,
  validateTaskResponse,
} from '../../lib/task.js'

export default class TaskDownload extends BaseCommand {
  static args = {
    taskId: Args.string({description: 'Task ID whose result resources should be downloaded', required: true}),
  }
  static description = 'Download HTTP(S) resources from a completed Modellix task'
  static examples = [
    '<%= config.bin %> <%= command.id %> task-abc123',
    '<%= config.bin %> <%= command.id %> task-abc123 --output-dir ./results --json',
    '<%= config.bin %> <%= command.id %> task-abc123 --overwrite --quiet',
  ]
  static flags = {
    'allow-insecure-http': Flags.boolean({
      description: 'Allow HTTP resource URLs from a trusted source',
    }),
    'allow-private-network': Flags.boolean({
      description: 'Allow resource hosts on private or reserved networks',
    }),
    'api-key': Flags.string({
      description: 'Modellix API key (overrides environment and saved configuration)',
    }),
    json: Flags.boolean({
      description: 'Print one stable machine-readable JSON result',
    }),
    'max-bytes': Flags.integer({
      default: DEFAULT_DOWNLOAD_MAX_BYTES,
      description: 'Maximum bytes allowed for each downloaded resource',
      min: 1,
    }),
    'max-resources': Flags.integer({
      default: DEFAULT_DOWNLOAD_MAX_RESOURCES,
      description: 'Maximum number of resources downloaded from one task',
      max: 1000,
      min: 1,
    }),
    'max-total-bytes': Flags.integer({
      default: DEFAULT_DOWNLOAD_MAX_TOTAL_BYTES,
      description: 'Maximum combined bytes downloaded from one task',
      min: 1,
    }),
    'output-dir': Flags.directory({
      default: '.',
      description: 'Directory in which downloaded resources are saved',
    }),
    overwrite: Flags.boolean({description: 'Overwrite existing regular files with matching names'}),
    quiet: Flags.boolean({
      char: 'q',
      description: 'Print only downloaded absolute file paths',
    }),
    timeout: Flags.string({
      default: '10m',
      description: 'Total deadline for each resource, including redirects',
    }),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(TaskDownload)
    const taskId = normalizeTaskId(args.taskId)
    const outputDirectory = resolve(
      normalizeSafeText(flags['output-dir'], 'Download output directory', 32_767),
    )
    const timeoutMs = parseDurationMs(flags.timeout, 'download timeout', {
      maxMs: 86_400_000,
    })
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
    if (!SUCCESS_TASK_STATUSES.has(status.toLowerCase())) {
      this.error(`Task ${taskId} is not complete (current status: ${status}).`, {exit: 1})
    }

    const resources = extractTaskResources(response)
    if (resources.length === 0) {
      this.error(`Task ${taskId} does not contain downloadable resources.`, {exit: 1})
    }

    const files = await downloadTaskResources({
      allowInsecureHttp: flags['allow-insecure-http'],
      allowPrivateNetwork: flags['allow-private-network'],
      maxBytes: flags['max-bytes'],
      maxResources: flags['max-resources'],
      maxTotalBytes: flags['max-total-bytes'],
      outputDirectory,
      overwrite: flags.overwrite,
      resources,
      timeoutMs,
    })

    const outputMode = resolveOutputMode(flags)
    if (outputMode === 'json') {
      this.log(
        JSON.stringify(
          {
            files,
            ok: true,
            outputDirectory,
            taskId,
          },
          null,
          2,
        ),
      )
      return
    }

    if (outputMode === 'quiet') {
      this.log(files.map((file) => file.path).join('\n'))
      return
    }

    this.log(`Downloaded ${files.length} resource(s) to ${outputDirectory}:`)
    for (const file of files) {
      this.log(file.path)
    }
  }
}
