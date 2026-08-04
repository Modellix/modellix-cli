import {execFileSync} from 'node:child_process'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(join(repositoryDirectory, 'package.json'), 'utf8'))
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'modellix-cli-package-smoke-'))
const npmCli = process.env.npm_execpath

if (!npmCli) throw new Error('npm_execpath is required to run the package smoke test.')

try {
  const packOutput = runNpm([
    'pack',
    '--json',
    '--pack-destination',
    temporaryDirectory,
  ], repositoryDirectory)
  const packJson = packOutput.match(/(\[\s*\{[\s\S]*\}\s*\])\s*$/u)?.[1]
  if (!packJson) throw new Error('npm pack did not return a JSON result.')
  const packResult = JSON.parse(packJson)
  if (!Array.isArray(packResult) || packResult.length !== 1 || !packResult[0]?.filename) {
    throw new Error('npm pack did not return one package filename.')
  }

  await writeFile(
    join(temporaryDirectory, 'package.json'),
    `${JSON.stringify({name: 'modellix-cli-package-smoke', private: true}, null, 2)}\n`,
  )
  const tarballPath = join(temporaryDirectory, packResult[0].filename)
  runNpm([
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    tarballPath,
  ], temporaryDirectory)

  const cliEntry = join(temporaryDirectory, 'node_modules', packageJson.name, 'bin', 'run.js')
  const versionOutput = execFileSync(process.execPath, [cliEntry, '--version'], {
    cwd: temporaryDirectory,
    encoding: 'utf8',
    env: {...process.env, CI: '1'},
  }).trim()
  if (!versionOutput.includes(`${packageJson.name}/${packageJson.version}`)) {
    throw new Error(`Installed CLI reported an unexpected version: ${versionOutput}`)
  }

  const helpOutput = execFileSync(process.execPath, [cliEntry, '--help'], {
    cwd: temporaryDirectory,
    encoding: 'utf8',
    env: {...process.env, CI: '1'},
  })
  if (!helpOutput.includes('USAGE') || !helpOutput.includes('COMMANDS')) {
    throw new Error('Installed CLI help is missing generated usage or command sections.')
  }

  process.stdout.write(`Package smoke test passed for ${packageJson.name}@${packageJson.version}.\n`)
} finally {
  await rm(temporaryDirectory, {force: true, recursive: true})
}

function runNpm(arguments_, cwd) {
  return execFileSync(process.execPath, [npmCli, ...arguments_], {
    cwd,
    encoding: 'utf8',
    env: {...process.env, CI: '1'},
  })
}
