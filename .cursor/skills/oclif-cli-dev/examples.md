# oclif Examples for modellix-cli

Use these patterns as defaults for this repository.

## Example 1: Add a top-level command

Target:

- Command ID: `health`
- File: `src/commands/health.ts`
- Test file: `test/commands/health.test.ts`

Command template:

```ts
import {Command, Flags} from '@oclif/core'

export default class Health extends Command {
  static description = 'Check CLI runtime dependencies'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ]

  static flags = {
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Health)
    const result = {ok: true, service: 'modellix-cli'}

    if (flags.json) {
      this.log(JSON.stringify(result))
      return
    }

    this.log('ok')
  }
}
```

Test template:

```ts
import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('health', () => {
  it('prints default output', async () => {
    const {error, stdout} = await runCommand(['health'])
    expect(error).to.equal(undefined)
    expect(stdout).to.contain('ok')
  })

  it('prints json output', async () => {
    const {error, stdout} = await runCommand(['health', '--json'])
    expect(error).to.equal(undefined)
    expect(stdout).to.contain('"ok":true')
  })
})
```

## Example 2: Add a topic subcommand

Target:

- Command ID: `task cancel`
- File: `src/commands/task/cancel.ts`
- Test file: `test/commands/task/cancel.test.ts`

Command template:

```ts
import {Args, Command, Flags} from '@oclif/core'

export default class TaskCancel extends Command {
  static description = 'Cancel a Modellix task by task ID'

  static examples = [
    '<%= config.bin %> <%= command.id %> task-abc123 --api-key <key>',
  ]

  static args = {
    taskId: Args.string({
      description: 'Task ID returned by model invoke',
      required: true,
    }),
  }

  static flags = {
    'api-key': Flags.string({
      description: 'Modellix API key (falls back to MODELLIX_API_KEY)',
    }),
  }

  async run(): Promise<void> {
    const {args} = await this.parse(TaskCancel)
    this.log(`cancel requested: ${args.taskId}`)
  }
}
```

Test template:

```ts
import {runCommand} from '@oclif/test'
import {expect} from 'chai'

describe('task cancel', () => {
  it('accepts task ID argument', async () => {
    const {error, stdout} = await runCommand(['task', 'cancel', 'task-abc123'])
    expect(error).to.equal(undefined)
    expect(stdout).to.contain('task-abc123')
  })

  it('fails when task ID is missing', async () => {
    const {error} = await runCommand(['task', 'cancel'])
    expect(error?.message).to.contain('Missing 1 required arg')
  })
})
```

## Example 3: Mutually exclusive flags pattern

When command input can come from text or file, use this pattern:

```ts
static flags = {
  body: Flags.string({
    description: 'JSON string request body',
    exclusive: ['body-file'],
  }),
  'body-file': Flags.string({
    description: 'Path to a JSON file used as request body',
    exclusive: ['body'],
  }),
}
```

Pair with one test for each source (`--body`, `--body-file`) and one failure test for invalid JSON/file path.

## Example 4: Minimal change checklist for command PRs

```md
- [ ] Add/modify command file under src/commands/**
- [ ] Add/modify tests under test/commands/**
- [ ] Run npm run build
- [ ] Run npm test
- [ ] Run npm run lint
- [ ] Run npm run prepack when command docs changed
```
