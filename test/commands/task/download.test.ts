import type {AddressInfo} from 'node:net'

import {runCommand} from '@oclif/test'
import {expect} from 'chai'
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

import {__setHttpRequesterForTest} from '../../../src/lib/modellix-client.js'
import {__setResourceDownloaderForTest} from '../../../src/lib/task.js'

const taskIdProperty = 'task_id'

describe('task download', () => {
  let originalApiKey: string | undefined
  let outputDirectory: string

  beforeEach(async () => {
    originalApiKey = process.env.MODELLIX_API_KEY
    process.env.MODELLIX_API_KEY = 'download-test-key'
    outputDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-download-test-'))
  })

  afterEach(async () => {
    __setHttpRequesterForTest()
    __setResourceDownloaderForTest()
    restoreEnvironmentVariable('MODELLIX_API_KEY', originalApiKey)
    await rm(outputDirectory, {force: true, recursive: true})
  })

  it('downloads resources with safe, collision-free filenames and stable JSON', async () => {
    await writeFile(join(outputDirectory, 'image.png'), 'existing')
    stubTaskResponse([
      {type: 'image', url: 'https://cdn.example.com/image.png?signature=secret'},
      {type: 'image', url: 'https://cdn.example.com/image.png'},
      {type: 'image', url: 'https://cdn.example.com/%2e%2e%2foutside.png'},
    ])
    __setResourceDownloaderForTest(async (url, destination) => {
      await mkdir(dirname(destination), {recursive: true})
      await writeFile(destination, `downloaded:${new URL(url).pathname}`)
    })

    const {error, stdout} = await runCommand([
      'task',
      'download',
      'task-download',
      '--output-dir',
      outputDirectory,
      '--json',
    ])

    expect(error).to.equal(undefined)
    expect(stdout).not.to.contain('signature')
    expect(stdout).not.to.contain('secret')
    const result = JSON.parse(stdout) as {files: Array<{path: string}>; taskId: string}
    expect(result.taskId).to.equal('task-download')
    expect(result.files.map((file) => file.path)).to.deep.equal([
      join(outputDirectory, 'image-2.png'),
      join(outputDirectory, 'image-3.png'),
      join(outputDirectory, '-outside.png'),
    ])
    expect(await readFile(join(outputDirectory, 'image.png'), 'utf8')).to.equal('existing')
    for (const file of result.files) {
      expect(dirname(file.path)).to.equal(outputDirectory)
    }

    expect((await readdir(outputDirectory)).some((name) => name.startsWith('.modellix-download-')))
      .to.equal(false)
  })

  it('overwrites an existing regular file only when requested', async () => {
    const target = join(outputDirectory, 'result.txt')
    await writeFile(target, 'old')
    stubTaskResponse([{url: 'https://cdn.example.com/result.txt'}])
    __setResourceDownloaderForTest(async (_url, destination) => {
      await writeFile(destination, 'new')
    })

    const {error, stdout} = await runCommand([
      'task',
      'download',
      'task-overwrite',
      '--output-dir',
      outputDirectory,
      '--overwrite',
      '--quiet',
    ])

    expect(error).to.equal(undefined)
    expect(stdout.trim()).to.equal(target)
    expect(await readFile(target, 'utf8')).to.equal('new')
  })

  it('preserves collision suffixes for filenames at the byte limit', async () => {
    const longName = `${'界'.repeat(78)}ab.txt`
    await writeFile(join(outputDirectory, longName), 'existing')
    stubTaskResponse([{url: `https://cdn.example.com/${longName}`}])
    __setResourceDownloaderForTest(async (_url, destination) => {
      await writeFile(destination, 'new')
    })

    const {error, stdout} = await runCommand([
      'task',
      'download',
      'task-long-name',
      '--output-dir',
      outputDirectory,
      '--quiet',
    ])

    expect(error).to.equal(undefined)
    expect(stdout.trim()).to.match(/-2\.txt$/)
    expect(Buffer.byteLength(stdout.trim().split(/[\\/]/).at(-1) as string)).to.be.at.most(240)
  })

  it('downloads HTTP resources and follows safe relative redirects', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/asset.bin') {
        response.writeHead(302, {location: '/content'})
        response.end()
        return
      }

      response.writeHead(200, {'content-type': 'application/octet-stream'})
      response.end('network-content')
    })
    await new Promise<void>((resolveServer, rejectServer) => {
      server.once('error', rejectServer)
      server.listen(0, '127.0.0.1', resolveServer)
    })

    try {
      const {port} = server.address() as AddressInfo
      stubTaskResponse([{url: `http://127.0.0.1:${port}/asset.bin`}])

      const blocked = await runCommand([
        'task',
        'download',
        'task-http',
        '--output-dir',
        outputDirectory,
      ])
      expect(blocked.error?.message).to.match(/insecure HTTP|private/i)

      const {error, stdout} = await runCommand([
        'task',
        'download',
        'task-http',
        '--output-dir',
        outputDirectory,
        '--quiet',
        '--allow-insecure-http',
        '--allow-private-network',
      ])

      expect(error).to.equal(undefined)
      expect(stdout.trim()).to.equal(join(outputDirectory, 'asset.bin'))
      expect(await readFile(join(outputDirectory, 'asset.bin'), 'utf8')).to.equal(
        'network-content',
      )

      const oversized = await runCommand([
        'task',
        'download',
        'task-http',
        '--output-dir',
        outputDirectory,
        '--allow-insecure-http',
        '--allow-private-network',
        '--max-bytes',
        '4',
      ])
      expect(oversized.error?.message).to.match(/4-byte limit/i)
    } finally {
      await new Promise<void>((resolveServer, rejectServer) => {
        server.close((error) => (error ? rejectServer(error) : resolveServer()))
      })
    }
  })

  it('rejects non-HTTP resource URLs before downloading', async () => {
    stubTaskResponse([{url: 'file:///etc/passwd'}])
    let downloaderCalled = false
    __setResourceDownloaderForTest(async () => {
      downloaderCalled = true
    })

    const {error} = await runCommand([
      'task',
      'download',
      'task-unsafe',
      '--output-dir',
      outputDirectory,
    ])

    expect(error?.message).to.contain('Unsupported task resource URL protocol')
    expect(downloaderCalled).to.equal(false)
  })

  it('rejects special-purpose IPv6 resource hosts', async () => {
    stubTaskResponse([{url: 'https://[2002::1]/resource.bin'}])
    let downloaderCalled = false
    __setResourceDownloaderForTest(async () => {
      downloaderCalled = true
    })

    const {error} = await runCommand([
      'task',
      'download',
      'task-ipv6',
      '--output-dir',
      outputDirectory,
    ])

    expect(error?.message).to.match(/private|reserved/i)
    expect(downloaderCalled).to.equal(false)
  })

  it('does not over-block a public address next to an IPv4 documentation range', async () => {
    stubTaskResponse([{url: 'https://203.0.1.1/resource.bin'}])
    __setResourceDownloaderForTest(async (_url, destination) => {
      await writeFile(destination, 'public-address-content')
    })

    const {error} = await runCommand([
      'task',
      'download',
      'task-public-ipv4',
      '--output-dir',
      outputDirectory,
    ])

    expect(error).to.equal(undefined)
  })

  it('does not echo a malformed signed resource URL in errors', async () => {
    stubTaskResponse([{url: 'not-a-url?signature=sensitive-download-token'}])

    const {error, stderr} = await runCommand([
      'task',
      'download',
      'task-malformed-url',
      '--output-dir',
      outputDirectory,
    ])

    expect(error?.message).to.equal('Invalid task resource URL.')
    expect(`${stderr}${error?.message ?? ''}`).not.to.contain('sensitive-download-token')
  })

  it('reports a completed task without resources', async () => {
    stubTaskResponse([])

    const {error} = await runCommand([
      'task',
      'download',
      'task-empty',
      '--output-dir',
      outputDirectory,
    ])

    expect(error?.message).to.contain('does not contain downloadable resources')
  })

  it('enforces resource-count and aggregate byte limits before exhausting disk', async () => {
    stubTaskResponse([
      {url: 'https://cdn.example.com/one.bin'},
      {url: 'https://cdn.example.com/two.bin'},
    ])
    let downloads = 0
    const receivedByteLimits: number[] = []
    __setResourceDownloaderForTest(async (_url, destination, options) => {
      downloads += 1
      receivedByteLimits.push(options.maxBytes)
      await writeFile(destination, '123')
    })

    const countLimited = await runCommand([
      'task',
      'download',
      'task-limits',
      '--output-dir',
      outputDirectory,
      '--max-resources',
      '1',
    ])
    expect(countLimited.error?.message).to.contain('1 downloadable resources')
    expect(downloads).to.equal(0)

    const totalLimited = await runCommand([
      'task',
      'download',
      'task-limits',
      '--output-dir',
      outputDirectory,
      '--max-total-bytes',
      '5',
    ])
    expect(totalLimited.error?.message).to.contain('5-byte total limit')
    expect(downloads).to.equal(2)
    expect(receivedByteLimits.slice(-2)).to.deep.equal([5, 2])
    expect((await readdir(outputDirectory)).some((name) => name.startsWith('.modellix-download-')))
      .to.equal(false)
  })
})

function stubTaskResponse(resources: Array<{type?: string; url: string}>): void {
  __setHttpRequesterForTest(async (options) => {
    const taskId = decodeURIComponent(options.path.split('/').at(-1) as string)
    return {
      bodyText: JSON.stringify({
        code: 0,
        data: {result: {resources}, status: 'success', [taskIdProperty]: taskId},
      }),
      headers: {},
      statusCode: 200,
    }
  })
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}
