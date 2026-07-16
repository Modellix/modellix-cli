import type {JsonValue} from './modellix-client.js'

import {parseDuration} from './duration.js'
import {normalizeTaskId} from './safe-text.js'
import {
  extractTaskResources,
  FAILURE_TASK_STATUSES,
  waitForTaskResults,
} from './task.js'

export type ModelTaskWaitResult = {
  failed: boolean
  response: JsonValue
  status: string
}

export function getTaskId(response: JsonValue): string {
  const data = getTaskData(response)
  if (typeof data?.task_id !== 'string') {
    throw new TypeError('Invalid response from Modellix API: expected data.task_id to be a string.')
  }

  try {
    return normalizeTaskId(data.task_id, 'Modellix task ID')
  } catch (error) {
    throw new TypeError(
      `Invalid response from Modellix API: ${error instanceof Error ? error.message : 'task ID is invalid.'}`,
    )
  }
}

export function getTaskResourceUrls(response: JsonValue): string[] {
  return extractTaskResources(response).map((resource) => resource.url)
}

export function parseModelDuration(value: string, label: string, maxMs: number): number {
  const milliseconds = parseDuration(value, label)
  if (milliseconds > maxMs) {
    throw new Error(`${label} exceeds the supported maximum.`)
  }

  return milliseconds
}

export async function waitForModelTask(input: {
  apiKey: string
  intervalMs: number
  taskId: string
  timeoutMs: number
}): Promise<ModelTaskWaitResult> {
  const [result] = await waitForTaskResults({
    apiKey: input.apiKey,
    intervalMs: input.intervalMs,
    taskIds: [input.taskId],
    timeoutMs: input.timeoutMs,
  })
  return {
    failed: FAILURE_TASK_STATUSES.has(result.status),
    response: result.response,
    status: result.status,
  }
}

function getTaskData(response: JsonValue): undefined | {[key: string]: JsonValue} {
  return isRecord(response) && isRecord(response.data) ? response.data : undefined
}

function isRecord(value: JsonValue): value is {[key: string]: JsonValue} {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export {TaskWaitTimeoutError as ModelTaskTimeoutError} from './task.js'
