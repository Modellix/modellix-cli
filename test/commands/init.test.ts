import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {__setInitPrompterForTest} from '../../src/commands/init.js'
import {MODELLIX_API_KEY_ENV} from '../../src/lib/auth.js'
import {readConfig, writeConfig} from '../../src/lib/config.js'
import {__setHttpRequesterForTest} from '../../src/lib/modellix-client.js'

const isValidProperty = 'is_valid'

describe('init', () => {
  let originalApiKey: string | undefined
  let originalStdinIsTty: PropertyDescriptor | undefined
  let originalStdoutIsTty: PropertyDescriptor | undefined
  let originalXdgConfigHome: string | undefined
  let requestCount = 0
  let temporaryXdgDirectory: string

  beforeEach(async () => {
    originalApiKey = process.env[MODELLIX_API_KEY_ENV]
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    originalStdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    originalStdoutIsTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    temporaryXdgDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-init-test-'))
    process.env.XDG_CONFIG_HOME = temporaryXdgDirectory
    delete process.env[MODELLIX_API_KEY_ENV]
    setNonInteractiveTerminal()
    requestCount = 0
  })

  afterEach(async () => {
    __setInitPrompterForTest()
    __setHttpRequesterForTest()
    restoreEnvironmentVariable(MODELLIX_API_KEY_ENV, originalApiKey)
    restoreEnvironmentVariable('XDG_CONFIG_HOME', originalXdgConfigHome)
    restoreProperty(process.stdin, 'isTTY', originalStdinIsTty)
    restoreProperty(process.stdout, 'isTTY', originalStdoutIsTty)
    await rm(temporaryXdgDirectory, {force: true, recursive: true})
  })

  it('validates and saves an explicit API key', async () => {
    mockValidation(true)

    const {error, stderr, stdout} = await runCommand([
      'init',
      '--api-key',
      'valid-init-test-key',
      '--yes',
      '--json',
    ])
    const report = parseJson(stdout)

    expect(error).to.equal(undefined)
    expect(stderr).not.to.contain('valid-init-test-key')
    expect(report).to.include({apiKeySource: 'flag', ok: true, saved: true, valid: true})
    expect(await readConfig()).to.deep.equal({apiKey: 'valid-init-test-key'})
    expect(requestCount).to.equal(1)
    expect(stdout).not.to.contain('valid-init-test-key')
  })

  it('does not save an invalid API key', async () => {
    mockValidation(false)

    const {error, stderr, stdout} = await runCommand([
      'init',
      '--api-key',
      'invalid-init-test-key',
      '--yes',
      '--json',
    ])
    const report = parseJson(stdout)

    expect(getExitCode(error)).to.equal(1)
    expect(report).to.deep.include({ok: false})
    expect(await readConfig()).to.equal(undefined)
    expect(requestCount).to.equal(1)
    expect(`${stdout}${stderr}${error?.message ?? ''}`).not.to.contain('invalid-init-test-key')
  })

  it('checks a valid API key without writing configuration', async () => {
    mockValidation(true)

    const {error, stdout} = await runCommand([
      'init',
      '--api-key',
      'check-init-test-key',
      '--check',
      '--json',
    ])
    const report = parseJson(stdout)

    expect(error).to.equal(undefined)
    expect(report).to.include({ok: true, saved: false, valid: true})
    expect(await readConfig()).to.equal(undefined)
    expect(requestCount).to.equal(1)
  })

  it('refuses to replace an existing config without force in a non-interactive session', async () => {
    await writeConfig({apiKey: 'existing-config-test-key'})
    mockValidation(true)

    const {error, stdout} = await runCommand([
      'init',
      '--api-key',
      'replacement-test-key',
      '--json',
    ])
    const report = parseJson(stdout)

    expect(getExitCode(error)).to.equal(1)
    expect(JSON.stringify(report)).to.contain('--force')
    expect(await readConfig()).to.deep.equal({apiKey: 'existing-config-test-key'})
    expect(requestCount).to.equal(0)
  })

  it('returns a JSON failure without prompting when no key exists in a non-interactive session', async () => {
    __setHttpRequesterForTest(async () => {
      requestCount += 1
      throw new Error('index must not make a request without a key')
    })

    const {error, stdout} = await runCommand(['init', '--json'])
    const report = parseJson(stdout)

    expect(getExitCode(error)).to.equal(1)
    expect(report).to.deep.include({ok: false})
    expect(JSON.stringify(report)).to.match(/non-interactive|--api-key/)
    expect(requestCount).to.equal(0)
    expect(await readConfig()).to.equal(undefined)
  })

  it('never prompts or pollutes JSON output in a TTY JSON session', async () => {
    setInteractiveTerminal()
    __setInitPrompterForTest({
      async confirm() {
        throw new Error('confirm must not run in JSON mode')
      },
      async password() {
        throw new Error('password must not run in JSON mode')
      },
    })

    const {error, stdout} = await runCommand(['init', '--json'])
    const report = parseJson(stdout)

    expect(getExitCode(error)).to.equal(1)
    expect(report).to.deep.include({ok: false})
    expect(requestCount).to.equal(0)
  })

  it('securely rotates a saved key through the hidden TTY prompt with --force', async () => {
    await writeConfig({apiKey: 'existing-config-test-key'})
    setInteractiveTerminal()
    __setInitPrompterForTest({
      async confirm() {
        throw new Error('force must skip replacement confirmation')
      },
      password: async () => 'rotated-config-test-key',
    })
    mockValidation(true)

    const {error, stderr, stdout} = await runCommand(['init', '--force'])

    expect(error).to.equal(undefined)
    expect(await readConfig()).to.deep.equal({apiKey: 'rotated-config-test-key'})
    expect(`${stdout}${stderr}`).not.to.contain('rotated-config-test-key')
    expect(requestCount).to.equal(1)
  })

  it('validates a prompted replacement without saving it when --force and --check are combined', async () => {
    await writeConfig({apiKey: 'existing-check-config-key'})
    setInteractiveTerminal()
    __setInitPrompterForTest({
      async confirm() {
        throw new Error('force must skip replacement confirmation')
      },
      password: async () => 'check-only-replacement-key',
    })
    mockValidation(true)

    const {error, stderr, stdout} = await runCommand(['init', '--force', '--check'])

    expect(error).to.equal(undefined)
    expect(stdout).to.contain('Configuration was not changed.')
    expect(await readConfig()).to.deep.equal({apiKey: 'existing-check-config-key'})
    expect(`${stdout}${stderr}`).not.to.contain('check-only-replacement-key')
  })

  it('saves an environment key when --force requests configuration replacement', async () => {
    await writeConfig({apiKey: 'existing-environment-config-key'})
    process.env[MODELLIX_API_KEY_ENV] = 'replacement-environment-key'
    mockValidation(true)

    const {error, stdout} = await runCommand(['init', '--force', '--json'])

    expect(error).to.equal(undefined)
    expect(parseJson(stdout)).to.include({apiKeySource: 'environment', saved: true})
    expect(await readConfig()).to.deep.equal({apiKey: 'replacement-environment-key'})
    expect(stdout).not.to.contain('replacement-environment-key')
  })

  it('saves and selects an explicitly named profile', async () => {
    mockValidation(true)

    const {error, stdout} = await runCommand([
      'init',
      '--profile',
      'work',
      '--api-key',
      'work-init-test-key',
      '--yes',
      '--json',
    ])
    const report = parseJson(stdout)
    const config = await readConfig()

    expect(error).to.equal(undefined)
    expect(report).to.include({ok: true, profile: 'work', saved: true})
    expect(config?.currentProfile).to.equal('work')
    expect(config?.profiles.work.apiKey).to.equal('work-init-test-key')
    expect(stdout).not.to.contain('work-init-test-key')
  })

  function mockValidation(isValid: boolean): void {
    __setHttpRequesterForTest(async (options) => {
      requestCount += 1
      expect(options.method).to.equal('GET')
      expect(options.path).to.equal('/api/v1/apikey/validate')
      return {
        bodyText: JSON.stringify({code: 0, data: {[isValidProperty]: isValid}, message: 'success'}),
        headers: {},
        statusCode: 200,
      }
    })
  }
})

function getExitCode(error: Error | undefined): number | undefined {
  return (error as (Error & {oclif?: {exit?: number}}) | undefined)?.oclif?.exit
}

function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

function restoreProperty(
  target: NodeJS.ReadStream | NodeJS.WriteStream,
  name: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, name, descriptor)
  } else {
    Reflect.deleteProperty(target, name)
  }
}

function setNonInteractiveTerminal(): void {
  Object.defineProperty(process.stdin, 'isTTY', {configurable: true, value: false})
  Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: false})
}

function setInteractiveTerminal(): void {
  Object.defineProperty(process.stdin, 'isTTY', {configurable: true, value: true})
  Object.defineProperty(process.stdout, 'isTTY', {configurable: true, value: true})
}
