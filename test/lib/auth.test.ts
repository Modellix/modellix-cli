import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  findApiKey,
  MODELLIX_API_KEY_ENV,
  MODELLIX_PROFILE_ENV,
  resolveApiKey,
  resolveProfile,
} from '../../src/lib/auth.js'
import {writeConfig} from '../../src/lib/config.js'

describe('API key resolution', () => {
  let originalApiKey: string | undefined
  let originalProfile: string | undefined
  let originalXdgConfigHome: string | undefined
  let temporaryXdgDirectory: string

  beforeEach(async () => {
    originalApiKey = process.env[MODELLIX_API_KEY_ENV]
    originalProfile = process.env[MODELLIX_PROFILE_ENV]
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    temporaryXdgDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-auth-test-'))
    process.env.XDG_CONFIG_HOME = temporaryXdgDirectory
    delete process.env[MODELLIX_API_KEY_ENV]
    delete process.env[MODELLIX_PROFILE_ENV]
  })

  afterEach(async () => {
    restoreEnvironmentVariable(MODELLIX_API_KEY_ENV, originalApiKey)
    restoreEnvironmentVariable(MODELLIX_PROFILE_ENV, originalProfile)
    restoreEnvironmentVariable('XDG_CONFIG_HOME', originalXdgConfigHome)
    await rm(temporaryXdgDirectory, {force: true, recursive: true})
  })

  it('prefers the explicit flag over environment and config keys', async () => {
    process.env[MODELLIX_API_KEY_ENV] = 'environment-test-key'
    await writeConfig({apiKey: 'config-test-key'})

    expect(await findApiKey('  flag-test-key  ')).to.deep.equal({
      apiKey: 'flag-test-key',
      profile: 'default',
      profileSource: 'config',
      source: 'flag',
    })
  })

  it('prefers the environment key over the config key', async () => {
    process.env[MODELLIX_API_KEY_ENV] = '  environment-test-key  '
    await writeConfig({apiKey: 'config-test-key'})

    expect(await findApiKey()).to.deep.equal({
      apiKey: 'environment-test-key',
      profile: 'default',
      profileSource: 'config',
      source: 'environment',
    })
  })

  it('uses the isolated XDG config as the final fallback', async () => {
    await writeConfig({apiKey: 'config-test-key'})

    expect(await findApiKey()).to.deep.equal({
      apiKey: 'config-test-key',
      profile: 'default',
      profileSource: 'config',
      source: 'config',
    })
  })

  it('returns undefined when no key source is configured', async () => {
    expect(await findApiKey()).to.equal(undefined)
  })

  it('resolveApiKey returns the selected key', async () => {
    await writeConfig({apiKey: 'config-test-key'})

    expect(await resolveApiKey()).to.equal('config-test-key')
  })

  it('resolveApiKey rejects when all key sources are missing', async () => {
    const error = await captureError(() => resolveApiKey())
    expect(error.message).to.contain('Missing API key')
  })

  it('selects profiles by flag, then environment, then current profile', async () => {
    await writeConfig({apiKey: 'default-test-key', profile: 'default'})
    await writeConfig({apiKey: 'work-test-key', profile: 'work'})
    process.env[MODELLIX_PROFILE_ENV] = 'default'

    expect(await findApiKey({profile: 'work'})).to.deep.include({
      apiKey: 'work-test-key',
      profile: 'work',
      profileSource: 'flag',
    })
    expect(await findApiKey()).to.deep.include({
      apiKey: 'default-test-key',
      profile: 'default',
      profileSource: 'environment',
    })

    delete process.env[MODELLIX_PROFILE_ENV]
    expect(await resolveProfile()).to.deep.equal({profile: 'work', source: 'config'})
  })

  it('keeps API-key precedence independent from profile selection', async () => {
    await writeConfig({apiKey: 'saved-work-key', profile: 'work'})
    process.env[MODELLIX_PROFILE_ENV] = 'work'
    process.env[MODELLIX_API_KEY_ENV] = 'environment-key'

    expect(await findApiKey({apiKey: 'flag-key'})).to.deep.include({
      apiKey: 'flag-key',
      profile: 'work',
      profileSource: 'environment',
      source: 'flag',
    })
  })
})

async function captureError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation()
  } catch (error) {
    expect(error).to.be.instanceOf(Error)
    return error as Error
  }

  throw new Error('Expected operation to reject')
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
