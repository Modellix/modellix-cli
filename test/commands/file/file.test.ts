import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeConfig} from '../../../src/lib/config.js'
import {__setHttpRequesterForTest} from '../../../src/lib/modellix-client.js'

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const createdAtProperty = 'created_at'
const fileIdProperty = 'file_id'

describe('file commands', () => {
  let originalXdgConfigHome: string | undefined
  let temporaryDirectory: string

  beforeEach(async () => {
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-file-command-test-'))
    process.env.XDG_CONFIG_HOME = temporaryDirectory
    await writeConfig({apiKey: 'file-command-secret-key'})
  })

  afterEach(async () => {
    __setHttpRequesterForTest()
    restoreEnvironmentVariable('XDG_CONFIG_HOME', originalXdgConfigHome)
    await rm(temporaryDirectory, {force: true, recursive: true})
  })

  it('uploads a local image and emits stable secret-free JSON', async () => {
    const imagePath = join(temporaryDirectory, 'reference.png')
    await writeFile(imagePath, onePixelPng)
    __setHttpRequesterForTest(async (options) => {
      expect(options.method).to.equal('POST')
      expect(options.path).to.equal('/api/v1/media/files')
      expect(options.apiKey).to.equal('file-command-secret-key')
      return {
        bodyText: JSON.stringify({
          data: {
            [createdAtProperty]: '2026-08-03T00:00:00Z',
            [fileIdProperty]: 'file-command-123',
            filename: 'reference.png',
            size: onePixelPng.length,
            type: 'image/png',
            url: 'https://cdn.modellix.ai/file-command-123.png',
          },
        }),
        headers: {},
        statusCode: 200,
      }
    })

    const {error, stderr, stdout} = await runCommand(['file', 'upload', imagePath, '--json'])
    expect(error).to.equal(undefined)
    expect(JSON.parse(stdout)).to.deep.include({ok: true})
    expect(JSON.parse(stdout).file).to.deep.include({
      fileId: 'file-command-123',
      url: 'https://cdn.modellix.ai/file-command-123.png',
    })
    expect(`${stdout}${stderr}`).not.to.contain('file-command-secret-key')
  })

  it('deletes an uploaded file and emits stable JSON', async () => {
    __setHttpRequesterForTest(async (options) => {
      expect(options.method).to.equal('DELETE')
      expect(options.path).to.equal('/api/v1/media/files/file-command-123')
      return {bodyText: '', headers: {}, statusCode: 204}
    })

    const {error, stdout} = await runCommand([
      'file',
      'delete',
      '  file-command-123  ',
      '--json',
    ])
    expect(error).to.equal(undefined)
    expect(JSON.parse(stdout)).to.deep.equal({
      deleted: true,
      fileId: 'file-command-123',
      ok: true,
    })
  })
})

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
