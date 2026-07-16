#!/usr/bin/env -S node --loader ts-node/esm --disable-warning=ExperimentalWarning

import {execute} from '@oclif/core'

import {configureRuntime, normalizeArgv} from './runtime.js'

const argv = process.argv.slice(2)
configureRuntime(argv)
const isInteractive = process.stdin.isTTY === true && process.stdout.isTTY === true
if (process.env.CI || !isInteractive || argv.includes('--json')) {
  process.env.MODELLIX_CLI_SKIP_NEW_VERSION_CHECK ??= 'true'
}

const args = argv.length === 0 ? ['quickstart'] : normalizeArgv(argv)
await execute({args, development: true, dir: import.meta.url})
