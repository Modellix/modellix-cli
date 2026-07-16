import type {JsonValue} from './modellix-client.js'

import {normalizeSafeText, sanitizeTerminalText} from './safe-text.js'

export type ModelRecord = {[key: string]: JsonValue} & {slug: string}

type ModelFilters = {
  limit?: number
  provider?: string
  search?: string
  type?: string
}

export function filterModels(models: ModelRecord[], filters: ModelFilters): ModelRecord[] {
  const provider = normalizeFilter(filters.provider)
  const search = normalizeFilter(filters.search)
  const type = normalizeFilter(filters.type)

  const filtered = models.filter((model) => {
    const modelType = typeof model.type === 'string' ? model.type.toLowerCase() : ''
    if (type && modelType !== type) {
      return false
    }

    if (provider && getModelProvider(model)?.toLowerCase() !== provider) {
      return false
    }

    if (!search) {
      return true
    }

    const description = typeof model.description === 'string' ? model.description : ''
    return `${model.slug}\n${description}`.toLowerCase().includes(search)
  })

  return filters.limit === undefined ? filtered : filtered.slice(0, filters.limit)
}

export function formatModelDetails(model: ModelRecord): string {
  const entries: Array<[string, JsonValue]> = [['slug', model.slug]]
  const provider = getModelProvider(model)
  if (provider && model.provider === undefined) {
    entries.push(['provider', provider])
  }

  for (const key of Object.keys(model).sort()) {
    if (key !== 'slug') {
      entries.push([key, model[key]])
    }
  }

  return entries
    .map(([key, value]) => `${sanitizeTerminalText(key, 128)}: ${formatValue(value)}`)
    .join('\n')
}

export function getModelProvider(model: ModelRecord): string | undefined {
  const provider = getStringValue(model.provider)
    ?? getStringValue(model.providerSlug)
    ?? getStringValue(model.provider_slug)
  if (provider) {
    return provider
  }

  const separatorIndex = model.slug.indexOf('/')
  return separatorIndex > 0 ? model.slug.slice(0, separatorIndex) : undefined
}

export function getModels(response: JsonValue): ModelRecord[] {
  if (!isRecord(response) || !Array.isArray(response.models)) {
    throw new Error('Invalid response from Modellix API: expected models to be an array.')
  }

  return response.models.map((model) => {
    if (!isRecord(model) || typeof model.slug !== 'string') {
      throw new Error('Invalid response from Modellix API: every model must include a string slug.')
    }

    try {
      return {...model, slug: normalizeSafeText(model.slug, 'Model slug', 256)}
    } catch (error) {
      throw new Error(
        `Invalid response from Modellix API: ${error instanceof Error ? error.message : 'model slug is invalid.'}`,
      )
    }
  })
}

export function isRecord(value: JsonValue): value is {[key: string]: JsonValue} {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatValue(value: JsonValue): string {
  const formatted = typeof value === 'string' ? value : JSON.stringify(value)
  return sanitizeTerminalText(formatted, 20_000)
}

function getStringValue(value: JsonValue | undefined): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  if (value !== undefined && isRecord(value)) {
    for (const key of ['slug', 'name', 'id']) {
      const nested = value[key]
      if (typeof nested === 'string' && nested.trim()) {
        return nested.trim()
      }
    }
  }
}

function normalizeFilter(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized || undefined
}
