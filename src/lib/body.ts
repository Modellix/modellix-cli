import {readFile} from 'node:fs/promises'

import type {JsonValue} from './modellix-client.js'

type ParseModelInvokeBodyInput = {
  bodyFile?: string
  bodyText?: string
}

export async function parseModelInvokeBody(input: ParseModelInvokeBodyInput): Promise<JsonValue> {
  const hasText = Boolean(input.bodyText?.trim())
  const hasFile = Boolean(input.bodyFile?.trim())

  if (!hasText && !hasFile) {
    throw new Error('Missing request body. Provide --body or --body-file.')
  }

  if (hasText && hasFile) {
    throw new Error('Use either --body or --body-file, not both.')
  }

  if (hasText) {
    return parseJson(input.bodyText!, '--body')
  }

  const filePath = input.bodyFile!.trim()
  let fileContent: string
  try {
    fileContent = await readFile(filePath, 'utf8')
  } catch {
    throw new Error(`Unable to read --body-file at path: ${filePath}`)
  }

  return parseJson(fileContent, '--body-file')
}

function parseJson(raw: string, sourceLabel: '--body' | '--body-file'): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue
  } catch {
    throw new Error(`Invalid JSON from ${sourceLabel}.`)
  }
}
