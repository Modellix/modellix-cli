import {expect} from 'chai'
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

import {findApiKey} from '../../src/lib/auth.js'
import {
  CONFIG_SCHEMA_VERSION,
  type ConfigPathOptions,
  getConfigFilePath,
  readConfig,
  removeProfile,
  writeConfig,
} from '../../src/lib/config.js'
import {getCredentialFilePath} from '../../src/lib/credential-store.js'

const productionOrigin = 'https://api.modellix.ai'

describe('config', () => {
  let options: ConfigPathOptions
  let temporaryXdgDirectory: string

  beforeEach(async () => {
    temporaryXdgDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-config-test-'))
    options = {configHome: temporaryXdgDirectory}
  })

  afterEach(async () => {
    await rm(temporaryXdgDirectory, {force: true, recursive: true})
  })

  it('resolves the config file inside the isolated XDG directory', () => {
    expect(getConfigFilePath(options)).to.equal(
      join(temporaryXdgDirectory, 'modellix', 'config.json'),
    )
  })

  it('rejects a relative config home so credentials cannot land in the project', async () => {
    const error = await captureError(async () => getConfigFilePath({configHome: '.'}))
    expect(error.message).to.contain('absolute path')
  })

  it('returns undefined when the config file does not exist', async () => {
    expect(await readConfig(options)).to.equal(undefined)
  })

  it('writes metadata to config and keeps the secret in the explicit credential file', async () => {
    const configPath = await writeConfig({apiKey: 'config-test-key'}, options)

    expect(configPath).to.equal(join(temporaryXdgDirectory, 'modellix', 'config.json'))
    const config = await readConfig(options)
    expect(config?.schemaVersion).to.equal(CONFIG_SCHEMA_VERSION)
    expect(config?.currentProfile).to.equal('default')
    expect(config?.profiles.default.origins[productionOrigin].store).to.equal('file')

    const storedConfig = await readFile(configPath, 'utf8')
    const storedCredentials = await readFile(getCredentialFilePath(options), 'utf8')
    expect(storedConfig).not.to.contain('config-test-key')
    expect(storedCredentials).to.contain('config-test-key')
    expect(await readSavedKey('default')).to.equal('config-test-key')

    if (process.platform !== 'win32') {
      expect((await stat(configPath)).mode.toString(8).slice(-3)).to.equal('600')
      expect((await stat(getCredentialFilePath(options))).mode.toString(8).slice(-3)).to.equal('600')
    }
  })

  it('rejects invalid JSON instead of treating it as a missing config', async () => {
    const configPath = getConfigFilePath(options)
    await mkdir(dirname(configPath), {recursive: true})
    await writeFile(configPath, '{not-json', 'utf8')

    const error = await captureError(() => readConfig(options))
    expect(error.message).to.match(/config|JSON/i)
  })

  it('rejects a legacy config whose apiKey is not a non-empty string', async () => {
    const configPath = getConfigFilePath(options)
    await mkdir(dirname(configPath), {recursive: true})
    await writeFile(configPath, JSON.stringify({apiKey: 42}), 'utf8')

    const error = await captureError(() => readConfig(options))
    expect(error.message).to.match(/apiKey|config/i)
  })

  it('reads the legacy single-key schema without modifying the file or enumerating the key', async () => {
    const configPath = getConfigFilePath(options)
    await mkdir(dirname(configPath), {recursive: true})
    const legacy = JSON.stringify({apiKey: 'legacy-test-key'})
    await writeFile(configPath, legacy, 'utf8')

    const config = await readConfig(options)
    expect(config?.currentProfile).to.equal('default')
    expect(config?.legacyApiKeys).to.deep.equal({default: 'legacy-test-key'})
    expect(JSON.stringify(config)).not.to.contain('legacy-test-key')
    expect(await readFile(configPath, 'utf8')).to.equal(legacy)
  })

  it('preserves multiple profiles and switches the current profile', async () => {
    await writeConfig({apiKey: 'default-test-key', profile: 'default'}, options)
    await writeConfig({apiKey: 'work-test-key', profile: 'work'}, options)

    const config = await readConfig(options)
    expect(config?.currentProfile).to.equal('work')
    expect(Object.keys(config?.profiles ?? {})).to.deep.equal(['default', 'work'])
    expect(await readSavedKey('default')).to.equal('default-test-key')
    expect(await readSavedKey('work')).to.equal('work-test-key')
  })

  it('removes one metadata profile without deleting the remaining profile', async () => {
    await writeConfig({apiKey: 'default-test-key', profile: 'default'}, options)
    await writeConfig({apiKey: 'work-test-key', profile: 'work'}, options)

    const result = await removeProfile('work', options)
    expect(result).to.deep.include({
      currentProfile: 'default',
      remainingProfiles: ['default'],
      removed: true,
    })
    expect(result.origins).to.have.length(1)
    expect(Object.keys((await readConfig(options))?.profiles ?? {})).to.deep.equal(['default'])
  })

  it('rejects profile names that could modify object prototypes', async () => {
    for (const profile of ['__proto__', 'constructor', 'prototype']) {
      // eslint-disable-next-line no-await-in-loop
      const error = await captureError(() => writeConfig({apiKey: 'reserved-key', profile}, options))
      expect(error.message).to.match(/profile|reserved/i)
    }

    expect(await readConfig(options)).to.equal(undefined)
  })

  it('prefers the legacy profile schema when a legacy top-level apiKey is also present', async () => {
    const configPath = getConfigFilePath(options)
    await mkdir(dirname(configPath), {recursive: true})
    await writeFile(
      configPath,
      JSON.stringify({
        apiKey: 'legacy-should-not-win',
        currentProfile: 'work',
        profiles: {work: {apiKey: 'work-schema-key'}},
      }),
      'utf8',
    )

    const config = await readConfig(options)
    expect(config?.legacyApiKeys).to.deep.equal({work: 'work-schema-key'})
    expect(config?.currentProfile).to.equal('work')
  })

  it('requires an explicit recovery option before replacing malformed configuration', async () => {
    const configPath = getConfigFilePath(options)
    await mkdir(dirname(configPath), {recursive: true})
    await writeFile(configPath, '{malformed', 'utf8')

    const error = await captureError(() => writeConfig({apiKey: 'replacement-key'}, options))
    expect(error.message).to.match(/config|JSON/i)

    await writeConfig({apiKey: 'replacement-key', recover: true}, options)
    expect(await readSavedKey('default')).to.equal('replacement-key')
  })

  it('refuses a stale compare-and-swap profile replacement', async () => {
    await writeConfig({apiKey: 'first-key', profile: 'work'}, options)
    await writeConfig({apiKey: 'rotated-key', profile: 'work'}, options)

    const error = await captureError(() =>
      writeConfig(
        {apiKey: 'stale-replacement', expectedApiKey: 'first-key', profile: 'work'},
        options,
      ),
    )
    expect(error.message).to.contain('changed while')
    expect(await readSavedKey('work')).to.equal('rotated-key')
  })

  async function readSavedKey(profile: string): Promise<string | undefined> {
    return (await findApiKey({
      ...options,
      ignoreEnvironment: true,
      origin: productionOrigin,
      profile,
    }))?.apiKey
  }
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
