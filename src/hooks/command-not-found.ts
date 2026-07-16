import {type Hook, toConfiguredId} from '@oclif/core'

import {sanitizeTerminalText} from '../lib/safe-text.js'

const hook: Hook.CommandNotFound = async function (options) {
  const safeId = sanitizeTerminalText(options.id, 256)
  const hiddenCommandIds = new Set(
    options.config.commands.filter((command) => command.hidden).map((command) => command.id),
  )
  const commandIds = [
    ...options.config.commandIDs,
    ...options.config.commands.flatMap((command) => command.aliases),
  ].filter((commandId) => !hiddenCommandIds.has(commandId))
  const suggestion = closestCommand(safeId, commandIds)
  this.warn(`${toConfiguredId(safeId, options.config)} is not a ${options.config.bin} command.`)
  if (suggestion) {
    this.warn(`Did you mean ${toConfiguredId(suggestion, options.config)}?`)
  }

  const topic = options.config.findTopic(safeId.split(':')[0])
  const helpCommand = topic
    ? `${options.config.bin} help ${toConfiguredId(topic.name, options.config)}`
    : `${options.config.bin} help`
  this.error(`Run ${helpCommand} for a list of available commands.`, {exit: 127})
}

export default hook

function closestCommand(target: string, commandIds: string[]): string | undefined {
  const closest = commandIds
    .map((commandId) => ({commandId, distance: editDistance(target, commandId)}))
    .sort((left, right) => left.distance - right.distance)[0]?.commandId
  if (!closest) return
  const distance = editDistance(target, closest)
  const maximumUsefulDistance = Math.max(2, Math.floor(target.length * 0.4))
  return distance <= maximumUsefulDistance ? closest : undefined
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({length: right.length + 1}, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      )
    }

    previous = current
  }

  return previous[right.length]
}
