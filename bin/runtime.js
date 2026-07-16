function readOption(argv, name) {
  const prefix = `--${name}=`
  const inline = argv.find((argument) => argument.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)

  const index = argv.indexOf(`--${name}`)
  if (index === -1) return
  return argv[index + 1]
}

export function configureRuntime(argv) {
  const optionTerminator = argv.indexOf('--')
  const runtimeArgv = optionTerminator === -1 ? argv : argv.slice(0, optionTerminator)
  const baseUrl = readOption(runtimeArgv, 'base-url')
  const profile = readOption(runtimeArgv, 'profile')
  if (baseUrl) process.env.MODELLIX_BASE_URL = baseUrl
  if (profile) process.env.MODELLIX_PROFILE = profile

  if (runtimeArgv.includes('--debug')) process.env.MODELLIX_CLI_HTTP_DEBUG = '1'
  if (runtimeArgv.includes('--verbose') || runtimeArgv.includes('-v')) process.env.MODELLIX_CLI_VERBOSE = '1'

  if (process.env.CI || runtimeArgv.includes('--no-color')) {
    process.env.NO_COLOR ??= '1'
    process.env.FORCE_COLOR = '0'
  }

  if (process.env.CI || runtimeArgv.includes('--no-progress')) {
    process.env.MODELLIX_CLI_NO_PROGRESS = '1'
  }
}

const booleanGlobalOptions = new Set([
  '--debug',
  '--json',
  '--no-color',
  '--no-progress',
  '--quiet',
  '--verbose',
  '-q',
  '-v',
])
const valueGlobalOptions = new Set(['--base-url', '--output', '--profile'])

export function normalizeArgv(argv) {
  const leadingOptions = []
  let index = 0
  while (index < argv.length) {
    const argument = argv[index]
    if (booleanGlobalOptions.has(argument)) {
      leadingOptions.push(argument)
      index += 1
      continue
    }

    const inlineOption = [...valueGlobalOptions].find((option) => argument.startsWith(`${option}=`))
    if (inlineOption) {
      leadingOptions.push(argument)
      index += 1
      continue
    }

    if (valueGlobalOptions.has(argument) && index + 1 < argv.length) {
      leadingOptions.push(argument, argv[index + 1])
      index += 2
      continue
    }

    break
  }

  if (leadingOptions.length === 0) return argv
  const remainder = argv.slice(index)
  if (remainder.length === 0) return ['quickstart', ...leadingOptions]
  if (['--help', '--version', '-h'].includes(remainder[0])) return remainder
  return [...remainder, ...leadingOptions]
}
