export const MODELLIX_API_KEY_ENV = 'MODELLIX_API_KEY'

export function resolveApiKey(flagApiKey?: string): string {
  const key = flagApiKey?.trim() || process.env[MODELLIX_API_KEY_ENV]?.trim()
  if (!key) {
    throw new Error(
      `Missing API key. Provide --api-key or set ${MODELLIX_API_KEY_ENV} in your environment.`,
    )
  }

  return key
}
