const DURATION_PATTERN = /^(\d+)(ms|s|m|h)?$/i

const UNIT_TO_MILLISECONDS = {
  h: 60 * 60 * 1000,
  m: 60 * 1000,
  ms: 1,
  s: 1000,
} as const

type DurationLimits = {
  maxMs?: number
  minMs?: number
}

/**
 * Parse a CLI duration. Bare integers remain backwards-compatible seconds.
 */
export function parseDuration(value: string, label = 'duration'): number {
  return parseDurationMs(value, label)
}

export function parseDurationMs(
  value: string,
  label = 'duration',
  limits: DurationLimits = {},
): number {
  const normalized = value.trim()
  const match = DURATION_PATTERN.exec(normalized)
  if (!match) {
    throw new Error(
      `Invalid ${label} "${value}". Use seconds or a duration such as 500ms, 30s, 5m, or 2h.`,
    )
  }

  const amount = Number(match[1])
  const unit = (match[2]?.toLowerCase() ?? 's') as keyof typeof UNIT_TO_MILLISECONDS
  const milliseconds = amount * UNIT_TO_MILLISECONDS[unit]
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new Error(`${label} must be greater than zero and within the supported range.`)
  }

  if (limits.minMs !== undefined && milliseconds < limits.minMs) {
    throw new Error(`${label} must be at least ${formatDuration(limits.minMs)}.`)
  }

  if (limits.maxMs !== undefined && milliseconds > limits.maxMs) {
    throw new Error(`${label} must not exceed ${formatDuration(limits.maxMs)}.`)
  }

  return milliseconds
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds % UNIT_TO_MILLISECONDS.h === 0) {
    return `${milliseconds / UNIT_TO_MILLISECONDS.h}h`
  }

  if (milliseconds % UNIT_TO_MILLISECONDS.m === 0) {
    return `${milliseconds / UNIT_TO_MILLISECONDS.m}m`
  }

  if (milliseconds % UNIT_TO_MILLISECONDS.s === 0) {
    return `${milliseconds / UNIT_TO_MILLISECONDS.s}s`
  }

  return `${milliseconds}ms`
}
