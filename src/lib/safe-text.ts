// Terminal control and bidirectional override characters are never valid identifiers.
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028-\u202E\u2066-\u2069]/u
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT_GLOBAL = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028-\u202E\u2066-\u2069]/gu
// Preserve ordinary layout characters while rendering all other terminal controls visibly.
// eslint-disable-next-line no-control-regex
const TERMINAL_ESCAPE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028-\u202E\u2066-\u2069]/gu

export function normalizeSafeText(value: string, label: string, maxLength = 512): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} must not be empty.`)
  if (normalized.length > maxLength) {
    throw new Error(`${label} exceeds the ${maxLength}-character limit.`)
  }

  if (UNSAFE_TEXT.test(normalized)) {
    throw new Error(`${label} contains unsafe control characters.`)
  }

  return normalized
}

export function normalizeApiKey(value: string, label = 'Modellix API key'): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} must not be empty.`)
  if (normalized.length > 16_384) throw new Error(`${label} is too long.`)
  for (const character of normalized) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint < 33 || codePoint > 126) {
      throw new Error(`${label} contains unsupported characters.`)
    }
  }

  return normalized
}

export function normalizeTaskId(value: string, label = 'Task ID'): string {
  const normalized = normalizeSafeText(value, label, 512)
  if (!/^[A-Za-z0-9._~:/+@=-]+$/u.test(normalized)) {
    throw new Error(`${label} contains unsupported characters.`)
  }

  return normalized
}

export function isSafeStoredText(value: string, maxLength = 512): boolean {
  const normalized = value.trim()
  return Boolean(normalized) && normalized.length <= maxLength && !UNSAFE_TEXT.test(normalized)
}

export function escapeTerminalControls(value: string): string {
  return value.replaceAll(TERMINAL_ESCAPE, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return `\\u${codePoint.toString(16).padStart(4, '0')}`
  })
}

export function sanitizeTerminalText(value: string, maxLength = 2000): string {
  return value.slice(0, maxLength).replaceAll(UNSAFE_TEXT_GLOBAL, ' ')
}
