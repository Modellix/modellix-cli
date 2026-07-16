import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {MODELLIX_API_KEY_ENV} from '../../src/lib/auth.js'
import {__setHttpRequesterForTest} from '../../src/lib/modellix-client.js'

const isValidProperty = 'is_valid'

describe('doctor', () => {
  let originalApiKey: string | undefined
  let originalXdgConfigHome: string | undefined
  let requestedPaths: string[]
  let temporaryXdgDirectory: string

  beforeEach(async () => {
    originalApiKey = process.env[MODELLIX_API_KEY_ENV]
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    temporaryXdgDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-doctor-test-'))
    process.env.XDG_CONFIG_HOME = temporaryXdgDirectory
    delete process.env[MODELLIX_API_KEY_ENV]
    requestedPaths = []
  })

  afterEach(async () => {
    __setHttpRequesterForTest()
    restoreEnvironmentVariable(MODELLIX_API_KEY_ENV, originalApiKey)
    restoreEnvironmentVariable('XDG_CONFIG_HOME', originalXdgConfigHome)
    await rm(temporaryXdgDirectory, {force: true, recursive: true})
  })

  it('reports valid authentication and balance as JSON', async () => {
    process.env[MODELLIX_API_KEY_ENV] = 'doctor-valid-test-key'
    mockDoctorResponses(true, 42.125)

    const {error, stderr, stdout} = await runCommand(['doctor', '--json'])
    const report = parseJson(stdout)
    const checks = report.checks as Array<Record<string, unknown>>

    expect(error).to.equal(undefined)
    expect(report).to.include({apiKeySource: 'environment', ok: true})
    expect(checks.find((check) => check.name === 'balance')).to.deep.include({
      detail: '$42.1250 USD',
      ok: true,
    })
    expect(requestedPaths).to.deep.equal([
      '/api/v1/apikey/validate',
      '/api/v1/team/balance',
    ])
    expect(`${stdout}${stderr}`).not.to.contain('doctor-valid-test-key')
  })

  it('returns a non-zero JSON report without making a request when the key is missing', async () => {
    __setHttpRequesterForTest(async () => {
      throw new Error('doctor must not make a request without a key')
    })

    const {error, stdout} = await runCommand(['doctor', '--json'])
    const report = parseJson(stdout)

    expect(getExitCode(error)).to.equal(1)
    expect(report).to.include({apiKeySource: 'missing', ok: false})
    expect(report.checks).to.be.an('array').that.is.not.empty
  })

  it('reports an invalid key and skips the balance request', async () => {
    process.env[MODELLIX_API_KEY_ENV] = 'doctor-invalid-test-key'
    mockDoctorResponses(false, 999)

    const {error, stderr, stdout} = await runCommand(['doctor', '--json'])
    const report = parseJson(stdout)
    const checks = report.checks as Array<Record<string, unknown>>

    expect(getExitCode(error)).to.equal(1)
    expect(report).to.include({apiKeySource: 'environment', ok: false})
    expect(checks.find((check) => check.name === 'validation')).to.deep.include({ok: false})
    expect(requestedPaths).to.deep.equal(['/api/v1/apikey/validate'])
    expect(`${stdout}${stderr}${error?.message ?? ''}`).not.to.contain(
      'doctor-invalid-test-key',
    )
  })

  function mockDoctorResponses(isValid: boolean, balance: number): void {
    __setHttpRequesterForTest(async (options) => {
      requestedPaths.push(options.path)
      expect(options.method).to.equal('GET')

      if (options.path === '/api/v1/apikey/validate') {
        return {
          bodyText: JSON.stringify({
            code: 0,
            data: {[isValidProperty]: isValid},
            message: 'success',
          }),
          headers: {},
          statusCode: 200,
        }
      }

      if (options.path === '/api/v1/team/balance') {
        return {
          bodyText: JSON.stringify({code: 0, data: {balance}, message: 'success'}),
          headers: {},
          statusCode: 200,
        }
      }

      throw new Error(`Unexpected test request: ${options.path}`)
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
