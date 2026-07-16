import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {readTaskHistory, recordTaskHistory} from '../../../src/lib/history.js'

describe('task history command', () => {
  let originalXdgConfigHome: string | undefined
  let temporaryXdgDirectory: string

  beforeEach(async () => {
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    temporaryXdgDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-history-command-test-'))
    process.env.XDG_CONFIG_HOME = temporaryXdgDirectory
  })

  afterEach(async () => {
    restoreEnvironmentVariable('XDG_CONFIG_HOME', originalXdgConfigHome)
    await rm(temporaryXdgDirectory, {force: true, recursive: true})
  })

  it('limits JSON output while reporting the full total', async () => {
    await recordTaskHistory(
      {modelSlug: 'provider/first', taskId: 'task-first'},
      {now: new Date('2026-07-16T01:00:00Z')},
    )
    await recordTaskHistory(
      {modelSlug: 'provider/second', taskId: 'task-second'},
      {now: new Date('2026-07-16T01:01:00Z')},
    )

    const {error, stdout} = await runCommand(['task', 'history', '--limit', '1', '--json'])

    expect(error).to.equal(undefined)
    const result = JSON.parse(stdout) as {entries: Array<{taskId: string}>; total: number}
    expect(result.total).to.equal(2)
    expect(result.entries.map((entry) => entry.taskId)).to.deep.equal(['task-second'])
  })

  it('prints only task IDs in quiet mode', async () => {
    await recordTaskHistory({taskId: 'task-quiet'})

    const {error, stdout} = await runCommand(['task', 'history', '--quiet'])

    expect(error).to.equal(undefined)
    expect(stdout.trim()).to.equal('task-quiet')
  })

  it('clears history with explicit confirmation', async () => {
    await recordTaskHistory({taskId: 'task-clear'})

    const {error, stdout} = await runCommand(['task', 'history', '--clear', '--yes', '--json'])

    expect(error).to.equal(undefined)
    expect(JSON.parse(stdout)).to.include({cleared: true, ok: true})
    expect(await readTaskHistory()).to.deep.equal([])
  })

  it('requires --yes when clearing in a non-interactive session', async () => {
    await recordTaskHistory({taskId: 'task-preserved'})

    const {error} = await runCommand(['task', 'history', '--clear'])

    expect(error?.message).to.contain('Pass --yes')
    expect(await readTaskHistory()).to.have.length(1)
  })
})

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
