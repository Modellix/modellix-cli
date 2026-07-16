# modellix-cli

`modellix-cli` is the official command-line client for [Modellix](https://modellix.ai). It manages authentication profiles, discovers and runs models, waits for asynchronous tasks, downloads results, and provides stable automation output. See the [complete feature matrix](#feature-matrix) below.

## Requirements

- Node.js 18.17 or later
- A Modellix API key from the [Modellix Console](https://www.modellix.ai/console/api-key)

## Install

```sh
npm install --global modellix-cli
```

Verify the installation:

```sh
modellix-cli --version
```

Running `modellix-cli` without arguments prints a local Quickstart with the API-key setup link, copyable next steps, standard help command, and the [CLI guide](https://docs.modellix.ai/ways-to-use/cli). It does not make an API request or start an interactive wizard.

Human and automation entry points:

```sh
modellix-cli
modellix-cli quickstart
modellix-cli --json
modellix-cli --output quiet
modellix-cli --help
```

## Feature matrix

| Area | Capability | Commands and behavior |
| --- | --- | --- |
| Setup | Secure key setup | `init` and `auth login` hide interactive input, validate the key before saving, and support non-interactive JSON output. |
| Authentication | Named profiles | `auth login/status/whoami/logout`; select with `--profile` or `MODELLIX_PROFILE`. Concurrent writes are locked, replacements use conflict detection, and the legacy single-key schema remains readable. |
| Diagnostics | Environment and account checks | `doctor` verifies Node.js, key resolution, API connectivity, key validity, and balance without printing the key. |
| Configuration | Local inspection and cleanup | `config path/show/clear`; status output never reveals stored credentials, and cleanup can target one profile. |
| Discovery | Search and filter models | `model list --search --type --provider --limit`; output as human text, JSON, quiet slugs, or the compatible `slugs` format. |
| Discovery | Model details | `model describe <provider/model>` reads the existing model catalog and prints human, JSON, or quiet output. |
| Execution | Single model task | `model run` accepts an inline JSON object, a JSON file, or stdin; validates finite values, depth, and size before POST; default submission remains asynchronous and `--wait` can return the terminal result. |
| Execution | Batch model tasks | `model batch` validates the complete JSONL input before any paid POST, bounds task count/body size/concurrency, requires an explicit paid-task guard, optionally waits, and reports every accepted, rejected, unknown, timeout, or skipped submission. |
| Tasks | Read and wait | `task get`; `task wait` accepts up to 1000 IDs, validates response identity, bounds concurrency, tolerates transient reads inside the overall deadline, preserves partial timeout results, and accepts durations such as `500ms`, `30s`, `5m`, or `2h`. |
| Tasks | Result downloads | `task download` requires a successful task, uses private randomized staging and byte-safe filenames, preserves files by default, atomically overwrites regular files, revalidates redirects, and enforces per-file, aggregate, resource-count, and wall-clock limits. |
| Tasks | Local history | `task history` records Task ID, profile, API origin, model slug, status, and timestamps under a cross-process lock; it never stores an API key or request body. `get`, `wait`, and `download` refresh status. |
| Automation | Stable output | `--json`, `--quiet/-q`, and `--output human\|json\|quiet`; explicit JSON failures use `{ "ok": false, "error": { "exitCode", "message" } }`. Compatible values include `slugs` and `task-id`. |
| Automation | CI-safe operation | `--no-color`, `--no-progress`, and automatic update-check suppression for CI or piped output. Non-interactive commands never wait for a prompt. |
| Networking | Custom API origin | `--base-url` or `MODELLIX_BASE_URL`; HTTPS is required except for an explicit localhost development origin. |
| Networking | Safe retries | Read-only GET requests retry transient network, 429, and selected 5xx failures within each request deadline; task waiting can continue after an exhausted transient round. Paid POST submissions are never automatically retried, and ambiguous responses are outcome-unknown. |
| Security | Bounded untrusted data | Request bodies, batch input/task counts, API responses, task IDs/resources, history/config files, filenames, downloads, redirects, and terminal-facing values are bounded and validated. Runtime option preprocessing honors `--`. |
| Debugging | Sanitized diagnostics | `--verbose/-v` and `--debug` report method, endpoint, status, attempt, and timing to stderr without logging API keys, request bodies, or response bodies. |
| Shell | Completion | `autocomplete` provides setup instructions for Bash, Zsh, and PowerShell. |
| Compatibility | Existing scripts | `model invoke` remains an alias of `model run`; bare duration integers remain seconds; API commands retain their JSON defaults. |

## Quickstart

```sh
# Store and validate an API key
modellix-cli init

# Check Node.js, authentication, API connectivity, and balance
modellix-cli doctor

# Discover model slugs
modellix-cli model list

# Submit a model job
modellix-cli model run \
  --model-slug bytedance/seedream-4.5-t2i \
  --body '{"prompt":"A cute cat playing in a sunny garden"}'

# Query the task ID returned by the model
modellix-cli task get task-abc123
```

## Authentication and profiles

Every authenticated command first selects a profile in this order:

1. `--profile`
2. `MODELLIX_PROFILE`
3. the saved `currentProfile`
4. `default`

It then resolves the API key in this independent order:

1. `--api-key`
2. `MODELLIX_API_KEY`
3. the selected saved profile

Recommended setup:

```sh
modellix-cli auth login
modellix-cli auth login --profile work
modellix-cli auth status --profile work
```

`modellix-cli init` remains the short setup command and supports the same global Profile selection. Interactive prompts hide the key, and the CLI validates it before writing. New configuration uses this schema:

```json
{
  "currentProfile": "default",
  "profiles": {
    "default": {
      "apiKey": "<redacted>"
    }
  }
}
```

The previous `{ "apiKey": "..." }` schema is still accepted and is upgraded on the next successful write. Profile names accept letters, numbers, underscores, dots, and hyphens; reserved JavaScript property names are rejected.

On POSIX systems, the CLI creates the configuration directory and file with owner-only permissions. Windows file protection follows the permissions of the current user's home directory.

For temporary or CI usage, set the environment variable instead:

```sh
# macOS / Linux
export MODELLIX_API_KEY="your_api_key"
```

```powershell
# Windows PowerShell
$env:MODELLIX_API_KEY = "your_api_key"
```

Passing a key on the command line can leave it in shell history, so prefer the hidden prompt or environment variable. `auth status`, `auth whoami`, `config show`, and all JSON status output omit the credential value.

Authentication commands:

```sh
modellix-cli auth login [--profile NAME]
modellix-cli auth status [--profile NAME] [--json]
modellix-cli auth whoami [--profile NAME] [--json]
modellix-cli auth logout [--profile NAME] [--yes]
```

## Initialize or validate configuration

Interactive setup:

```sh
modellix-cli init
```

Non-interactive setup:

```sh
modellix-cli init --api-key "$MODELLIX_API_KEY" --yes
modellix-cli init --api-key "$MODELLIX_API_KEY" --yes --json
```

Validate without writing a configuration file:

```sh
modellix-cli init --api-key "$MODELLIX_API_KEY" --check
```

Use `--force` to recover or replace an unreadable configuration; `--yes` only accepts an ordinary replacement confirmation. Add `--profile NAME` for a named profile and `--json` for a stable machine-readable result. Successful human and JSON output include copyable model/task next steps and the CLI documentation URL. In a non-interactive terminal, `init` fails immediately when no key is already available instead of waiting for input.

## Diagnose the environment

```sh
modellix-cli doctor
modellix-cli doctor --json
```

`doctor` checks the Node.js version, reports the selected API-key source without printing the key, validates API connectivity, and reads the team balance when authentication succeeds. A failed required check returns a non-zero exit status.

## Inspect or clear local configuration

These commands never print the API key:

```sh
modellix-cli config path
modellix-cli config show
modellix-cli config show --json
```

Remove only the selected saved profile (the `MODELLIX_API_KEY` environment variable is left unchanged):

```sh
modellix-cli config clear
modellix-cli config clear --profile work --yes
modellix-cli config clear --yes --json
```

## List models

```sh
modellix-cli model list
modellix-cli model list --api-key <key>
modellix-cli model list --type text-to-image --output slugs
modellix-cli model list --provider google --limit 20
modellix-cli model list --search banana
```

The command returns the Modellix API JSON response, including model slugs and documentation URLs. Filters are applied locally and case-insensitively where appropriate. Use `--quiet` or `--output slugs` to print one slug per line.

Inspect one model without requiring a new backend endpoint:

```sh
modellix-cli model describe google/nano-banana-2
modellix-cli model describe google/nano-banana-2 --json
```

## Run a model

Use an inline JSON payload:

```sh
modellix-cli model run \
  --model-slug bytedance/seedream-4.5-t2i \
  --body '{"prompt":"A cute cat"}'
```

Or load the payload from a file:

```sh
modellix-cli model run \
  --model-slug alibaba/qwen-image-edit \
  --body-file ./payload.json
```

Or pipe JSON without creating a temporary file:

```sh
printf '%s' '{"prompt":"A cute cat"}' | \
  modellix-cli model run --model-slug google/nano-banana-2 --body-file -
```

PowerShell equivalent:

```powershell
'{"prompt":"A cute cat"}' | modellix-cli model run --model-slug google/nano-banana-2 --body-file -
```

`--model-slug` must use the exact `provider/model` value returned by `model list`. Use either `--body` or `--body-file`, not both. The request body must be a JSON object and is capped at 64 MiB; `--max-body-bytes` can lower that limit for automation.

For shell pipelines, print only the new task ID:

```sh
modellix-cli model run --model-slug <provider/model> --body '<json>' --output task-id
```

Submit and wait in one command:

```sh
modellix-cli model run \
  --model-slug google/nano-banana-2 \
  --body '{"prompt":"A cute cat"}' \
  --wait --timeout 5m --quiet
```

The default remains asynchronous. `--wait` polls after a successful submission; `--no-wait` makes the default explicit. If waiting times out after a Task ID is received, the error prints that ID and a safe `task wait` recovery command. A network or protocol failure during a paid POST is reported as an unknown submission outcome and must not be blindly retried.

The previous command name remains compatible:

```sh
modellix-cli model invoke --model-slug <provider/model> --body '<json>'
```

New scripts should use `model run`.

## Batch model tasks

`model batch` accepts one JSON object per line:

```json
{"modelSlug":"google/nano-banana-2","body":{"prompt":"First image"}}
{"modelSlug":"google/nano-banana-2","body":{"prompt":"Second image"}}
```

```sh
modellix-cli model batch tasks.jsonl --max-tasks 10 --concurrency 3
cat tasks.jsonl | modellix-cli model batch - --yes --wait --quiet
```

```powershell
Get-Content -Raw tasks.jsonl | modellix-cli model batch - --max-tasks 10 --wait --quiet
```

Batch submission requires either `--max-tasks` or explicit `--yes`, because every line can create a paid task. All slugs and JSON bodies are validated before the first POST. Concurrency is limited to 1–10 and the absolute local limit is 1000 tasks. Input and each body default to a 64 MiB ceiling; `--max-input-bytes` and `--max-body-bytes` can lower them. Results preserve input order and classify each line as `accepted`, `rejected`, `unknown`, or `skipped`; local-only timeouts use status `timeout` and exit 124 when they are the only failures. After an unknown paid-submission outcome, the CLI stops starting new entries by default; use `--continue-on-unknown` only after accepting the duplicate-charge risk.

## Get a task result

```sh
modellix-cli task get <task_id>
```

Example:

```sh
modellix-cli task get task-abc123
```

Use `task get --output human` for a readable summary or `--quiet` for resource URLs. Let the CLI poll one or more tasks for you:

```sh
modellix-cli task wait <task_id>
modellix-cli task wait task-a task-b --interval 5s --timeout 10m --concurrency 8
```

Bare time values remain seconds. Polling interval is capped at one hour, overall timeout at seven days, concurrent status requests at 20, and one invocation accepts at most 1000 unique IDs. A single ID retains the raw terminal API JSON; multiple IDs use a stable `{ "tasks": [...] }` wrapper in input order. Any failed terminal task exits 1. An overall timeout exits 124; JSON mode includes completed responses and `unfinishedTaskIds` so partial progress is not lost.

## Download task resources

```sh
modellix-cli task download <task_id> --output-dir ./results
modellix-cli task download <task_id> --output-dir ./results --json
```

Downloads use HTTPS and public network addresses by default. Every redirect is checked again, each resource has a 10-minute wall-clock deadline and a 1 GiB default maximum, one task defaults to at most 100 resources and 2 GiB combined, filenames are byte-bounded and sanitized, and existing files are preserved. A private randomized staging directory is removed after success and ordinary errors; abrupt process termination can leave a staging directory or overwrite backup that may be removed after inspection. For a trusted local development server only:

```sh
modellix-cli task download <task_id> \
  --allow-insecure-http --allow-private-network
```

Use `--overwrite` deliberately, `--max-bytes` for the per-resource limit, `--max-total-bytes` for the combined limit, `--max-resources` for resource count, and `--timeout` to change the deadline up to 24 hours. JSON output contains local paths and byte counts, not signed source URLs.

## Local task history

Successful submissions are recorded locally so Task IDs remain recoverable:

```sh
modellix-cli task history
modellix-cli task history --limit 50 --json
modellix-cli task history --profile work --json
modellix-cli task history --quiet
modellix-cli task history --clear --yes
modellix-cli task history --profile work --clear --yes
```

History is capped at 1000 entries and stores only Task ID, profile, API origin, model slug, status, and timestamps. Entries are isolated by origin + profile + Task ID, and `--profile NAME` filters the listing. A history-write failure produces a warning but never makes an already accepted paid task appear unsubmitted.

## Output, automation, and CI

All built-in Modellix business commands accept the common output controls (plugin-provided help and completion commands keep their own flags):

- `--json` or `--output json`: one machine-readable JSON document; failures use a stable `ok/error/exitCode/message` envelope.
- `--quiet/-q` or `--output quiet`: only the primary value, such as slugs, Task IDs, resource URLs, or local paths.
- `--output human`: concise readable output.
- `--output slugs` on `model list` and `--output task-id` on `model run` remain compatible script-specific formats.

When output flags overlap, quiet output wins over JSON, then JSON wins over the command default. Business output uses stdout; warnings, debug details, and recovery instructions use stderr. Non-interactive commands never prompt unless the required confirmation is supplied explicitly.

For CI:

```sh
modellix-cli --json
modellix-cli init --api-key "$MODELLIX_API_KEY" --yes --json
modellix-cli doctor --json --no-color --no-progress
```

`CI` automatically disables colors, progress-capable output, and the background update check. `--no-progress` also guarantees clean output for future progress-enabled commands; current polling is already silent. Set `MODELLIX_CLI_SKIP_NEW_VERSION_CHECK=true` to disable the update check explicitly.

Exit codes used by scripts:

| Code | Meaning |
| ---: | --- |
| 0 | Success |
| 1 | API, task, operation, or command validation failure |
| 2 | Argument-parser rejection or an explicit safety guard such as the batch cost limit |
| 124 | Local task wait timeout; the remote task may still be running |
| 127 | Unknown command; suggestions are never executed automatically |

## Networking and diagnostics

Override the Modellix API origin for a trusted gateway or local development server:

```sh
modellix-cli doctor --base-url https://gateway.example.com
MODELLIX_BASE_URL=https://gateway.example.com modellix-cli model list
```

```powershell
$env:MODELLIX_BASE_URL = 'https://gateway.example.com'
modellix-cli model list
```

The origin cannot contain credentials, query parameters, fragments, or a path. HTTPS is required; HTTP is accepted only for `localhost`, `127.0.0.1`, or `::1`.

Read-only GET requests use at most three attempts for transient network, 429, 500, 502, 503, and 504 failures, all inside one 15-second wall-clock deadline. `task wait` may start another bounded read round while its overall timeout remains. Paid model POST requests use exactly one attempt. A lost, oversized, malformed, timed-out, unexpectedly redirected, 408, conflict, or server-error response is treated conservatively as an unsafe-to-retry unknown outcome; only clearly rejected client statuses are classified as rejected.

API JSON responses are capped at 16 MiB. Configuration and history are also size-bounded, written atomically with owner-only POSIX permissions, and protected from concurrent process updates.

Sanitized request diagnostics are available on stderr:

```sh
modellix-cli model list --verbose
modellix-cli model list --debug
```

Diagnostics include method, endpoint path, retry attempt, response status, and elapsed time. They exclude API keys, request bodies, and response bodies.

## Shell completion

```sh
modellix-cli autocomplete
modellix-cli autocomplete bash
modellix-cli autocomplete zsh
modellix-cli autocomplete powershell
```

The command prints shell-specific installation instructions and can refresh its command cache with `--refresh-cache`.

The autocomplete plugin also exposes maintenance subcommands used by its shell setup scripts:

```sh
modellix-cli autocomplete create
modellix-cli autocomplete script bash
modellix-cli autocomplete script zsh
modellix-cli autocomplete script powershell
```

## Troubleshooting

### Missing API key

Run `modellix-cli init`, set `MODELLIX_API_KEY`, or pass `--api-key`.

### 401 Unauthorized

Run `modellix-cli init`, set `MODELLIX_API_KEY`, or pass `--api-key`; then use `modellix-cli doctor` to verify the repaired setup. The key may be invalid, expired, or revoked.

### 402 Payment Required

The key is valid but the account has insufficient balance. Recharge in the Modellix Console and retry.

### 429 Too Many Requests

Read-only commands already retry within their request deadline. Paid submissions are not retried automatically; inspect account/task activity before manually submitting again.

### Paid submission outcome is unknown

Do not immediately repeat the same `model run` or batch line. The server may have accepted it before the connection failed. Check local `task history`, account activity, and any Task ID printed by the CLI first.

### Download blocked

Result downloads default to HTTPS and public network destinations. Only use `--allow-insecure-http` or `--allow-private-network` when the URL and environment are explicitly trusted.

### Help and command suggestions

```sh
modellix-cli --help
modellix-cli help --nested-commands
modellix-cli <command> --help
```

Misspelled commands receive a nearest-command suggestion in both interactive and non-interactive terminals. Suggestions are never executed automatically.

## Backend-dependent exclusions

This release implements the client-only capabilities in the [feature matrix](#feature-matrix). It does not invent undocumented server operations: task cancellation/deletion, server-side batch orchestration, webhook management, billing mutation, project/team administration, and remote artifact lifecycle controls require supported backend endpoints before they can be added safely.

## Generated usage

<!-- usage -->
```sh-session
$ npm install -g modellix-cli
$ modellix-cli COMMAND
running command...
$ modellix-cli (--version)
modellix-cli/0.0.7
$ modellix-cli --help [COMMAND]
USAGE
  $ modellix-cli COMMAND
...
```
<!-- usagestop -->

## Command reference

<!-- commands -->
* [`modellix-cli auth login`](#modellix-cli-auth-login)
* [`modellix-cli auth logout`](#modellix-cli-auth-logout)
* [`modellix-cli auth status`](#modellix-cli-auth-status)
* [`modellix-cli auth whoami`](#modellix-cli-auth-whoami)
* [`modellix-cli autocomplete [SHELL]`](#modellix-cli-autocomplete-shell)
* [`modellix-cli config clear`](#modellix-cli-config-clear)
* [`modellix-cli config path`](#modellix-cli-config-path)
* [`modellix-cli config show`](#modellix-cli-config-show)
* [`modellix-cli doctor`](#modellix-cli-doctor)
* [`modellix-cli help [COMMAND]`](#modellix-cli-help-command)
* [`modellix-cli init`](#modellix-cli-init)
* [`modellix-cli model batch FILE`](#modellix-cli-model-batch-file)
* [`modellix-cli model describe SLUG`](#modellix-cli-model-describe-slug)
* [`modellix-cli model invoke`](#modellix-cli-model-invoke)
* [`modellix-cli model list`](#modellix-cli-model-list)
* [`modellix-cli model run`](#modellix-cli-model-run)
* [`modellix-cli task download TASKID`](#modellix-cli-task-download-taskid)
* [`modellix-cli task get TASKID`](#modellix-cli-task-get-taskid)
* [`modellix-cli task history`](#modellix-cli-task-history)
* [`modellix-cli task wait TASKIDS`](#modellix-cli-task-wait-taskids)

## `modellix-cli auth login`

Validate and save a Modellix API key for a profile

```
USAGE
  $ modellix-cli auth login [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress] [--output
    human|json|quiet] [--profile <value>] [-q] [-v] [--api-key <value>] [--check] [--force] [-y]

FLAGS
  -y, --yes              Accept profile replacement prompts
      --api-key=<value>  Modellix API key (overrides environment and saved configuration)
      --check            Validate the key without writing configuration
      --force            Replace the selected saved profile
      --json             Print one machine-readable JSON result
      --profile=<value>  Configuration profile (overrides MODELLIX_PROFILE and the current profile)

GLOBAL FLAGS
  -q, --quiet             Print only the primary value
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --output=<option>   Output format
                          <options: human|json|quiet>

DESCRIPTION
  Validate and save a Modellix API key for a profile

EXAMPLES
  $ modellix-cli auth login

  $ modellix-cli auth login --profile work --api-key <key> --yes

  $ modellix-cli auth login --api-key <key> --check --json
```

_See code: [src/commands/auth/login.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/auth/login.ts)_

## `modellix-cli auth logout`

Remove a saved Modellix authentication profile

```
USAGE
  $ modellix-cli auth logout [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress] [--output
    human|json|quiet] [--profile <value>] [-q] [-v] [-y]

FLAGS
  -y, --yes              Confirm logout without prompting
      --json             Print one machine-readable JSON result
      --profile=<value>  Configuration profile (overrides MODELLIX_PROFILE and the current profile)

GLOBAL FLAGS
  -q, --quiet             Print only the primary value
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --output=<option>   Output format
                          <options: human|json|quiet>

DESCRIPTION
  Remove a saved Modellix authentication profile

EXAMPLES
  $ modellix-cli auth logout --profile work

  $ modellix-cli auth logout --profile work --yes --json
```

_See code: [src/commands/auth/logout.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/auth/logout.ts)_

## `modellix-cli auth status`

Show and verify the active Modellix authentication without revealing the key

```
USAGE
  $ modellix-cli auth status [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress] [--output
    human|json|quiet] [--profile <value>] [-q] [-v] [--api-key <value>]

FLAGS
  --api-key=<value>  Modellix API key (overrides environment and saved configuration)
  --json             Print one machine-readable JSON result
  --profile=<value>  Configuration profile (overrides MODELLIX_PROFILE and the current profile)

GLOBAL FLAGS
  -q, --quiet             Print only the primary value
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --output=<option>   Output format
                          <options: human|json|quiet>

DESCRIPTION
  Show and verify the active Modellix authentication without revealing the key

EXAMPLES
  $ modellix-cli auth status

  $ modellix-cli auth status --profile work --json

  $ modellix-cli auth status --api-key <key>
```

_See code: [src/commands/auth/status.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/auth/status.ts)_

## `modellix-cli auth whoami`

Show and verify the active Modellix authentication without revealing the key

```
USAGE
  $ modellix-cli auth whoami [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress] [--output
    human|json|quiet] [--profile <value>] [-q] [-v] [--api-key <value>]

FLAGS
  --api-key=<value>  Modellix API key (overrides environment and saved configuration)
  --json             Print one machine-readable JSON result
  --profile=<value>  Configuration profile (overrides MODELLIX_PROFILE and the current profile)

GLOBAL FLAGS
  -q, --quiet             Print only the primary value
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --output=<option>   Output format
                          <options: human|json|quiet>

DESCRIPTION
  Show and verify the active Modellix authentication without revealing the key

EXAMPLES
  $ modellix-cli auth whoami

  $ modellix-cli auth whoami --profile work --json

  $ modellix-cli auth whoami --api-key <key>
```

_See code: [src/commands/auth/whoami.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/auth/whoami.ts)_

## `modellix-cli autocomplete [SHELL]`

Display autocomplete installation instructions.

```
USAGE
  $ modellix-cli autocomplete [SHELL] [-r]

ARGUMENTS
  [SHELL]  (zsh|bash|powershell) Shell type

FLAGS
  -r, --refresh-cache  Refresh cache (ignores displaying instructions)

DESCRIPTION
  Display autocomplete installation instructions.

EXAMPLES
  $ modellix-cli autocomplete

  $ modellix-cli autocomplete bash

  $ modellix-cli autocomplete zsh

  $ modellix-cli autocomplete powershell

  $ modellix-cli autocomplete --refresh-cache
```

_See code: [@oclif/plugin-autocomplete](https://github.com/oclif/plugin-autocomplete/blob/v3.2.53/src/commands/autocomplete/index.ts)_

## `modellix-cli config clear`

Remove the saved Modellix API key configuration

```
USAGE
  $ modellix-cli config clear [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress] [--output
    human|json|quiet] [--profile <value>] [-q] [-v] [-y]

FLAGS
  -y, --yes              Confirm removal without prompting
      --json             Print one machine-readable JSON result
      --profile=<value>  Configuration profile (overrides MODELLIX_PROFILE and the current profile)

GLOBAL FLAGS
  -q, --quiet             Print only the primary value
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --output=<option>   Output format
                          <options: human|json|quiet>

DESCRIPTION
  Remove the saved Modellix API key configuration

EXAMPLES
  $ modellix-cli config clear

  $ modellix-cli config clear --yes --json
```

_See code: [src/commands/config/clear.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/config/clear.ts)_

## `modellix-cli config path`

Print the Modellix configuration file path

```
USAGE
  $ modellix-cli config path [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress] [--output
    human|json|quiet] [--profile <value>] [-q] [-v]

FLAGS
  --json             Print a machine-readable JSON result
  --profile=<value>  Configuration profile (overrides MODELLIX_PROFILE and the current profile)

GLOBAL FLAGS
  -q, --quiet             Print only the primary value
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --output=<option>   Output format
                          <options: human|json|quiet>

DESCRIPTION
  Print the Modellix configuration file path

EXAMPLES
  $ modellix-cli config path

  $ modellix-cli config path --json
```

_See code: [src/commands/config/path.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/config/path.ts)_

## `modellix-cli config show`

Show Modellix configuration status without revealing the API key

```
USAGE
  $ modellix-cli config show [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress] [--output
    human|json|quiet] [--profile <value>] [-q] [-v]

FLAGS
  --json             Print a machine-readable JSON result
  --profile=<value>  Configuration profile (overrides MODELLIX_PROFILE and the current profile)

GLOBAL FLAGS
  -q, --quiet             Print only the primary value
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --output=<option>   Output format
                          <options: human|json|quiet>

DESCRIPTION
  Show Modellix configuration status without revealing the API key

EXAMPLES
  $ modellix-cli config show

  $ modellix-cli config show --profile work --json
```

_See code: [src/commands/config/show.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/config/show.ts)_

## `modellix-cli doctor`

Check the local environment and Modellix API access

```
USAGE
  $ modellix-cli doctor [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress] [--output
    human|json|quiet] [--profile <value>] [-q] [-v] [--api-key <value>]

FLAGS
  --api-key=<value>  Modellix API key (overrides environment and saved configuration)
  --json             Print one machine-readable JSON report

GLOBAL FLAGS
  -q, --quiet             Print only the primary value
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --output=<option>   Output format
                          <options: human|json|quiet>
      --profile=<value>   Authentication profile to use (defaults to MODELLIX_PROFILE)

DESCRIPTION
  Check the local environment and Modellix API access

EXAMPLES
  $ modellix-cli doctor

  $ modellix-cli doctor --json

  $ modellix-cli doctor --api-key <key>
```

_See code: [src/commands/doctor.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/doctor.ts)_

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

## `modellix-cli init`

Configure and validate a Modellix API key

```
USAGE
  $ modellix-cli init [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress] [--output
    human|json|quiet] [--profile <value>] [-q] [-v] [--api-key <value>] [--check] [--force] [-y]

FLAGS
  -y, --yes              Accept configuration replacement prompts
      --api-key=<value>  Modellix API key to validate and optionally save
      --check            Validate the key without writing configuration
      --force            Replace an existing saved API key
      --json             Print one machine-readable JSON result

GLOBAL FLAGS
  -q, --quiet             Print only the primary value
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --output=<option>   Output format
                          <options: human|json|quiet>
      --profile=<value>   Authentication profile to use (defaults to MODELLIX_PROFILE)

DESCRIPTION
  Configure and validate a Modellix API key

EXAMPLES
  $ modellix-cli init

  $ modellix-cli init --api-key <key> --yes

  $ modellix-cli init --api-key <key> --check --json
```

_See code: [src/commands/init.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/init.ts)_

## `modellix-cli model batch FILE`

Submit multiple Modellix model tasks from JSONL input

```
USAGE
  $ modellix-cli model batch FILE [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress] [--output
    human|json|quiet] [--profile <value>] [-q] [-v] [--api-key <value>] [--concurrency <value>] [--continue-on-unknown]
    [--interval <value>] [--max-body-bytes <value>] [--max-input-bytes <value>] [--max-tasks <value>] [--timeout
    <value>] [--wait] [-y]

ARGUMENTS
  FILE  JSONL batch file, or - to read from stdin

FLAGS
  -q, --quiet                    Output only task IDs, or resource URLs when waiting
  -y, --yes                      Acknowledge that every input line can create a paid task
      --api-key=<value>          Modellix API key (overrides environment and saved configuration)
      --concurrency=<value>      [default: 3] Maximum simultaneous submissions
      --continue-on-unknown      Continue submitting new paid tasks after an outcome-unknown error
      --interval=<value>         [default: 2s] Polling interval when --wait is enabled (for example 5s or 1m)
      --max-body-bytes=<value>   [default: 67108864] Maximum JSON body size for each task
      --max-input-bytes=<value>  [default: 67108864] Maximum JSONL input size in bytes
      --max-tasks=<value>        Safety limit for the number of paid tasks submitted
      --output=<option>          [default: json] Output format
                                 <options: human|json|quiet>
      --timeout=<value>          [default: 5m] Maximum time to wait for each task
      --[no-]wait                Wait for every submitted task to reach a terminal state

GLOBAL FLAGS
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --json              Print machine-readable JSON
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --profile=<value>   Authentication profile to use (defaults to MODELLIX_PROFILE)

DESCRIPTION
  Submit multiple Modellix model tasks from JSONL input

EXAMPLES
  $ modellix-cli model batch tasks.jsonl --max-tasks 20

  cat tasks.jsonl | modellix-cli model batch - --yes --wait
```

_See code: [src/commands/model/batch.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/model/batch.ts)_

## `modellix-cli model describe SLUG`

Show details for a Modellix model

```
USAGE
  $ modellix-cli model describe SLUG [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress] [--output
    human|json|quiet] [--profile <value>] [-q] [-v] [--api-key <value>]

ARGUMENTS
  SLUG  Model slug in provider/model format

FLAGS
  -q, --quiet            Output only the model slug
      --api-key=<value>  Modellix API key (overrides environment and saved configuration)
      --json             Output model details as JSON
      --output=<option>  [default: human] Output format
                         <options: human|json|quiet>

GLOBAL FLAGS
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --profile=<value>   Authentication profile to use (defaults to MODELLIX_PROFILE)

DESCRIPTION
  Show details for a Modellix model

EXAMPLES
  $ modellix-cli model describe google/nano-banana-2

  $ modellix-cli model describe google/nano-banana-2 --json

  $ modellix-cli model describe google/nano-banana-2 --quiet
```

_See code: [src/commands/model/describe.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/model/describe.ts)_

## `modellix-cli model invoke`

Submit a Modellix model task

```
USAGE
  $ modellix-cli model invoke --model-slug <value> [--base-url <value>] [--debug] [--json] [--no-color]
    [--no-progress] [--output human|json|quiet|task-id] [--profile <value>] [-q] [-v] [--api-key <value>] [--body
    <value> | --body-file <value>] [--interval <value>] [--max-body-bytes <value>] [--timeout <value>] [--wait]

FLAGS
  -q, --quiet                   Output only the task ID, or resource URLs when waiting
      --api-key=<value>         Modellix API key (overrides environment and saved configuration)
      --body=<value>            JSON string request body
      --body-file=<value>       Path to a JSON file used as request body
      --interval=<value>        [default: 2s] Polling interval when --wait is enabled (for example 5s or 1m)
      --max-body-bytes=<value>  [default: 67108864] Maximum JSON request body size in bytes
      --model-slug=<value>      (required) Model slug in provider/model format, for example bytedance/seedream-4.5-t2i
      --output=<option>         [default: json] Output format
                                <options: human|json|quiet|task-id>
      --timeout=<value>         [default: 5m] Maximum time to wait (for example 30s, 5m, or 1h)
      --[no-]wait               Wait for the submitted task to reach a terminal state

GLOBAL FLAGS
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --json              Print machine-readable JSON
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --profile=<value>   Authentication profile to use (defaults to MODELLIX_PROFILE)

DESCRIPTION
  Submit a Modellix model task

ALIASES
  $ modellix-cli model invoke

EXAMPLES
  $ modellix-cli model invoke --model-slug bytedance/seedream-4.5-t2i --body '{"prompt":"A cute cat"}'

  $ modellix-cli model invoke --model-slug alibaba/qwen-image-edit --body-file ./payload.json --api-key <key>

  $ modellix-cli model invoke --model-slug google/nano-banana-2 --body-file - --wait
```

## `modellix-cli model list`

List available Modellix models

```
USAGE
  $ modellix-cli model list [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress] [--output
    human|json|quiet|slugs] [--profile <value>] [-q] [-v] [--api-key <value>] [--limit <value>] [--provider <value>]
    [--search <value>] [--type <value>]

FLAGS
  -q, --quiet             Output one model slug per line
      --api-key=<value>   Modellix API key (overrides environment and saved configuration)
      --limit=<value>     Maximum number of models to return
      --output=<option>   [default: json] Output format
                          <options: human|json|quiet|slugs>
      --provider=<value>  Filter by exact provider name
      --search=<value>    Filter by slug or description substring
      --type=<value>      Filter by exact model type, for example text-to-image

GLOBAL FLAGS
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --json              Print machine-readable JSON
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --profile=<value>   Authentication profile to use (defaults to MODELLIX_PROFILE)

DESCRIPTION
  List available Modellix models

EXAMPLES
  $ modellix-cli model list

  $ modellix-cli model list --type text-to-image --output slugs

  $ modellix-cli model list --provider google --limit 20

  $ modellix-cli model list --search banana

  $ modellix-cli model list --api-key <key>
```

_See code: [src/commands/model/list.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/model/list.ts)_

## `modellix-cli model run`

Submit a Modellix model task

```
USAGE
  $ modellix-cli model run --model-slug <value> [--base-url <value>] [--debug] [--json] [--no-color]
    [--no-progress] [--output human|json|quiet|task-id] [--profile <value>] [-q] [-v] [--api-key <value>] [--body
    <value> | --body-file <value>] [--interval <value>] [--max-body-bytes <value>] [--timeout <value>] [--wait]

FLAGS
  -q, --quiet                   Output only the task ID, or resource URLs when waiting
      --api-key=<value>         Modellix API key (overrides environment and saved configuration)
      --body=<value>            JSON string request body
      --body-file=<value>       Path to a JSON file used as request body
      --interval=<value>        [default: 2s] Polling interval when --wait is enabled (for example 5s or 1m)
      --max-body-bytes=<value>  [default: 67108864] Maximum JSON request body size in bytes
      --model-slug=<value>      (required) Model slug in provider/model format, for example bytedance/seedream-4.5-t2i
      --output=<option>         [default: json] Output format
                                <options: human|json|quiet|task-id>
      --timeout=<value>         [default: 5m] Maximum time to wait (for example 30s, 5m, or 1h)
      --[no-]wait               Wait for the submitted task to reach a terminal state

GLOBAL FLAGS
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --json              Print machine-readable JSON
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --profile=<value>   Authentication profile to use (defaults to MODELLIX_PROFILE)

DESCRIPTION
  Submit a Modellix model task

ALIASES
  $ modellix-cli model invoke

EXAMPLES
  $ modellix-cli model run --model-slug bytedance/seedream-4.5-t2i --body '{"prompt":"A cute cat"}'

  $ modellix-cli model run --model-slug alibaba/qwen-image-edit --body-file ./payload.json --api-key <key>

  $ modellix-cli model run --model-slug google/nano-banana-2 --body-file - --wait
```

_See code: [src/commands/model/run.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/model/run.ts)_

## `modellix-cli task download TASKID`

Download HTTP(S) resources from a completed Modellix task

```
USAGE
  $ modellix-cli task download TASKID [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress]
    [--output human|json|quiet] [--profile <value>] [-q] [-v] [--allow-insecure-http] [--allow-private-network]
    [--api-key <value>] [--max-bytes <value>] [--max-resources <value>] [--max-total-bytes <value>] [--output-dir
    <value>] [--overwrite] [--timeout <value>]

ARGUMENTS
  TASKID  Task ID whose result resources should be downloaded

FLAGS
  -q, --quiet                    Print only downloaded absolute file paths
      --allow-insecure-http      Allow HTTP resource URLs from a trusted source
      --allow-private-network    Allow resource hosts on private or reserved networks
      --api-key=<value>          Modellix API key (overrides environment and saved configuration)
      --json                     Print one stable machine-readable JSON result
      --max-bytes=<value>        [default: 1073741824] Maximum bytes allowed for each downloaded resource
      --max-resources=<value>    [default: 100] Maximum number of resources downloaded from one task
      --max-total-bytes=<value>  [default: 2147483648] Maximum combined bytes downloaded from one task
      --output-dir=<value>       [default: .] Directory in which downloaded resources are saved
      --overwrite                Overwrite existing regular files with matching names
      --timeout=<value>          [default: 10m] Total deadline for each resource, including redirects

GLOBAL FLAGS
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --output=<option>   Output format
                          <options: human|json|quiet>
      --profile=<value>   Authentication profile to use (defaults to MODELLIX_PROFILE)

DESCRIPTION
  Download HTTP(S) resources from a completed Modellix task

EXAMPLES
  $ modellix-cli task download task-abc123

  $ modellix-cli task download task-abc123 --output-dir ./results --json

  $ modellix-cli task download task-abc123 --overwrite --quiet
```

_See code: [src/commands/task/download.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/task/download.ts)_

## `modellix-cli task get TASKID`

Get Modellix task result by task ID

```
USAGE
  $ modellix-cli task get TASKID [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress]
    [--output human|json|quiet] [--profile <value>] [-q] [-v] [--api-key <value>]

ARGUMENTS
  TASKID  Task ID returned by model run

FLAGS
  --api-key=<value>  Modellix API key (overrides environment and saved configuration)

GLOBAL FLAGS
  -q, --quiet             Print only the primary value
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --json              Print machine-readable JSON
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --output=<option>   Output format
                          <options: human|json|quiet>
      --profile=<value>   Authentication profile to use (defaults to MODELLIX_PROFILE)

DESCRIPTION
  Get Modellix task result by task ID

EXAMPLES
  $ modellix-cli task get task-abc123 --api-key <key>

  $ modellix-cli task get task-abc123
```

_See code: [src/commands/task/get.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/task/get.ts)_

## `modellix-cli task history`

Show or clear local Modellix task history

```
USAGE
  $ modellix-cli task history [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress] [--output
    human|json|quiet] [--profile <value>] [-q] [-v] [--limit <value>] [-y --clear]

FLAGS
  -q, --quiet          Print only task IDs, one per line
  -y, --yes            Confirm clearing history without prompting
      --clear          Clear all local task history
      --json           Print one stable machine-readable JSON result
      --limit=<value>  [default: 20] Maximum number of recent entries

GLOBAL FLAGS
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --output=<option>   Output format
                          <options: human|json|quiet>
      --profile=<value>   Authentication profile to use (defaults to MODELLIX_PROFILE)

DESCRIPTION
  Show or clear local Modellix task history

EXAMPLES
  $ modellix-cli task history

  $ modellix-cli task history --limit 50 --json

  $ modellix-cli task history --clear --yes
```

_See code: [src/commands/task/history.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/task/history.ts)_

## `modellix-cli task wait TASKIDS`

Wait until one or more Modellix tasks reach terminal states

```
USAGE
  $ modellix-cli task wait TASKIDS [--base-url <value>] [--debug] [--json] [--no-color] [--no-progress]
    [--output human|json|quiet] [--profile <value>] [-q] [-v] [--api-key <value>] [--concurrency <value>] [--interval
    <value>] [--timeout <value>]

ARGUMENTS
  TASKIDS  One or more task IDs returned by model run

FLAGS
  --api-key=<value>      Modellix API key (overrides environment and saved configuration)
  --concurrency=<value>  [default: 8] Maximum number of simultaneous polling requests
  --interval=<value>     [default: 2s] Polling interval in seconds or duration format (for example 5s or 1m)
  --timeout=<value>      [default: 5m] Overall timeout in seconds or duration format (for example 30s, 5m, or 2h)

GLOBAL FLAGS
  -q, --quiet             Print only the primary value
  -v, --verbose           Print additional non-sensitive details to stderr
      --base-url=<value>  [env: MODELLIX_BASE_URL] Modellix API origin (HTTPS, or HTTP for localhost)
      --debug             Print sanitized HTTP diagnostics to stderr
      --json              Print machine-readable JSON
      --no-color          Disable terminal colors
      --no-progress       Disable progress messages
      --output=<option>   Output format
                          <options: human|json|quiet>
      --profile=<value>   Authentication profile to use (defaults to MODELLIX_PROFILE)

DESCRIPTION
  Wait until one or more Modellix tasks reach terminal states

EXAMPLES
  $ modellix-cli task wait task-abc123

  $ modellix-cli task wait task-a task-b --interval 5s --timeout 10m
```

_See code: [src/commands/task/wait.ts](https://github.com/Modellix/modellix-cli/blob/main/src/commands/task/wait.ts)_
<!-- commandsstop -->

## Related links

- [Modellix documentation](https://docs.modellix.ai/get-started)
- [Modellix CLI guide](https://docs.modellix.ai/ways-to-use/cli)
- [Modellix Agent Skill](https://docs.modellix.ai/ways-to-use/skill)
- [List Models API](https://docs.modellix.ai/api/list-models)
- [Validate API Key API](https://docs.modellix.ai/api/validate-api-key)
