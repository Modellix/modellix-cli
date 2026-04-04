import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('model types', () => {
  it('prints all model types in plain text', async () => {
    const {error, stdout} = await runCommand(['model', 'types'])

    expect(error).to.equal(undefined)
    expect(stdout).to.contain('text-to-image')
    expect(stdout).to.contain('text-to-video')
    expect(stdout).to.contain('image-to-image')
    expect(stdout).to.contain('image-to-video')
    expect(stdout).to.contain('video-to-video')
  })

  it('prints model types as JSON with --json', async () => {
    const {error, stdout} = await runCommand(['model', 'types', '--json'])

    expect(error).to.equal(undefined)
    const parsed = JSON.parse(stdout) as string[]
    expect(parsed).to.deep.equal([
      'text-to-image',
      'text-to-video',
      'image-to-image',
      'image-to-video',
      'video-to-video',
    ])
  })
})
