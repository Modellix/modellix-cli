import {Command, Flags} from '@oclif/core'

import {MODELLIX_PROFILE_ENV} from './lib/auth.js'
import {MODELLIX_BASE_URL_ENV} from './lib/modellix-client.js'
import {escapeTerminalControls, sanitizeTerminalText} from './lib/safe-text.js'

export abstract class BaseCommand extends Command {
  static baseFlags = {
    'base-url': Flags.string({
      description: 'Modellix API origin (HTTPS, or HTTP for localhost)',
      env: MODELLIX_BASE_URL_ENV,
      helpGroup: 'GLOBAL',
    }),
    debug: Flags.boolean({
      description: 'Print sanitized HTTP diagnostics to stderr',
      helpGroup: 'GLOBAL',
    }),
    json: Flags.boolean({
      description: 'Print machine-readable JSON',
      helpGroup: 'GLOBAL',
    }),
    'no-color': Flags.boolean({
      description: 'Disable terminal colors',
      helpGroup: 'GLOBAL',
    }),
    'no-progress': Flags.boolean({
      description: 'Disable progress messages',
      helpGroup: 'GLOBAL',
    }),
    output: Flags.string({
      description: 'Output format',
      helpGroup: 'GLOBAL',
      options: ['human', 'json', 'quiet'],
    }),
    profile: Flags.string({
      description: `Authentication profile to use (defaults to ${MODELLIX_PROFILE_ENV})`,
      helpGroup: 'GLOBAL',
    }),
    quiet: Flags.boolean({
      char: 'q',
      description: 'Print only the primary value',
      helpGroup: 'GLOBAL',
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Print additional non-sensitive details to stderr',
      helpGroup: 'GLOBAL',
    }),
  }
  private readonly originalEnvironment = new Map<string, string | undefined>()
  private outputWritten = false

  protected async catch(
    error: Error & {exitCode?: number; oclif?: {exit?: number}},
  ): Promise<unknown> {
    if (jsonErrorOutputRequested(this.argv)) {
      const exitCode = error.exitCode ?? error.oclif?.exit ?? 1
      if (!this.outputWritten) {
        super.log(
          escapeTerminalControls(JSON.stringify(
            {
              error: {exitCode, message: sanitizeTerminalText(error.message || 'Command failed.')},
              ok: false,
            },
            null,
            2,
          )),
        )
      }

      this.exit(exitCode)
    }

    error.message = sanitizeTerminalText(error.message || 'Command failed.', 10_000)
    return super.catch(error)
  }

  protected async finally(error: Error | undefined): Promise<void> {
    for (const [name, value] of this.originalEnvironment) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }

    await super.finally(error)
  }

  protected async init(): Promise<void> {
    await super.init()
    const optionTerminator = this.argv.indexOf('--')
    const runtimeArgv = optionTerminator === -1 ? this.argv : this.argv.slice(0, optionTerminator)
    const baseUrl = readOption(runtimeArgv, 'base-url')
    if (baseUrl) this.setEnvironment(MODELLIX_BASE_URL_ENV, baseUrl)
    if (runtimeArgv.includes('--debug')) this.setEnvironment('MODELLIX_CLI_HTTP_DEBUG', '1')
    if (runtimeArgv.includes('--verbose') || runtimeArgv.includes('-v')) {
      this.setEnvironment('MODELLIX_CLI_VERBOSE', '1')
    }

    if (process.env.CI || runtimeArgv.includes('--no-color')) {
      this.setEnvironment('NO_COLOR', process.env.NO_COLOR ?? '1')
      this.setEnvironment('FORCE_COLOR', '0')
    }

    if (process.env.CI || runtimeArgv.includes('--no-progress')) {
      this.setEnvironment('MODELLIX_CLI_NO_PROGRESS', '1')
    }
  }

  log(message = '', ...args: unknown[]): void {
    if (message) this.outputWritten = true
    super.log(escapeTerminalControls(message), ...args)
  }

  warn(input: Error | string): Error | string {
    const safeInput = input instanceof Error
      ? Object.assign(input, {message: sanitizeTerminalText(input.message, 10_000)})
      : sanitizeTerminalText(input, 10_000)
    return super.warn(safeInput)
  }

  private setEnvironment(name: string, value: string): void {
    if (!this.originalEnvironment.has(name)) this.originalEnvironment.set(name, process.env[name])
    process.env[name] = value
  }
}

export function progressEnabled(): boolean {
  return process.env.MODELLIX_CLI_NO_PROGRESS !== '1'
}

export type OutputMode = 'human' | 'json' | 'quiet'

export function resolveOutputMode(
  flags: {json?: boolean; output?: string; quiet?: boolean},
  defaultMode: OutputMode = 'human',
): OutputMode {
  const output = resolveOutputValue(flags, defaultMode)
  return output === 'human' || output === 'json' || output === 'quiet' ? output : defaultMode
}

export function resolveOutputValue(
  flags: {json?: boolean; output?: string; quiet?: boolean},
  defaultOutput: string,
): string {
  if (flags.quiet || flags.output === 'quiet') {
    return 'quiet'
  }

  if (flags.json || flags.output === 'json') {
    return 'json'
  }

  return flags.output ?? defaultOutput
}

export function verboseEnabled(): boolean {
  return process.env.MODELLIX_CLI_VERBOSE === '1' || process.env.MODELLIX_CLI_HTTP_DEBUG === '1'
}

function jsonErrorOutputRequested(argv: string[]): boolean {
  const optionTerminator = argv.indexOf('--')
  const options = optionTerminator === -1 ? argv : argv.slice(0, optionTerminator)
  const output = readOption(options, 'output')
  if (options.includes('--quiet') || options.includes('-q') || output === 'quiet') return false
  return options.includes('--json') || output === 'json'
}

function readOption(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const inline = argv.find((argument) => argument.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)

  const index = argv.indexOf(`--${name}`)
  return index === -1 ? undefined : argv[index + 1]
}
