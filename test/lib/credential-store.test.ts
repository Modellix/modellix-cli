import {expect} from 'chai'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

import {
  findApiKey,
  migrateLegacyCredentials,
  removeSavedProfile,
  saveApiKey,
} from '../../src/lib/auth.js'
import {getConfigFilePath, readConfig} from '../../src/lib/config.js'
import {
  __setKeyringLoaderForTest,
  createCredentialReference,
  CredentialStoreUnavailableError,
} from '../../src/lib/credential-store.js'

describe('credential storage', () => {
  let keyring: Map<string, string>
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-credential-test-'))
    keyring = new Map()
    installMemoryKeyring(keyring)
  })

  afterEach(async () => {
    __setKeyringLoaderForTest()
    await rm(temporaryDirectory, {force: true, recursive: true})
  })

  it('isolates credential references by API origin and profile', () => {
    const defaultProduction = createCredentialReference('https://api.modellix.ai', 'default')
    expect(createCredentialReference('https://api.modellix.ai/', 'default')).to.equal(defaultProduction)
    expect(createCredentialReference('https://api.modellix.ai', 'work')).not.to.equal(defaultProduction)
    expect(createCredentialReference('https://api.staging.example', 'default')).not.to.equal(defaultProduction)
  })

  it('stores a key in the OS backend while config contains metadata only', async () => {
    await saveApiKey({
      apiKey: 'keychain-secret-key',
      configHome: temporaryDirectory,
      store: 'keychain',
    })

    expect(keyring.size).to.equal(1)
    expect(await findApiKey({configHome: temporaryDirectory, ignoreEnvironment: true})).to.deep.include({
      apiKey: 'keychain-secret-key',
      source: 'keychain',
    })
    expect(await readFile(getConfigFilePath({configHome: temporaryDirectory}), 'utf8')).not.to.contain(
      'keychain-secret-key',
    )

    const removal = await removeSavedProfile('default', {configHome: temporaryDirectory})
    expect(removal.removed).to.equal(true)
    expect(keyring.size).to.equal(0)
  })

  it('restores earlier credentials when a later profile credential cannot be deleted', async () => {
    await saveApiKey({
      apiKey: 'production-secret-key',
      configHome: temporaryDirectory,
      origin: 'https://api.modellix.ai',
      store: 'keychain',
    })
    await saveApiKey({
      apiKey: 'staging-secret-key',
      configHome: temporaryDirectory,
      origin: 'https://api.staging.example',
      store: 'keychain',
    })
    installMemoryKeyring(keyring, {failDeleteAt: 2})

    const error = await captureError(() => removeSavedProfile('default', {
      configHome: temporaryDirectory,
    }))
    expect(error.message).to.match(/credential store is unavailable/iu)
    const configuredOrigins = Object.keys(
      (await readConfig({configHome: temporaryDirectory}))?.profiles.default.origins ?? {},
    )
    expect(configuredOrigins)
      .to.have.length(2)
    expect(await findApiKey({
      configHome: temporaryDirectory,
      ignoreEnvironment: true,
      origin: 'https://api.modellix.ai',
    })).to.deep.include({apiKey: 'production-secret-key'})
    expect(await findApiKey({
      configHome: temporaryDirectory,
      ignoreEnvironment: true,
      origin: 'https://api.staging.example',
    })).to.deep.include({apiKey: 'staging-secret-key'})
  })

  it('rolls back a store change when the previous credential cannot be removed', async () => {
    await saveApiKey({
      apiKey: 'original-keychain-secret',
      configHome: temporaryDirectory,
      store: 'keychain',
    })
    installMemoryKeyring(keyring, {failDeleteAt: 1})

    const error = await captureError(() => saveApiKey({
      apiKey: 'replacement-file-secret',
      configHome: temporaryDirectory,
      expectedApiKey: 'original-keychain-secret',
      store: 'file',
    }))
    expect(error.message).to.match(/credential store is unavailable/iu)
    expect(await findApiKey({
      configHome: temporaryDirectory,
      ignoreEnvironment: true,
    })).to.deep.include({
      apiKey: 'original-keychain-secret',
      source: 'keychain',
    })
    expect(await readFile(getConfigFilePath({configHome: temporaryDirectory}), 'utf8'))
      .not.to.contain('replacement-file-secret')
  })

  it('requires an explicit file fallback when the OS backend is unavailable', async () => {
    __setKeyringLoaderForTest(async () => {
      throw new Error('platform keychain unavailable')
    })

    const error = await captureError(() => saveApiKey({
      apiKey: 'unavailable-keychain-secret',
      configHome: temporaryDirectory,
      store: 'keychain',
    }))
    expect(error).to.be.instanceOf(CredentialStoreUnavailableError)
    expect(error.message).to.match(/--store file|credential store/i)

    await saveApiKey({
      apiKey: 'explicit-file-secret',
      configHome: temporaryDirectory,
      store: 'file',
    })
    expect(await findApiKey({configHome: temporaryDirectory, ignoreEnvironment: true})).to.deep.include({
      apiKey: 'explicit-file-secret',
      source: 'file',
    })
  })

  it('atomically migrates every legacy plaintext profile to metadata and a selected backend', async () => {
    const configPath = getConfigFilePath({configHome: temporaryDirectory})
    await mkdir(dirname(configPath), {recursive: true})
    await writeFile(configPath, JSON.stringify({
      currentProfile: 'work',
      profiles: {
        default: {apiKey: 'legacy-default-secret'},
        work: {apiKey: 'legacy-work-secret'},
      },
    }))

    const result = await migrateLegacyCredentials({configHome: temporaryDirectory, to: 'file'})
    expect(result).to.deep.include({migrated: true, profiles: ['default', 'work'], store: 'file'})
    const rawConfig = await readFile(configPath, 'utf8')
    expect(rawConfig).not.to.match(/legacy-default-secret|legacy-work-secret/u)
    expect((await readConfig({configHome: temporaryDirectory}))?.schemaVersion).to.equal(2)
    expect(await findApiKey({
      configHome: temporaryDirectory,
      ignoreEnvironment: true,
      profile: 'work',
    })).to.deep.include({apiKey: 'legacy-work-secret', source: 'file'})
  })

  it('reports a failed migration rollback instead of hiding leftover credentials', async () => {
    const configPath = getConfigFilePath({configHome: temporaryDirectory})
    await mkdir(dirname(configPath), {recursive: true})
    await writeFile(configPath, JSON.stringify({
      currentProfile: 'work',
      profiles: {
        default: {apiKey: 'legacy-default-secret'},
        work: {apiKey: 'legacy-work-secret'},
      },
    }))
    installMemoryKeyring(keyring, {failDeleteAt: 1, failSetAt: 2})

    const error = await captureError(() => migrateLegacyCredentials({
      configHome: temporaryDirectory,
      to: 'keychain',
    }))
    expect(error).to.be.instanceOf(AggregateError)
    expect(error.message).to.match(/restoring the previous credential state also failed/iu)
    expect(await readFile(configPath, 'utf8')).to.contain('legacy-default-secret')
  })
})

function installMemoryKeyring(
  values: Map<string, string>,
  options: {failDeleteAt?: number; failSetAt?: number} = {},
): void {
  let deleteCount = 0
  let setCount = 0
  class FakeAsyncEntry {
    constructor(_service: string, private readonly username: string) {}

    async deleteCredential(): Promise<boolean> {
      deleteCount += 1
      if (deleteCount === options.failDeleteAt) throw new Error('keychain delete failed')
      return values.delete(this.username)
    }

    async getPassword(): Promise<string | undefined> {
      return values.get(this.username)
    }

    async setPassword(password: string): Promise<void> {
      setCount += 1
      if (setCount === options.failSetAt) throw new Error('keychain write failed')
      values.set(this.username, password)
    }
  }

  __setKeyringLoaderForTest(async () => ({
    AsyncEntry: FakeAsyncEntry,
  }) as unknown as typeof import('@napi-rs/keyring'))
}

async function captureError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation()
  } catch (error) {
    expect(error).to.be.instanceOf(Error)
    return error as Error
  }

  throw new Error('Expected operation to reject')
}
