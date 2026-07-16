import {expect} from 'chai'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  clearTaskHistory,
  getTaskHistoryFilePath,
  readTaskHistory,
  recordTaskHistory,
} from '../../src/lib/history.js'

describe('task history storage', () => {
  let configHome: string

  beforeEach(async () => {
    configHome = await mkdtemp(join(tmpdir(), 'modellix-cli-history-lib-test-'))
  })

  afterEach(async () => {
    await rm(configHome, {force: true, recursive: true})
  })

  it('records only whitelisted metadata and updates an existing task', async () => {
    await recordTaskHistory(
      {
        apiKey: 'must-not-be-saved',
        body: {prompt: 'must-not-be-saved'},
        modelSlug: 'google/nano-banana-2',
        status: 'submitted',
        taskId: 'task-one',
      } as Parameters<typeof recordTaskHistory>[0],
      {configHome, now: new Date('2026-07-16T01:00:00.000Z')},
    )
    await recordTaskHistory(
      {status: 'success', taskId: 'task-one'},
      {configHome, now: new Date('2026-07-16T01:01:00.000Z')},
    )

    const entries = await readTaskHistory({configHome})
    expect(entries).to.deep.equal([
      {
        createdAt: '2026-07-16T01:00:00.000Z',
        modelSlug: 'google/nano-banana-2',
        status: 'success',
        taskId: 'task-one',
        updatedAt: '2026-07-16T01:01:00.000Z',
      },
    ])

    const raw = await readFile(getTaskHistoryFilePath({configHome}), 'utf8')
    expect(raw).not.to.contain('must-not-be-saved')
    expect(raw).not.to.contain('apiKey')
    expect(raw).not.to.contain('prompt')
  })

  it('projects stored entries onto the metadata whitelist', async () => {
    await recordTaskHistory({taskId: 'task-projection'}, {configHome})
    const historyPath = getTaskHistoryFilePath({configHome})
    const stored = JSON.parse(await readFile(historyPath, 'utf8'))
    stored.entries[0].unexpected = {secret: 'must-not-be-returned'}
    await writeFile(historyPath, JSON.stringify(stored), 'utf8')

    const [entry] = await readTaskHistory({configHome})
    expect(entry).not.to.have.property('unexpected')
  })

  it('serializes concurrent writes without losing tasks and keeps newest first', async () => {
    await Promise.all([
      recordTaskHistory({taskId: 'task-a'}, {configHome, now: new Date('2026-07-16T01:00:00Z')}),
      recordTaskHistory({taskId: 'task-b'}, {configHome, now: new Date('2026-07-16T01:01:00Z')}),
    ])

    const entries = await readTaskHistory({configHome})
    expect(entries.map((entry) => entry.taskId)).to.deep.equal(['task-b', 'task-a'])
  })

  it('keeps the same task ID separate across profiles and API origins', async () => {
    await recordTaskHistory(
      {
        baseUrl: 'https://api.modellix.ai',
        profile: 'default',
        status: 'success',
        taskId: 'shared-task',
      },
      {configHome, now: new Date('2026-07-16T01:00:00Z')},
    )
    await recordTaskHistory(
      {
        baseUrl: 'https://gateway.example',
        profile: 'work',
        status: 'failed',
        taskId: 'shared-task',
      },
      {configHome, now: new Date('2026-07-16T01:01:00Z')},
    )

    const entries = await readTaskHistory({configHome})
    expect(entries).to.have.length(2)
    expect(entries.map((entry) => entry.profile)).to.deep.equal(['work', 'default'])
  })

  it('clears the history file idempotently', async () => {
    await recordTaskHistory({taskId: 'task-clear'}, {configHome})
    expect(await clearTaskHistory({configHome})).to.equal(true)
    expect(await clearTaskHistory({configHome})).to.equal(false)
    expect(await readTaskHistory({configHome})).to.deep.equal([])
  })

  it('can clear one profile without removing another profile history', async () => {
    await recordTaskHistory({profile: 'default', taskId: 'task-default'}, {configHome})
    await recordTaskHistory({profile: 'work', taskId: 'task-work'}, {configHome})

    expect(await clearTaskHistory({configHome, profile: 'work'})).to.equal(true)
    expect((await readTaskHistory({configHome})).map((entry) => entry.taskId)).to.deep.equal([
      'task-default',
    ])
  })
})
