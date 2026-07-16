import type {Command} from '@oclif/core'

import {
  recordTaskHistory,
  recordTaskHistoryBatch,
  type RecordTaskHistoryInput,
} from './history.js'

export async function recordTaskHistorySafely(
  command: Command,
  input: RecordTaskHistoryInput,
): Promise<void> {
  try {
    await recordTaskHistory(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown history error.'
    command.warn(`Task ${input.taskId} is available, but local history could not be updated: ${message}`)
  }
}

export async function recordTaskHistoryBatchSafely(
  command: Command,
  inputs: RecordTaskHistoryInput[],
): Promise<void> {
  try {
    await recordTaskHistoryBatch(inputs)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown history error.'
    command.warn(`Task results are available, but local history could not be updated: ${message}`)
  }
}
