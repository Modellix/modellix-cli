import {expect} from 'chai'
import {execFile} from 'node:child_process'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'

const execFileAsync = promisify(execFile)
const projectRoot = fileURLToPath(new URL('../../', import.meta.url))

describe('CLI entry', () => {
  let temporaryXdgDirectory: string

  beforeEach(async () => {
    temporaryXdgDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-entry-test-'))
  })

  afterEach(async () => {
    await rm(temporaryXdgDirectory, {force: true, recursive: true})
  })

  it('shows Quickstart for an empty invocation', async () => {
    const {stderr, stdout} = await runDevelopmentEntry([])

    expect(stderr).to.equal('')
    expect(stdout).to.contain('Welcome to Modellix CLI.')
    expect(stdout).to.contain('modellix-cli init')
    expect(stdout).to.contain('https://www.modellix.ai/console/api-key')
    expect(stdout).to.contain('Help: modellix-cli --help')
    expect(stdout).to.contain('Docs: https://docs.modellix.ai/ways-to-use/cli')
  })

  it('keeps explicit root help unchanged', async () => {
    const {stderr, stdout} = await runDevelopmentEntry(['--help'])

    expect(stderr).to.equal('')
    expect(stdout).to.contain('USAGE')
    expect(stdout).to.contain('$ modellix-cli [COMMAND]')
    expect(stdout).not.to.contain('Welcome to Modellix CLI.')
  })

  it('maps a root --json flag to a clean Quickstart JSON document', async () => {
    const {stderr, stdout} = await runDevelopmentEntry(['--json'])
    const payload = JSON.parse(stdout) as {configured: boolean; ok: boolean}

    expect(stderr).to.equal('')
    expect(payload).to.deep.include({configured: false, ok: true})
  })

  it('returns one stable JSON error document for an explicit JSON request', async () => {
    let captured: unknown
    try {
      await runDevelopmentEntry([
        'model',
        'run',
        '--model-slug',
        'google/model',
        '--api-key',
        'test-key',
        '--body',
        'not-json',
        '--json',
      ])
    } catch (error) {
      captured = error
    }

    const result = captured as {code?: number; stderr?: string; stdout?: string}
    expect(result.code).to.equal(1)
    expect(result.stderr).to.equal('')
    expect(JSON.parse(result.stdout ?? '')).to.deep.include({ok: false})
  })

  it('never executes a suggested command in a non-interactive session', async () => {
    let captured: unknown
    try {
      await runDevelopmentEntry(['model', 'rn'])
    } catch (error) {
      captured = error
    }

    const result = captured as {code?: number; stderr?: string}
    expect(result.code).to.equal(127)
    expect(result.stderr).to.contain('is not a modellix-cli command')
    expect(result.stderr).to.contain('Run modellix-cli help model')
  })

  it('does not suggest an unrelated command for arbitrary input', async () => {
    let captured: unknown
    try {
      await runDevelopmentEntry(['xyzabc'])
    } catch (error) {
      captured = error
    }

    const result = captured as {stderr?: string}
    expect(result.stderr).not.to.contain('Did you mean')
  })

  it('accepts CI-safe global flags and emits quiet output', async () => {
    const {stderr, stdout} = await runDevelopmentEntry([
      'quickstart',
      '--output',
      'quiet',
      '--no-color',
      '--no-progress',
    ])

    expect(stderr).to.equal('')
    expect(stdout.trim()).to.equal('missing')
  })

  it('accepts global flags before a command and maps global-only flags to Quickstart', async () => {
    const prefixed = await runDevelopmentEntry(['--no-color', 'config', 'path', '--quiet'])
    expect(prefixed.stderr).to.equal('')
    expect(prefixed.stdout.trim()).to.match(/config\.json$/)

    const globalOnly = await runDevelopmentEntry(['--output', 'quiet', '--no-progress'])
    expect(globalOnly.stderr).to.equal('')
    expect(globalOnly.stdout.trim()).to.equal('missing')
  })

  async function runDevelopmentEntry(args: string[]): Promise<{stderr: string; stdout: string}> {
    return execFileAsync(
      process.execPath,
      [
        '--loader',
        'ts-node/esm',
        '--no-warnings=ExperimentalWarning',
        join(projectRoot, 'bin', 'dev.js'),
        ...args,
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          MODELLIX_API_KEY: '',
          MODELLIX_CLI_SKIP_NEW_VERSION_CHECK: 'true',
          NO_COLOR: '1',
          XDG_CONFIG_HOME: temporaryXdgDirectory,
        },
        timeout: 30_000,
      },
    )
  }
})
