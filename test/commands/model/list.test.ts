import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeConfig} from '../../../src/lib/config.js'
import {__setHttpRequesterForTest} from '../../../src/lib/modellix-client.js'

const docsUrlProperty = 'docs_url'

describe('model list', () => {
  let originalApiKey: string | undefined
  let originalBaseUrl: string | undefined
  let originalProfile: string | undefined
  let originalXdgConfigHome: string | undefined
  let temporaryXdgDirectory: string

  beforeEach(async () => {
    originalApiKey = process.env.MODELLIX_API_KEY
    originalBaseUrl = process.env.MODELLIX_BASE_URL
    originalProfile = process.env.MODELLIX_PROFILE
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    temporaryXdgDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-list-test-'))
    process.env.XDG_CONFIG_HOME = temporaryXdgDirectory
    delete process.env.MODELLIX_API_KEY
    delete process.env.MODELLIX_BASE_URL
    delete process.env.MODELLIX_PROFILE
  })

  afterEach(async () => {
    __setHttpRequesterForTest()
    restoreEnvironmentVariable('MODELLIX_API_KEY', originalApiKey)
    restoreEnvironmentVariable('MODELLIX_BASE_URL', originalBaseUrl)
    restoreEnvironmentVariable('MODELLIX_PROFILE', originalProfile)
    restoreEnvironmentVariable('XDG_CONFIG_HOME', originalXdgConfigHome)
    await rm(temporaryXdgDirectory, {force: true, recursive: true})
  })

  it('lists models with the saved configuration key', async () => {
    await writeConfig({apiKey: 'config-list-key'})
    let requestOptions: undefined | {apiKey: string; method: string; path: string}
    __setHttpRequesterForTest(async (options) => {
      requestOptions = options
      return {
        bodyText: JSON.stringify({
          models: [{
            description: 'test',
            [docsUrlProperty]: 'https://docs.modellix.ai/google/nano-banana-2',
            price: {fixed: 0.0001, unit: '$/img'},
            slug: 'google/nano-banana-2',
            type: 'text-to-image',
          }],
        }),
        headers: {},
        statusCode: 200,
      }
    })

    const {error, stdout} = await runCommand(['model', 'list'])

    expect(error).to.equal(undefined)
    expect(requestOptions).to.deep.include({
      apiKey: 'config-list-key',
      method: 'GET',
      path: '/api/v1/models',
    })
    expect(stdout).to.contain('"slug": "google/nano-banana-2"')
    expect(stdout).to.contain('"fixed": 0.0001')
  })

  it('requests featured models and formats fixed and ranged prices for humans', async () => {
    process.env.MODELLIX_API_KEY = 'featured-list-key'
    let receivedPath = ''
    __setHttpRequesterForTest(async (options) => {
      receivedPath = options.path
      return {
        bodyText: JSON.stringify({
          models: [
            {
              price: {max: 0.0005, min: 0.0001, unit: '$/img'},
              slug: 'google/nano-banana-2',
              type: 'text-to-image',
            },
            {
              price: {fixed: 0.0001, unit: '$/img'},
              slug: 'google/nano-banana-2-edit',
              type: 'image-to-image',
            },
          ],
        }),
        headers: {},
        statusCode: 200,
      }
    })

    const {error, stdout} = await runCommand([
      'model',
      'list',
      '--featured',
      '--output',
      'human',
    ])

    expect(error).to.equal(undefined)
    expect(receivedPath).to.equal('/api/v1/models?featured=true')
    expect(stdout).to.contain('price: 0.0001-0.0005 $/img')
    expect(stdout).to.contain('price: 0.0001 $/img')
  })

  it('fails before requesting models when the key is missing', async () => {
    __setHttpRequesterForTest(async () => {
      throw new Error('requester should not be called')
    })

    const {error} = await runCommand(['model', 'list'])
    expect(error?.message).to.contain('Missing API key')
  })

  it('filters models and emits one slug per line for scripts', async () => {
    process.env.MODELLIX_API_KEY = 'list-filter-key'
    __setHttpRequesterForTest(async () => ({
      bodyText: JSON.stringify({
        models: [
          {description: 'Fast image generation', slug: 'google/nano-banana-2', type: 'text-to-image'},
          {description: 'Video generation', slug: 'alibaba/wan2.5-t2v', type: 'text-to-video'},
          {description: 'Another image model', slug: 'other/image-model', type: 'text-to-image'},
        ],
      }),
      headers: {},
      statusCode: 200,
    }))

    const {error, stdout} = await runCommand([
      'model',
      'list',
      '--type',
      'text-to-image',
      '--search',
      'banana',
      '--output',
      'slugs',
    ])

    expect(error).to.equal(undefined)
    expect(stdout.trim()).to.equal('google/nano-banana-2')
  })

  it('filters provider fields and slug prefixes before applying a limit', async () => {
    process.env.MODELLIX_API_KEY = 'list-provider-key'
    __setHttpRequesterForTest(async () => ({
      bodyText: JSON.stringify({
        models: [
          {provider: 'google', slug: 'custom/model-one', type: 'text-to-image'},
          {slug: 'google/model-two', type: 'text-to-image'},
          {slug: 'google/model-three', type: 'text-to-video'},
          {slug: 'other/model-four', type: 'text-to-image'},
        ],
      }),
      headers: {},
      statusCode: 200,
    }))

    const {error, stdout} = await runCommand([
      'model',
      'list',
      '--provider',
      'GOOGLE',
      '--limit',
      '2',
      '--quiet',
      '--json',
    ])

    expect(error).to.equal(undefined)
    expect(stdout.trim().split(/\r?\n/)).to.deep.equal(['custom/model-one', 'google/model-two'])
  })

  it('requires limit to be a strictly positive integer', async () => {
    process.env.MODELLIX_API_KEY = 'list-limit-key'
    const zeroResult = await runCommand(['model', 'list', '--limit', '0'])
    const decimalResult = await runCommand(['model', 'list', '--limit', '1.5'])
    expect(zeroResult.error?.message).to.contain('Expected an integer greater than or equal to 1')
    expect(decimalResult.error?.message).to.contain('Expected an integer')
  })

  it('applies a named profile and custom local API origin to the request', async () => {
    await writeConfig({apiKey: 'default-profile-key', profile: 'default'})
    await writeConfig({
      apiKey: 'work-profile-key',
      origin: 'http://127.0.0.1:8787',
      profile: 'work',
      setCurrent: false,
    })
    let receivedBaseUrl = ''
    let receivedKey = ''
    __setHttpRequesterForTest(async (options) => {
      receivedBaseUrl = options.baseUrl
      receivedKey = options.apiKey
      return {bodyText: '{"models":[]}', headers: {}, statusCode: 200}
    })

    const {error, stdout} = await runCommand([
      'model',
      'list',
      '--profile',
      'work',
      '--base-url',
      'http://127.0.0.1:8787',
      '--output',
      'quiet',
    ])

    expect(error).to.equal(undefined)
    expect(stdout).to.equal('')
    expect(receivedKey).to.equal('work-profile-key')
    expect(receivedBaseUrl).to.equal('http://127.0.0.1:8787')
    expect(process.env.MODELLIX_BASE_URL).to.equal(undefined)
  })
})

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
