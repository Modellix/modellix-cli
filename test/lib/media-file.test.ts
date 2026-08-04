import {expect} from 'chai'
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {MAX_MEDIA_FILE_BYTES, prepareMediaFile} from '../../src/lib/media-file.js'

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

describe('media file preparation', () => {
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-media-test-'))
  })

  afterEach(async () => {
    await rm(temporaryDirectory, {force: true, recursive: true})
  })

  it('accepts a PNG based on its content and returns an absolute path', async () => {
    const path = join(temporaryDirectory, 'reference.png')
    await writeFile(path, onePixelPng)

    const prepared = await prepareMediaFile(path)
    expect(prepared).to.deep.include({
      filename: 'reference.png',
      mimeType: 'image/png',
      path,
      size: onePixelPng.length,
    })
    expect(prepared.bytes.equals(onePixelPng)).to.equal(true)
  })

  it('rejects unsupported content even when the extension looks like an image', async () => {
    const path = join(temporaryDirectory, 'fake.png')
    await writeFile(path, 'not an image')
    const error = await captureError(() => prepareMediaFile(path))
    expect(error.message).to.match(/unsupported media type/i)
  })

  it('rejects symbolic-link inputs', async function () {
    if (process.platform === 'win32') this.skip()
    const target = join(temporaryDirectory, 'target.png')
    const link = join(temporaryDirectory, 'link.png')
    await writeFile(target, onePixelPng)
    await symlink(target, link)
    const error = await captureError(() => prepareMediaFile(link))
    expect(error.message).to.match(/symbolic link/i)
  })

  it('rejects files larger than the documented 16 MiB limit before reading them', async () => {
    const path = join(temporaryDirectory, 'large.png')
    await writeFile(path, Buffer.alloc(MAX_MEDIA_FILE_BYTES + 1))
    const error = await captureError(() => prepareMediaFile(path))
    expect(error.message).to.contain(`${MAX_MEDIA_FILE_BYTES}-byte`)
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
