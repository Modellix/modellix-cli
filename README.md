modellix-cli
=================

A CLI tool that use Modellix model services.


[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/modellix-cli.svg)](https://npmjs.org/package/modellix-cli)
[![Downloads/week](https://img.shields.io/npm/dw/modellix-cli.svg)](https://npmjs.org/package/modellix-cli)


<!-- toc -->
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
* [`modellix-cli hello PERSON`](#modellix-cli-hello-person)
* [`modellix-cli hello world`](#modellix-cli-hello-world)
* [`modellix-cli help [COMMAND]`](#modellix-cli-help-command)
* [`modellix-cli model invoke`](#modellix-cli-model-invoke)
* [`modellix-cli plugins`](#modellix-cli-plugins)
* [`modellix-cli plugins add PLUGIN`](#modellix-cli-plugins-add-plugin)
* [`modellix-cli plugins:inspect PLUGIN...`](#modellix-cli-pluginsinspect-plugin)
* [`modellix-cli plugins install PLUGIN`](#modellix-cli-plugins-install-plugin)
* [`modellix-cli plugins link PATH`](#modellix-cli-plugins-link-path)
* [`modellix-cli plugins remove [PLUGIN]`](#modellix-cli-plugins-remove-plugin)
* [`modellix-cli plugins reset`](#modellix-cli-plugins-reset)
* [`modellix-cli plugins uninstall [PLUGIN]`](#modellix-cli-plugins-uninstall-plugin)
* [`modellix-cli plugins unlink [PLUGIN]`](#modellix-cli-plugins-unlink-plugin)
* [`modellix-cli plugins update`](#modellix-cli-plugins-update)
* [`modellix-cli task get TASKID`](#modellix-cli-task-get-taskid)

## `modellix-cli hello PERSON`

Say hello

```
USAGE
  $ modellix-cli hello PERSON -f <value>

ARGUMENTS
  PERSON  Person to say hello to

FLAGS
  -f, --from=<value>  (required) Who is saying hello

DESCRIPTION
  Say hello

EXAMPLES
  $ modellix-cli hello friend --from oclif
  hello friend from oclif! (./src/commands/hello/index.ts)
```

_See code: [src/commands/hello/index.ts](https://github.com/Desktop/modellix-cli/blob/v0.0.0/src/commands/hello/index.ts)_

## `modellix-cli hello world`

Say hello world

```
USAGE
  $ modellix-cli hello world

DESCRIPTION
  Say hello world

EXAMPLES
  $ modellix-cli hello world
  hello world! (./src/commands/hello/world.ts)
```

_See code: [src/commands/hello/world.ts](https://github.com/Desktop/modellix-cli/blob/v0.0.0/src/commands/hello/world.ts)_

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
  $ modellix-cli model invoke --model-id <value> --model-type <value> [--api-key <value>] [--body <value> |
    --body-file <value>]

FLAGS
  --api-key=<value>     Modellix API key (falls back to MODELLIX_API_KEY)
  --body=<value>        JSON string request body
  --body-file=<value>   Path to a JSON file used as request body
  --model-id=<value>    (required) Model ID, for example qwen-image-plus
  --model-type=<value>  (required) Model type path segment, for example text-to-image

DESCRIPTION
  Create an async Modellix model task

EXAMPLES
  $ modellix-cli model invoke --model-type text-to-image --model-id qwen-image-plus --body '{"prompt":"A cute cat"}'

  $ modellix-cli model invoke --model-type text-to-image --model-id qwen-image-plus --body-file ./payload.json --api-key <key>
```

_See code: [src/commands/model/invoke.ts](https://github.com/Desktop/modellix-cli/blob/v0.0.0/src/commands/model/invoke.ts)_

## `modellix-cli plugins`

List installed plugins.

```
USAGE
  $ modellix-cli plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ modellix-cli plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.59/src/commands/plugins/index.ts)_

## `modellix-cli plugins add PLUGIN`

Installs a plugin into modellix-cli.

```
USAGE
  $ modellix-cli plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into modellix-cli.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the MODELLIX_CLI_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the MODELLIX_CLI_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ modellix-cli plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ modellix-cli plugins add myplugin

  Install a plugin from a github url.

    $ modellix-cli plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ modellix-cli plugins add someuser/someplugin
```

## `modellix-cli plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ modellix-cli plugins inspect PLUGIN...

ARGUMENTS
  PLUGIN...  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ modellix-cli plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.59/src/commands/plugins/inspect.ts)_

## `modellix-cli plugins install PLUGIN`

Installs a plugin into modellix-cli.

```
USAGE
  $ modellix-cli plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into modellix-cli.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the MODELLIX_CLI_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the MODELLIX_CLI_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ modellix-cli plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ modellix-cli plugins install myplugin

  Install a plugin from a github url.

    $ modellix-cli plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ modellix-cli plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.59/src/commands/plugins/install.ts)_

## `modellix-cli plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ modellix-cli plugins link PATH [-h] [--install] [-v]

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help          Show CLI help.
  -v, --verbose
      --[no-]install  Install dependencies after linking the plugin.

DESCRIPTION
  Links a plugin into the CLI for development.

  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ modellix-cli plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.59/src/commands/plugins/link.ts)_

## `modellix-cli plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ modellix-cli plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ modellix-cli plugins unlink
  $ modellix-cli plugins remove

EXAMPLES
  $ modellix-cli plugins remove myplugin
```

## `modellix-cli plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ modellix-cli plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.59/src/commands/plugins/reset.ts)_

## `modellix-cli plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ modellix-cli plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ modellix-cli plugins unlink
  $ modellix-cli plugins remove

EXAMPLES
  $ modellix-cli plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.59/src/commands/plugins/uninstall.ts)_

## `modellix-cli plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ modellix-cli plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  [PLUGIN...]  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ modellix-cli plugins unlink
  $ modellix-cli plugins remove

EXAMPLES
  $ modellix-cli plugins unlink myplugin
```

## `modellix-cli plugins update`

Update installed plugins.

```
USAGE
  $ modellix-cli plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/5.4.59/src/commands/plugins/update.ts)_

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
