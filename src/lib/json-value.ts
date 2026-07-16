import type {JsonValue} from './modellix-client.js'

export const DEFAULT_JSON_MAX_DEPTH = 100
export const DEFAULT_JSON_MAX_NODES = 250_000

type JsonValidationOptions = {
  maxDepth?: number
  maxNodes?: number
}

/** Validate JSON semantics without recursion so hostile nesting cannot overflow the stack. */
export function assertJsonValue(
  value: unknown,
  label = 'JSON value',
  options: JsonValidationOptions = {},
): asserts value is JsonValue {
  const maxDepth = options.maxDepth ?? DEFAULT_JSON_MAX_DEPTH
  const maxNodes = options.maxNodes ?? DEFAULT_JSON_MAX_NODES
  const stack: Array<{depth: number; value: unknown}> = [{depth: 0, value}]
  const seenContainers = new WeakSet<object>()
  let nodeCount = 0

  while (stack.length > 0) {
    const current = stack.pop()!
    nodeCount += 1
    if (nodeCount > maxNodes) {
      throw new Error(`${label} exceeds the ${maxNodes}-node limit.`)
    }

    const {depth} = current
    const currentValue = current.value
    if (
      currentValue === null
      || typeof currentValue === 'boolean'
      || typeof currentValue === 'string'
    ) {
      continue
    }

    if (typeof currentValue === 'number') {
      if (!Number.isFinite(currentValue)) {
        throw new TypeError(`${label} contains a non-finite number.`)
      }

      continue
    }

    if (typeof currentValue !== 'object') {
      throw new TypeError(`${label} contains a value that JSON cannot represent.`)
    }

    if (seenContainers.has(currentValue)) {
      throw new TypeError(`${label} contains a circular or repeated object reference.`)
    }

    seenContainers.add(currentValue)
    const children = Array.isArray(currentValue)
      ? currentValue
      : Object.values(currentValue as Record<string, unknown>)
    if (children.length > 0 && depth >= maxDepth) {
      throw new Error(`${label} exceeds the maximum nesting depth of ${maxDepth}.`)
    }

    for (const child of children) {
      stack.push({depth: depth + 1, value: child})
    }
  }
}
