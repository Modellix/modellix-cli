import {expect} from 'chai'

// This JavaScript module is also used by the published entry point.
import {configureRuntime} from '../../bin/runtime.js'

describe('CLI runtime option preprocessing', () => {
  it('ignores every runtime option after the -- separator', () => {
    const original = {
      baseUrl: process.env.MODELLIX_BASE_URL,
      debug: process.env.MODELLIX_CLI_HTTP_DEBUG,
      profile: process.env.MODELLIX_PROFILE,
    }
    process.env.MODELLIX_BASE_URL = 'https://safe.example'
    process.env.MODELLIX_PROFILE = 'safe-profile'
    delete process.env.MODELLIX_CLI_HTTP_DEBUG

    try {
      configureRuntime([
        'task',
        'get',
        '--',
        '--base-url=https://evil.example',
        '--profile',
        'evil-profile',
        '--debug',
      ])
      expect(process.env.MODELLIX_BASE_URL).to.equal('https://safe.example')
      expect(process.env.MODELLIX_PROFILE).to.equal('safe-profile')
      expect(process.env.MODELLIX_CLI_HTTP_DEBUG).to.equal(undefined)
    } finally {
      restore('MODELLIX_BASE_URL', original.baseUrl)
      restore('MODELLIX_CLI_HTTP_DEBUG', original.debug)
      restore('MODELLIX_PROFILE', original.profile)
    }
  })
})

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
