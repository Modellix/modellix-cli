import {expect} from 'chai'
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

import {
  type ConfigPathOptions,
  getConfigFilePath,
  readConfig,
  removeProfile,
  writeConfig,
} from '../../src/lib/config.js'

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

  it('writes and reads a valid config without using the real home directory', async () => {
    const configPath = await writeConfig({apiKey: 'config-test-key'}, options)

    expect(configPath).to.equal(join(temporaryXdgDirectory, 'modellix', 'config.json'))
    expect(await readConfig(options)).to.deep.equal({apiKey: 'config-test-key'})

    const stored = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
    expect(stored).to.deep.equal({
      currentProfile: 'default',
      profiles: {default: {apiKey: 'config-test-key'}},
    })

    if (process.platform !== 'win32') {
      const fileStat = await stat(configPath)
      expect(fileStat.mode.toString(8).slice(-3)).to.equal('600')
    }
  })

  it('rejects invalid JSON instead of treating it as a missing config', async () => {
    const configPath = getConfigFilePath(options)
    await mkdir(dirname(configPath), {recursive: true})
    await writeFile(configPath, '{not-json', 'utf8')

    const error = await captureError(() => readConfig(options))
    expect(error.message).to.match(/config|JSON/i)
  })

  it('rejects a config whose apiKey is not a non-empty string', async () => {
    const configPath = getConfigFilePath(options)
    await mkdir(dirname(configPath), {recursive: true})
    await writeFile(configPath, JSON.stringify({apiKey: 42}), 'utf8')

    const error = await captureError(() => readConfig(options))
    expect(error.message).to.match(/apiKey|config/i)
  })

  it('reads the legacy single-key schema without modifying the file', async () => {
    const configPath = getConfigFilePath(options)
    await mkdir(dirname(configPath), {recursive: true})
    await writeFile(configPath, JSON.stringify({apiKey: 'legacy-test-key'}), 'utf8')

    const config = await readConfig(options)
    expect(config).to.deep.equal({apiKey: 'legacy-test-key'})
    expect(config?.currentProfile).to.equal('default')
    expect(config?.profiles).to.deep.equal({default: {apiKey: 'legacy-test-key'}})
  })

  it('preserves multiple profiles and switches the current profile', async () => {
    await writeConfig({apiKey: 'default-test-key', profile: 'default'}, options)
    await writeConfig({apiKey: 'work-test-key', profile: 'work'}, options)

    const config = await readConfig(options)
    expect(config?.currentProfile).to.equal('work')
    expect(config?.apiKey).to.equal('work-test-key')
    expect(config?.profiles).to.deep.equal({
      default: {apiKey: 'default-test-key'},
      work: {apiKey: 'work-test-key'},
    })
  })

  it('removes one profile without deleting the remaining profiles', async () => {
    await writeConfig({apiKey: 'default-test-key', profile: 'default'}, options)
    await writeConfig({apiKey: 'work-test-key', profile: 'work'}, options)

    expect(await removeProfile('work', options)).to.deep.equal({
      currentProfile: 'default',
      remainingProfiles: ['default'],
      removed: true,
    })
    expect((await readConfig(options))?.profiles).to.deep.equal({
      default: {apiKey: 'default-test-key'},
    })
  })

  it('rejects profile names that could modify object prototypes', async () => {
    for (const profile of ['__proto__', 'constructor', 'prototype']) {
      // eslint-disable-next-line no-await-in-loop
      const error = await captureError(() => writeConfig({apiKey: 'reserved-key', profile}, options))
      expect(error.message).to.match(/profile|reserved/i)
    }

    expect(await readConfig(options)).to.equal(undefined)
  })

  it('prefers the profile schema when a legacy apiKey is also present', async () => {
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
    expect(config?.apiKey).to.equal('work-schema-key')
    expect(config?.currentProfile).to.equal('work')
  })

  it('requires an explicit recovery option before replacing malformed configuration', async () => {
    const configPath = getConfigFilePath(options)
    await mkdir(dirname(configPath), {recursive: true})
    await writeFile(configPath, '{malformed', 'utf8')

    const error = await captureError(() => writeConfig({apiKey: 'replacement-key'}, options))
    expect(error.message).to.match(/config|JSON/i)

    await writeConfig({apiKey: 'replacement-key', recover: true}, options)
    expect((await readConfig(options))?.apiKey).to.equal('replacement-key')
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
    expect((await readConfig(options))?.profiles.work.apiKey).to.equal('rotated-key')
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
