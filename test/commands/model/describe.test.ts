import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {__setHttpRequesterForTest} from '../../../src/lib/modellix-client.js'

const docsUrlProperty = 'docs_url'

describe('model describe', () => {
  let originalApiKey: string | undefined
  let originalXdgConfigHome: string | undefined
  let temporaryDirectory: string

  beforeEach(async () => {
    originalApiKey = process.env.MODELLIX_API_KEY
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'modellix-describe-test-'))
    process.env.XDG_CONFIG_HOME = temporaryDirectory
    process.env.MODELLIX_API_KEY = 'describe-key'
    __setHttpRequesterForTest(async () => ({
      bodyText: JSON.stringify({
        models: [
          {
            description: 'Image generation model',
            [docsUrlProperty]: 'https://docs.modellix.ai/google/nano-banana-2',
            slug: 'google/nano-banana-2',
            type: 'text-to-image',
          },
        ],
      }),
      headers: {},
      statusCode: 200,
    }))
  })

  afterEach(async () => {
    __setHttpRequesterForTest()
    restoreEnvironmentVariable('MODELLIX_API_KEY', originalApiKey)
    restoreEnvironmentVariable('XDG_CONFIG_HOME', originalXdgConfigHome)
    await rm(temporaryDirectory, {force: true, recursive: true})
  })

  it('shows readable model details by default', async () => {
    const {error, stdout} = await runCommand(['model', 'describe', 'google/nano-banana-2'])
    expect(error).to.equal(undefined)
    expect(stdout).to.contain('slug: google/nano-banana-2')
    expect(stdout).to.contain('type: text-to-image')
  })

  it('supports stable JSON and quiet output', async () => {
    const jsonResult = await runCommand([
      'model',
      'describe',
      'GOOGLE/NANO-BANANA-2',
      '--output',
      'json',
    ])
    const quietResult = await runCommand([
      'model',
      'describe',
      'google/nano-banana-2',
      '--quiet',
    ])

    expect(jsonResult.error).to.equal(undefined)
    expect(JSON.parse(jsonResult.stdout)).to.deep.include({slug: 'google/nano-banana-2'})
    expect(quietResult.stdout.trim()).to.equal('google/nano-banana-2')
  })

  it('returns a non-zero error for an unknown slug', async () => {
    const {error} = await runCommand(['model', 'describe', 'google/missing'])
    expect(error?.message).to.contain('Model not found')
    expect(error?.oclif?.exit).to.equal(2)
  })
})

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
