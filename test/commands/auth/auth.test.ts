import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {MODELLIX_API_KEY_ENV, MODELLIX_PROFILE_ENV} from '../../../src/lib/auth.js'
import {readConfig, writeConfig} from '../../../src/lib/config.js'
import {__setHttpRequesterForTest} from '../../../src/lib/modellix-client.js'

const isValidProperty = 'is_valid'

describe('auth commands', () => {
  let originalApiKey: string | undefined
  let originalProfile: string | undefined
  let originalXdgConfigHome: string | undefined
  let temporaryXdgDirectory: string

  beforeEach(async () => {
    originalApiKey = process.env[MODELLIX_API_KEY_ENV]
    originalProfile = process.env[MODELLIX_PROFILE_ENV]
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    temporaryXdgDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-auth-command-test-'))
    process.env.XDG_CONFIG_HOME = temporaryXdgDirectory
    delete process.env[MODELLIX_API_KEY_ENV]
    delete process.env[MODELLIX_PROFILE_ENV]
    mockValidAuthentication()
  })

  afterEach(async () => {
    __setHttpRequesterForTest()
    restoreEnvironmentVariable(MODELLIX_API_KEY_ENV, originalApiKey)
    restoreEnvironmentVariable(MODELLIX_PROFILE_ENV, originalProfile)
    restoreEnvironmentVariable('XDG_CONFIG_HOME', originalXdgConfigHome)
    await rm(temporaryXdgDirectory, {force: true, recursive: true})
  })

  it('logs in to a named profile without revealing the API key', async () => {
    const {error, stderr, stdout} = await runCommand([
      'auth',
      'login',
      '--profile',
      'work',
      '--api-key',
      'auth-login-secret-key',
      '--yes',
      '--json',
    ])

    expect(error).to.equal(undefined)
    expect(JSON.parse(stdout)).to.deep.include({
      apiKeySource: 'flag',
      ok: true,
      profile: 'work',
      saved: true,
      valid: true,
    })
    const config = await readConfig()
    expect(config?.currentProfile).to.equal('work')
    expect(config?.profiles.work.apiKey).to.equal('auth-login-secret-key')
    expect(`${stdout}${stderr}`).not.to.contain('auth-login-secret-key')
  })

  it('preserves other profiles when logging in', async () => {
    await writeConfig({apiKey: 'default-secret-key', profile: 'default'})

    const {error} = await runCommand([
      'auth',
      'login',
      '--profile',
      'work',
      '--api-key',
      'work-secret-key',
      '--yes',
      '--json',
    ])

    expect(error).to.equal(undefined)
    expect((await readConfig())?.profiles).to.deep.equal({
      default: {apiKey: 'default-secret-key'},
      work: {apiKey: 'work-secret-key'},
    })
  })

  it('refuses to replace a profile without confirmation', async () => {
    await writeConfig({apiKey: 'original-secret-key', profile: 'work'})

    const {error, stdout} = await runCommand([
      'auth',
      'login',
      '--profile',
      'work',
      '--api-key',
      'replacement-secret-key',
      '--json',
    ])

    expect(getExitCode(error)).to.equal(1)
    expect(JSON.parse(stdout)).to.deep.include({ok: false})
    expect((await readConfig())?.profiles.work.apiKey).to.equal('original-secret-key')
    expect(stdout).not.to.match(/original-secret-key|replacement-secret-key/)
  })

  it('checks a key without saving it', async () => {
    const {error, stdout} = await runCommand([
      'auth',
      'login',
      '--profile',
      'temporary',
      '--api-key',
      'check-only-secret-key',
      '--check',
      '--json',
    ])

    expect(error).to.equal(undefined)
    expect(JSON.parse(stdout)).to.deep.include({ok: true, saved: false, valid: true})
    expect(await readConfig()).to.equal(undefined)
    expect(stdout).not.to.contain('check-only-secret-key')
  })

  it('reports profile, source, validation, and balance without revealing the key', async () => {
    await writeConfig({apiKey: 'status-secret-key', profile: 'work'})

    const {error, stderr, stdout} = await runCommand([
      'auth',
      'status',
      '--profile',
      'work',
      '--json',
    ])

    expect(error).to.equal(undefined)
    expect(JSON.parse(stdout)).to.deep.include({
      apiKeySource: 'config',
      authenticated: true,
      balance: 12.5,
      ok: true,
      profile: 'work',
      profileSource: 'flag',
      valid: true,
    })
    expect(`${stdout}${stderr}`).not.to.contain('status-secret-key')
  })

  it('supports auth whoami as a status command', async () => {
    await writeConfig({apiKey: 'whoami-secret-key'})

    const {error, stdout} = await runCommand(['auth', 'whoami', '--json'])

    expect(error).to.equal(undefined)
    expect(JSON.parse(stdout)).to.deep.include({authenticated: true, ok: true, valid: true})
    expect(stdout).not.to.contain('whoami-secret-key')
  })

  it('logs out only the selected saved profile while an environment key stays active', async () => {
    await writeConfig({apiKey: 'default-secret-key', profile: 'default'})
    await writeConfig({apiKey: 'work-secret-key', profile: 'work'})
    process.env[MODELLIX_API_KEY_ENV] = 'environment-secret-key'

    const {error, stderr, stdout} = await runCommand([
      'auth',
      'logout',
      '--profile',
      'work',
      '--yes',
      '--json',
    ])

    expect(error).to.equal(undefined)
    expect(JSON.parse(stdout)).to.deep.include({
      activeApiKeySource: 'environment',
      currentProfile: 'default',
      ok: true,
      profile: 'work',
      profiles: ['default'],
      removed: true,
    })
    expect((await readConfig())?.profiles).to.deep.equal({
      default: {apiKey: 'default-secret-key'},
    })
    expect(`${stdout}${stderr}`).not.to.match(
      /default-secret-key|work-secret-key|environment-secret-key/,
    )
  })

})

function getExitCode(error: Error | undefined): number | undefined {
  return (error as (Error & {oclif?: {exit?: number}}) | undefined)?.oclif?.exit
}

function mockValidAuthentication(): void {
  __setHttpRequesterForTest(async (options) => {
    if (options.path === '/api/v1/apikey/validate') {
      return {
        bodyText: JSON.stringify({data: {[isValidProperty]: true}}),
        headers: {},
        statusCode: 200,
      }
    }

    if (options.path === '/api/v1/team/balance') {
      return {
        bodyText: JSON.stringify({data: {balance: 12.5}}),
        headers: {},
        statusCode: 200,
      }
    }

    throw new Error(`Unexpected path: ${options.path}`)
  })
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
