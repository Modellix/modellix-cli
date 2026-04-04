# modellix-cli

A CLI tool for [Modellix](https://modellix.ai), built with oclif.

`modellix-cli` helps you create Modellix generation tasks from terminal and fetch task results quickly.

It is designed for developers/agents who want a simple command-line workflow over the Modellix API.

## What is Modellix

[Modellix](https://modellix.ai) is a MaaS platform that provides one API for many AI models.

You can learn more from the official docs overview: [Modellix Product Introduction](https://docs.modellix.ai/get-started).

## What this CLI can do

- Create async model tasks with `modellix-cli model invoke`
- Query task status and generated output with `modellix-cli task get <task_id>`
- Support API key via `--api-key` or environment variable `MODELLIX_API_KEY`

## Quick Start

```sh
npm install -g modellix-cli
```

Set API key once:

```sh
# macOS / Linux
export MODELLIX_API_KEY="your_api_key"
```

```powershell
# Windows PowerShell
$env:MODELLIX_API_KEY="your_api_key"
```

Create a task:

```sh
modellix-cli model invoke --model-type text-to-image --model-id qwen-image-plus --body '{"prompt":"A cute cat playing in a garden on a sunny day"}'
```

Query task result:

```sh
modellix-cli task get <task_id>
```


[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/modellix-cli.svg)](https://npmjs.org/package/modellix-cli)
[![Downloads/week](https://img.shields.io/npm/dw/modellix-cli.svg)](https://npmjs.org/package/modellix-cli)


<!-- toc -->
* [modellix-cli](#modellix-cli)
* [macOS / Linux](#macos--linux)
* [Windows PowerShell](#windows-powershell)
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g modellix-cli
$ modellix-cli COMMAND
running command...
$ modellix-cli (--version)
modellix-cli/0.0.0 win32-x64 node-v22.20.0
$ modellix-cli --help [COMMAND]
USAGE
  $ modellix-cli COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`modellix-cli help [COMMAND]`](#modellix-cli-help-command)
* [`modellix-cli model invoke`](#modellix-cli-model-invoke)
* [`modellix-cli model types`](#modellix-cli-model-types)
* [`modellix-cli task get TASKID`](#modellix-cli-task-get-taskid)

## `modellix-cli help [COMMAND]`

Display help for modellix-cli.

```
USAGE
  $ modellix-cli help [COMMAND...] [-n]

ARGUMENTS
  [COMMAND...]  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for modellix-cli.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/6.2.41/src/commands/help.ts)_

## `modellix-cli model invoke`

Create an async Modellix model task

```
USAGE
  $ modellix-cli model invoke --model-id <value> --model-type
    text-to-image|text-to-video|image-to-image|image-to-video|video-to-video [--api-key <value>] [--body <value> |
    --body-file <value>]

FLAGS
  --api-key=<value>      Modellix API key (falls back to MODELLIX_API_KEY)
  --body=<value>         JSON string request body
  --body-file=<value>    Path to a JSON file used as request body
  --model-id=<value>     (required) Model ID, for example qwen-image-plus
  --model-type=<option>  (required) Model type path segment, for example text-to-image
                         <options: text-to-image|text-to-video|image-to-image|image-to-video|video-to-video>

DESCRIPTION
  Create an async Modellix model task

EXAMPLES
  $ modellix-cli model invoke --model-type text-to-image --model-id qwen-image-plus --body '{"prompt":"A cute cat"}'

  $ modellix-cli model invoke --model-type text-to-image --model-id qwen-image-plus --body-file ./payload.json --api-key <key>
```

_See code: [src/commands/model/invoke.ts](https://github.com/Desktop/modellix-cli/blob/v0.0.0/src/commands/model/invoke.ts)_

## `modellix-cli model types`

List supported values for --model-type

```
USAGE
  $ modellix-cli model types [--json]

FLAGS
  --json  Output values as a JSON array

DESCRIPTION
  List supported values for --model-type

EXAMPLES
  $ modellix-cli model types

  $ modellix-cli model types --json
```

_See code: [src/commands/model/types.ts](https://github.com/Desktop/modellix-cli/blob/v0.0.0/src/commands/model/types.ts)_

## `modellix-cli task get TASKID`

Get Modellix task result by task ID

```
USAGE
  $ modellix-cli task get TASKID [--api-key <value>]

ARGUMENTS
  TASKID  Task ID returned by model invoke

FLAGS
  --api-key=<value>  Modellix API key (falls back to MODELLIX_API_KEY)

DESCRIPTION
  Get Modellix task result by task ID

EXAMPLES
  $ modellix-cli task get task-abc123 --api-key <key>

  $ modellix-cli task get task-abc123
```

_See code: [src/commands/task/get.ts](https://github.com/Desktop/modellix-cli/blob/v0.0.0/src/commands/task/get.ts)_
<!-- commandsstop -->
