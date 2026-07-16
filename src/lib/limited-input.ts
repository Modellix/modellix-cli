import {createReadStream} from 'node:fs'

export class InputFileSizeLimitError extends Error {
  constructor(label: string, maxBytes: number) {
    super(`${label} exceeds the ${maxBytes}-byte limit.`)
    this.name = 'InputFileSizeLimitError'
  }
}

export async function readUtf8FileLimited(
  filePath: string,
  maxBytes: number,
  label: string,
): Promise<string> {
  const stream = createReadStream(filePath)
  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    totalBytes += buffer.length
    if (totalBytes > maxBytes) {
      stream.destroy()
      throw new InputFileSizeLimitError(label, maxBytes)
    }

    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}
