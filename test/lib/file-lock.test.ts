import {expect} from 'chai'
import {access, mkdir, mkdtemp, rm, utimes} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {withFileLock} from '../../src/lib/file-lock.js'

describe('cross-process file lock', () => {
  let directory: string
  let targetPath: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'modellix-file-lock-test-'))
    targetPath = join(directory, 'state.json')
  })

  afterEach(async () => {
    await rm(directory, {force: true, recursive: true})
  })

  it('does not allow a second operation to enter before the owner releases', async () => {
    let allowFirstToFinish: (() => void) | undefined
    let secondEntered = false
    const first = withFileLock(targetPath, async () => {
      await new Promise<void>((resolve) => {
        allowFirstToFinish = resolve
      })
    })
    await waitFor(() => Boolean(allowFirstToFinish))

    const second = withFileLock(targetPath, async () => {
      secondEntered = true
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
    expect(secondEntered).to.equal(false)

    allowFirstToFinish!()
    await Promise.all([first, second])
    expect(secondEntered).to.equal(true)
  })

  it('recovers an expired lock and releases after operation errors', async () => {
    const lockPath = `${targetPath}.lock`
    await mkdir(lockPath)
    const staleTime = new Date(Date.now() - 60_000)
    await utimes(lockPath, staleTime, staleTime)

    await withFileLock(targetPath, async () => {})
    await expectMissing(lockPath)

    try {
      await withFileLock(targetPath, async () => {
        throw new Error('operation failed')
      })
      expect.fail('Expected operation to reject')
    } catch (error) {
      expect((error as Error).message).to.equal('operation failed')
    }

    await withFileLock(targetPath, async () => {})
    await expectMissing(lockPath)
  })
})

async function expectMissing(path: string): Promise<void> {
  try {
    await access(path)
    expect.fail('Expected path to be absent')
  } catch {}
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 5)
    })
  }

  throw new Error('Timed out waiting for test condition.')
}
