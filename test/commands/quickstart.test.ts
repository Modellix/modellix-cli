import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

import {MODELLIX_API_KEY_ENV} from '../../src/lib/auth.js'
import {getConfigFilePath} from '../../src/lib/config.js'
import {__setHttpRequesterForTest} from '../../src/lib/modellix-client.js'

describe('quickstart', () => {
  let originalApiKey: string | undefined
  let originalProfile: string | undefined
  let originalXdgConfigHome: string | undefined
  let requestCount = 0
  let temporaryXdgDirectory: string

  beforeEach(async () => {
    originalApiKey = process.env[MODELLIX_API_KEY_ENV]
    originalProfile = process.env.MODELLIX_PROFILE
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    temporaryXdgDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-quickstart-test-'))
    process.env.XDG_CONFIG_HOME = temporaryXdgDirectory
    delete process.env[MODELLIX_API_KEY_ENV]
    delete process.env.MODELLIX_PROFILE
    requestCount = 0
    __setHttpRequesterForTest(async () => {
      requestCount += 1
      throw new Error('quickstart must not make network requests')
    })
  })

  afterEach(async () => {
    __setHttpRequesterForTest()
    restoreEnvironmentVariable(MODELLIX_API_KEY_ENV, originalApiKey)
    restoreEnvironmentVariable('MODELLIX_PROFILE', originalProfile)
    restoreEnvironmentVariable('XDG_CONFIG_HOME', originalXdgConfigHome)
    await rm(temporaryXdgDirectory, {force: true, recursive: true})
  })

  it('exits successfully with setup guidance when no key exists', async () => {
    const {error, stdout} = await runCommand(['quickstart', '--json'])
    const report = parseJson(stdout)

    expect(error).to.equal(undefined)
    expect(report).to.include({apiKeySource: 'missing', configured: false, ok: true})
    expect(report.nextSteps).to.be.an('array').that.includes('modellix-cli init')
    expect(report).to.include({docs: 'https://docs.modellix.ai/ways-to-use/cli'})
    expect(JSON.stringify(report.nextSteps)).to.contain('https://www.modellix.ai/console/api-key')
    expect(requestCount).to.equal(0)
  })

  it('exits successfully and reports an environment key without exposing it', async () => {
    process.env[MODELLIX_API_KEY_ENV] = 'quickstart-environment-test-key'

    const {error, stderr, stdout} = await runCommand(['quickstart', '--json'])
    const report = parseJson(stdout)

    expect(error).to.equal(undefined)
    expect(report).to.include({apiKeySource: 'environment', configured: true, ok: true})
    expect(JSON.stringify(report.nextSteps)).to.contain('modellix-cli task get <task_id>')
    expect(`${stdout}${stderr}`).not.to.contain('quickstart-environment-test-key')
    expect(requestCount).to.equal(0)
  })

  it('exits successfully with a warning when the saved config is malformed', async () => {
    const configPath = getConfigFilePath()
    await mkdir(dirname(configPath), {recursive: true})
    await writeFile(configPath, '{invalid-json', 'utf8')

    const {error, stdout} = await runCommand(['quickstart', '--json'])
    const report = parseJson(stdout)

    expect(error).to.equal(undefined)
    expect(report).to.include({apiKeySource: 'missing', configured: false, ok: true})
    expect(report.configurationWarning).to.be.a('string').that.matches(/config|JSON/i)
    expect(requestCount).to.equal(0)
  })

  it('reports an environment-selected profile as environment sourced', async () => {
    const configPath = getConfigFilePath()
    await mkdir(dirname(configPath), {recursive: true})
    await writeFile(
      configPath,
      JSON.stringify({
        currentProfile: 'default',
        profiles: {
          default: {apiKey: 'default-quickstart-key'},
          work: {apiKey: 'work-quickstart-key'},
        },
      }),
      'utf8',
    )
    process.env.MODELLIX_PROFILE = 'work'

    const {error, stdout} = await runCommand(['quickstart', '--json'])
    const report = parseJson(stdout)

    expect(error).to.equal(undefined)
    expect(report).to.include({profile: 'work', profileSource: 'environment'})
    expect(stdout).not.to.contain('work-quickstart-key')
  })

  it('prints the standard help and CLI documentation footer in human output', async () => {
    const {error, stdout} = await runCommand(['quickstart'])

    expect(error).to.equal(undefined)
    expect(stdout).to.contain('Help: modellix-cli --help')
    expect(stdout).to.contain('Docs: https://docs.modellix.ai/ways-to-use/cli')
  })
})

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
