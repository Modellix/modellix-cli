import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
  __setHttpRequesterForTest,
  __setRetryDelayForTest,
} from '../../../src/lib/modellix-client.js'

const taskIdProperty = 'task_id'

describe('task wait', () => {
  let originalApiKey: string | undefined
  let originalXdgConfigHome: string | undefined
  let temporaryXdgDirectory: string

  beforeEach(async () => {
    originalApiKey = process.env.MODELLIX_API_KEY
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    temporaryXdgDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-wait-test-'))
    process.env.XDG_CONFIG_HOME = temporaryXdgDirectory
    process.env.MODELLIX_API_KEY = 'wait-test-key'
    __setRetryDelayForTest(async () => {})
  })

  afterEach(async () => {
    __setHttpRequesterForTest()
    __setRetryDelayForTest()
    restoreEnvironmentVariable('MODELLIX_API_KEY', originalApiKey)
    restoreEnvironmentVariable('XDG_CONFIG_HOME', originalXdgConfigHome)
    await rm(temporaryXdgDirectory, {force: true, recursive: true})
  })

  it('polls until the task succeeds and prints only the terminal response', async () => {
    let requestCount = 0
    __setHttpRequesterForTest(async (options) => {
      requestCount += 1
      expect(options.path).to.equal('/api/v1/tasks/task-wait')
      const status = requestCount === 1 ? 'pending' : 'success'
      return {
        bodyText: JSON.stringify({
          code: 0,
          data: {status, [taskIdProperty]: 'task-wait'},
          message: 'success',
        }),
        headers: {},
        statusCode: 200,
      }
    })

    const {error, stdout} = await runCommand([
      'task',
      'wait',
      'task-wait',
      '--interval',
      '10ms',
      '--timeout',
      '5',
    ])

    expect(error).to.equal(undefined)
    expect(requestCount).to.equal(2)
    expect(JSON.parse(stdout)).to.deep.include({
      data: {status: 'success', [taskIdProperty]: 'task-wait'},
    })
  })

  it('prints a failed terminal response and exits non-zero', async () => {
    __setHttpRequesterForTest(async () => ({
      bodyText: '{"code":0,"data":{"status":"failed","task_id":"task-failed"},"message":"success"}',
      headers: {},
      statusCode: 200,
    }))

    const {error, stdout} = await runCommand(['task', 'wait', 'task-failed'])

    expect(getExitCode(error)).to.equal(1)
    expect(JSON.parse(stdout)).to.deep.include({
      data: {status: 'failed', [taskIdProperty]: 'task-failed'},
    })
  })

  it('waits for multiple tasks concurrently and preserves input order in JSON', async () => {
    const requestCounts = new Map<string, number>()
    __setHttpRequesterForTest(async (options) => {
      const taskId = options.path.split('/').at(-1) as string
      const count = (requestCounts.get(taskId) ?? 0) + 1
      requestCounts.set(taskId, count)
      const status = taskId === 'task-a' || count > 1 ? 'success' : 'running'
      return {
        bodyText: JSON.stringify({code: 0, data: {status, [taskIdProperty]: taskId}}),
        headers: {},
        statusCode: 200,
      }
    })

    const {error, stdout} = await runCommand([
      'task',
      'wait',
      'task-b',
      'task-a',
      '--interval',
      '10ms',
      '--timeout',
      '2s',
    ])

    expect(error).to.equal(undefined)
    expect(requestCounts.get('task-a')).to.equal(1)
    expect(requestCounts.get('task-b')).to.equal(2)
    const output = JSON.parse(stdout) as {tasks: Array<{taskId: string}>}
    expect(output.tasks.map((task) => task.taskId)).to.deep.equal(['task-b', 'task-a'])
  })

  it('waits for every task and exits one when any terminal task fails', async () => {
    __setHttpRequesterForTest(async (options) => ({
      bodyText: JSON.stringify({
        code: 0,
        data: {
          status: options.path.endsWith('task-failed') ? 'failed' : 'completed',
          [taskIdProperty]: options.path.split('/').at(-1),
        },
      }),
      headers: {},
      statusCode: 200,
    }))

    const {error, stdout} = await runCommand([
      'task',
      'wait',
      'task-ok',
      'task-failed',
      '--timeout',
      '30s',
    ])

    expect(getExitCode(error)).to.equal(1)
    expect((JSON.parse(stdout) as {tasks: unknown[]}).tasks).to.have.length(2)
  })

  it('uses exit code 124 when the overall duration expires', async () => {
    __setHttpRequesterForTest(async () => ({
      bodyText: '{"code":0,"data":{"status":"running","task_id":"task-slow"}}',
      headers: {},
      statusCode: 200,
    }))

    const {error, stdout} = await runCommand([
      'task',
      'wait',
      'task-slow',
      '--interval',
      '1ms',
      '--timeout',
      '1ms',
    ])

    expect(getExitCode(error)).to.equal(124)
    const output = JSON.parse(stdout)
    expect(output.error.message).to.contain('Timed out after 1ms')
    expect(output).to.deep.include({ok: false, unfinishedTaskIds: ['task-slow']})
  })

  it('does not start queued polling requests after the overall deadline', async () => {
    const requestTimeouts: number[] = []
    __setHttpRequesterForTest(async (options) => {
      requestTimeouts.push(options.timeoutMs)
      await new Promise((resolve) => {
        setTimeout(resolve, 30)
      })
      const taskId = options.path.split('/').at(-1)
      return {
        bodyText: JSON.stringify({code: 0, data: {status: 'running', [taskIdProperty]: taskId}}),
        headers: {},
        statusCode: 200,
      }
    })

    const {error} = await runCommand([
      'task',
      'wait',
      'task-one',
      'task-two',
      'task-three',
      '--concurrency',
      '1',
      '--interval',
      '1ms',
      '--timeout',
      '40ms',
    ])

    expect(getExitCode(error)).to.equal(124)
    expect(requestTimeouts.length).to.be.greaterThan(0).and.lessThan(3)
    if (requestTimeouts.length === 2) {
      expect(requestTimeouts[1]).to.be.lessThan(requestTimeouts[0])
    }
  })

  it('preserves completed tasks in the JSON timeout result', async () => {
    __setHttpRequesterForTest(async (options) => {
      const taskId = options.path.split('/').at(-1)
      return {
        bodyText: JSON.stringify({
          data: {
            status: taskId === 'task-complete' ? 'success' : 'running',
            [taskIdProperty]: taskId,
          },
        }),
        headers: {},
        statusCode: 200,
      }
    })

    const {error, stdout} = await runCommand([
      'task',
      'wait',
      'task-complete',
      'task-running',
      '--interval',
      '1ms',
      '--timeout',
      '10ms',
      '--json',
    ])
    const output = JSON.parse(stdout)

    expect(getExitCode(error)).to.equal(124)
    expect(output).to.deep.include({ok: false, unfinishedTaskIds: ['task-running']})
    expect(output.completed[0]).to.include({status: 'success', taskId: 'task-complete'})
  })

  it('preserves a terminal response when a queued request reaches the deadline', async () => {
    __setHttpRequesterForTest(async (options) => {
      const taskId = options.path.split('/').at(-1)
      await new Promise((resolve) => {
        setTimeout(resolve, 25)
      })
      return {
        bodyText: JSON.stringify({data: {status: 'success', [taskIdProperty]: taskId}}),
        headers: {},
        statusCode: 200,
      }
    })

    const {error, stdout} = await runCommand([
      'task',
      'wait',
      'task-fast-terminal',
      'task-never-started',
      '--concurrency',
      '1',
      '--timeout',
      '20ms',
    ])
    const output = JSON.parse(stdout)

    expect(getExitCode(error)).to.equal(124)
    expect(output.completed).to.have.length(1)
    expect(output.completed[0]).to.include({taskId: 'task-fast-terminal'})
    expect(output.unfinishedTaskIds).to.deep.equal(['task-never-started'])
  })

  it('stops queued polling work after the first request error', async () => {
    let requests = 0
    __setHttpRequesterForTest(async (options) => {
      requests += 1
      const taskId = options.path.split('/').at(-1)
      if (taskId === 'task-error') {
        return {bodyText: '{"message":"missing"}', headers: {}, statusCode: 404}
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 20)
      })
      return {
        bodyText: JSON.stringify({data: {status: 'running', [taskIdProperty]: taskId}}),
        headers: {},
        statusCode: 200,
      }
    })

    const {error} = await runCommand([
      'task',
      'wait',
      'task-error',
      'task-in-flight',
      'task-queued-one',
      'task-queued-two',
      '--concurrency',
      '2',
    ])

    expect(error?.message).to.contain('404 Not Found')
    expect(requests).to.equal(2)
  })

  it('uses the overall wait timeout to recover after exhausted transient GET retries', async () => {
    let requests = 0
    __setHttpRequesterForTest(async () => {
      requests += 1
      if (requests <= 3) {
        return {bodyText: '{"message":"temporary"}', headers: {}, statusCode: 503}
      }

      return {
        bodyText: '{"data":{"status":"success","task_id":"task-transient"}}',
        headers: {},
        statusCode: 200,
      }
    })

    const {error, stdout} = await runCommand([
      'task',
      'wait',
      'task-transient',
      '--interval',
      '1ms',
      '--timeout',
      '1s',
    ])

    expect(error).to.equal(undefined)
    expect(JSON.parse(stdout).data.status).to.equal('success')
    expect(requests).to.equal(4)
  })

  it('rejects timer values above the safe polling limits before requesting', async () => {
    let requests = 0
    __setHttpRequesterForTest(async () => {
      requests += 1
      throw new Error('must not request with unsafe timers')
    })

    const interval = await runCommand([
      'task',
      'wait',
      'task-limit',
      '--interval',
      '2h',
    ])
    const timeout = await runCommand([
      'task',
      'wait',
      'task-limit',
      '--timeout',
      '169h',
    ])

    expect(interval.error?.message).to.match(/polling interval.*1h/i)
    expect(timeout.error?.message).to.match(/timeout.*168h/i)
    expect(requests).to.equal(0)
  })

  it('rejects missing, blank, and mismatched response task IDs', async () => {
    const cases = [
      {data: {status: 'success'}, message: 'task_id'},
      {data: {status: 'success', [taskIdProperty]: '   '}, message: 'task_id'},
      {data: {status: 'success', [taskIdProperty]: 'other-task'}, message: 'different task ID'},
    ]

    for (const testCase of cases) {
      __setHttpRequesterForTest(async () => ({
        bodyText: JSON.stringify(testCase),
        headers: {},
        statusCode: 200,
      }))
      // eslint-disable-next-line no-await-in-loop
      const {error} = await runCommand(['task', 'wait', 'expected-task'])
      expect(error?.message).to.contain(testCase.message)
    }
  })
})

function getExitCode(error: Error | undefined): number | undefined {
  return (error as (Error & {oclif?: {exit?: number}}) | undefined)?.oclif?.exit
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
