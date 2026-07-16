import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

import {getConfigFilePath, readConfig, writeConfig} from '../../../src/lib/config.js'

describe('config commands', () => {
  let originalApiKey: string | undefined
  let originalProfile: string | undefined
  let originalXdgConfigHome: string | undefined
  let temporaryXdgDirectory: string

  beforeEach(async () => {
    originalApiKey = process.env.MODELLIX_API_KEY
    originalProfile = process.env.MODELLIX_PROFILE
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    temporaryXdgDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-config-command-test-'))
    process.env.XDG_CONFIG_HOME = temporaryXdgDirectory
    delete process.env.MODELLIX_API_KEY
    delete process.env.MODELLIX_PROFILE
  })

  afterEach(async () => {
    restoreEnvironmentVariable('MODELLIX_API_KEY', originalApiKey)
    restoreEnvironmentVariable('MODELLIX_PROFILE', originalProfile)
    restoreEnvironmentVariable('XDG_CONFIG_HOME', originalXdgConfigHome)
    await rm(temporaryXdgDirectory, {force: true, recursive: true})
  })

  it('prints the isolated configuration path as JSON', async () => {
    const {error, stdout} = await runCommand(['config', 'path', '--json'])

    expect(error).to.equal(undefined)
    expect(JSON.parse(stdout)).to.deep.include({
      configPath: getConfigFilePath(),
      profile: 'default',
      profiles: [],
      profileSource: 'default',
    })
  })

  it('shows the active source without revealing the key', async () => {
    await writeConfig({apiKey: 'config-show-secret-test-key'})

    const {error, stderr, stdout} = await runCommand(['config', 'show', '--json'])

    expect(error).to.equal(undefined)
    expect(JSON.parse(stdout)).to.deep.include({
      apiKeySource: 'config',
      configured: true,
      ok: true,
      profile: 'default',
      profiles: ['default'],
    })
    expect(`${stdout}${stderr}`).not.to.contain('config-show-secret-test-key')
  })

  it('keeps a valid environment key active when the saved config is malformed', async () => {
    const configPath = getConfigFilePath()
    await mkdir(dirname(configPath), {recursive: true})
    await writeFile(configPath, '{malformed', 'utf8')
    process.env.MODELLIX_API_KEY = 'environment-recovery-secret'

    const {error, stderr, stdout} = await runCommand(['config', 'show', '--json'])
    const output = JSON.parse(stdout)

    expect(error).to.equal(undefined)
    expect(output).to.deep.include({apiKeySource: 'environment', configured: true, ok: true})
    expect(output.warning).to.match(/config|JSON/i)
    expect(`${stdout}${stderr}`).not.to.contain('environment-recovery-secret')
  })

  it('clears only the saved key and leaves the environment key active', async () => {
    await writeConfig({apiKey: 'saved-clear-test-key'})
    process.env.MODELLIX_API_KEY = 'environment-clear-test-key'

    const {error, stderr, stdout} = await runCommand(['config', 'clear', '--yes', '--json'])

    expect(error).to.equal(undefined)
    expect(JSON.parse(stdout)).to.deep.include({
      activeApiKeySource: 'environment',
      ok: true,
      removed: true,
    })
    expect(await readConfig()).to.equal(undefined)
    expect(`${stdout}${stderr}`).not.to.contain('environment-clear-test-key')
  })

  it('does not clear configuration without confirmation in a non-interactive session', async () => {
    await writeConfig({apiKey: 'saved-preserve-test-key'})

    const {error, stdout} = await runCommand(['config', 'clear', '--json'])

    expect(getExitCode(error)).to.equal(1)
    expect(JSON.parse(stdout)).to.deep.include({ok: false})
    expect(await readConfig()).to.deep.equal({apiKey: 'saved-preserve-test-key'})
  })

  it('shows and clears only the selected profile', async () => {
    await writeConfig({apiKey: 'default-profile-secret', profile: 'default'})
    await writeConfig({apiKey: 'work-profile-secret', profile: 'work'})

    const shown = await runCommand(['config', 'show', '--profile', 'default', '--json'])
    expect(shown.error).to.equal(undefined)
    expect(JSON.parse(shown.stdout)).to.deep.include({
      configured: true,
      profile: 'default',
      profiles: ['default', 'work'],
      profileSource: 'flag',
    })

    const cleared = await runCommand([
      'config',
      'clear',
      '--profile',
      'default',
      '--yes',
      '--json',
    ])
    expect(cleared.error).to.equal(undefined)
    expect(JSON.parse(cleared.stdout)).to.deep.include({
      currentProfile: 'work',
      profile: 'default',
      profiles: ['work'],
      removed: true,
    })
    expect((await readConfig())?.profiles).to.deep.equal({
      work: {apiKey: 'work-profile-secret'},
    })
    expect(`${shown.stdout}${shown.stderr}${cleared.stdout}${cleared.stderr}`).not.to.match(
      /default-profile-secret|work-profile-secret/,
    )
  })
})

function getExitCode(error: Error | undefined): number | undefined {
  return (error as (Error & {oclif?: {exit?: number}}) | undefined)?.oclif?.exit
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
