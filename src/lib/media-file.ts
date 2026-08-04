import {lstat, open} from 'node:fs/promises'
import {basename, resolve} from 'node:path'

import {normalizeSafeText} from './safe-text.js'

export const MAX_MEDIA_FILE_BYTES = 16 * 1024 * 1024

export type PreparedMediaFile = {
  bytes: Buffer
  filename: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  path: string
  size: number
}

export async function prepareMediaFile(rawPath: string): Promise<PreparedMediaFile> {
  const normalizedPath = resolve(normalizeSafeText(rawPath, 'Media file path', 32_767))
  let pathStats: Awaited<ReturnType<typeof lstat>>
  try {
    pathStats = await lstat(normalizedPath)
  } catch (error) {
    throw new Error(`Unable to inspect media file at ${normalizedPath}.`, {cause: error})
  }

  if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
    throw new Error('Media upload input must be a regular file, not a symbolic link.')
  }

  if (pathStats.size <= 0) throw new Error('Media upload input must not be empty.')
  if (pathStats.size > MAX_MEDIA_FILE_BYTES) {
    throw new Error(`Media upload input exceeds the ${MAX_MEDIA_FILE_BYTES}-byte limit.`)
  }

  const handle = await open(normalizedPath, 'r')
  let bytes: Buffer
  try {
    const openedStats = await handle.stat()
    if (
      !openedStats.isFile()
      || openedStats.size !== pathStats.size
      || openedStats.dev !== pathStats.dev
      || openedStats.ino !== pathStats.ino
    ) {
      throw new Error('Media upload input changed while it was being opened.')
    }

    bytes = await handle.readFile()
  } finally {
    await handle.close()
  }

  if (bytes.length !== pathStats.size) {
    throw new Error('Media upload input changed while it was being read.')
  }

  const mimeType = detectImageMimeType(bytes)
  const filename = sanitizeFilename(basename(normalizedPath), mimeType)
  return {bytes, filename, mimeType, path: normalizedPath, size: bytes.length}
}

function detectImageMimeType(bytes: Buffer): PreparedMediaFile['mimeType'] {
  if (
    bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
  ) {
    return 'image/png'
  }

  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg'
  }

  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }

  throw new Error('Unsupported media type. Modellix accepts PNG, JPEG, and WebP reference files.')
}

function sanitizeFilename(rawFilename: string, mimeType: PreparedMediaFile['mimeType']): string {
  const fallbackExtension = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg'
  const cleaned = rawFilename
    .normalize('NFC')
    .replaceAll(/["\\\r\n]/gu, '_')
    .trim()
    .slice(0, 180)
  return cleaned || `upload${fallbackExtension}`
}
