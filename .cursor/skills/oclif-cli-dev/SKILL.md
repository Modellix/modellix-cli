---
name: oclif-cli-dev
description: Guides coding agents to build, test, and maintain oclif CLI projects with TypeScript, including command scaffolding, flags/args design, help text quality, @oclif/test coverage, manifest/readme generation, and release checks. Use when users mention oclif, CLI commands, command flags, plugin commands, command tests, or CLI debugging.
---

# oclif CLI Development

Use this skill when implementing or testing commands in an oclif-based CLI project.

## Goals

1. Add or modify commands in a way consistent with oclif conventions.
2. Keep command help text, examples, and README output accurate.
3. Add focused tests for behavior, validation, and output.
4. Verify build, lint, and test before finishing.

## Quick workflow

Copy this checklist and update status while working:

```md
oclif task checklist
- [ ] Inspect existing command/topic structure in src/commands
- [ ] Implement or update command code and types
- [ ] Add/adjust tests under test/** for new behavior
- [ ] Validate CLI help output quality (description/examples/flags/args)
- [ ] Run build/lint/test
- [ ] Regenerate manifest/readme if command surface changed
```

## Discovery rules

Before editing:

- Read `package.json` scripts and `oclif` config.
- Review neighboring commands in `src/commands/**` for naming and style.
- Reuse existing libs/helpers instead of introducing parallel abstractions.
- Keep topic layout predictable, for example `src/commands/model/invoke.ts` -> `model invoke`.

## Command authoring standards

When creating or modifying a command:

1. Export a class extending `Command` from `@oclif/core`.
2. Provide clear static metadata:
   - `summary` and optional `description`
   - `examples` with realistic invocations
   - `flags` with `summary`, `required`, defaults, and env fallback where relevant
   - `args` validation when positional inputs are used
3. Prefer explicit validation errors over silent coercion.
4. Keep output stable and script-friendly:
   - Human-readable default output
   - Optional machine-readable mode when project conventions already support it
5. Keep business logic in `src/lib/**` and keep command files thin orchestration layers.

## Flags and args design

- Use kebab-case for public flag names.
- Mark required inputs as required in flag/arg definitions.
- Prefer one canonical input path; only add aliases when backward compatibility needs it.
- For mutually exclusive inputs (e.g. inline JSON vs file), enforce validation in one place.
- Error messages should tell users how to recover (what flag or format is expected).

## Testing standards (`@oclif/test`)

For each changed command, cover at least:

1. **Happy path**: expected success output or result.
2. **Validation failure**: missing/invalid flags or args.
3. **Edge behavior** relevant to the command (e.g. file read failure, malformed JSON, API error mapping).

Testing guidance:

- Keep tests deterministic; stub network/process boundaries.
- Assert on key output fragments rather than brittle full-output snapshots unless output is intentionally fixed.
- Place tests near existing patterns under `test/**/*.test.ts`.

## Verification commands

Run these in project root unless repository standards differ:

```bash
npm run build
npm test
npm run lint
```

If command list/help text changed, regenerate docs/manifest:

```bash
npm run prepack
```

If `prepack` updates `README.md` or `oclif.manifest.json`, include those changes in the same task.

## Project examples

- For repository-specific command and test templates, see [examples.md](examples.md).

## Done criteria

A task is done only when all are true:

1. New/changed command behavior is implemented and tested.
2. Build/lint/test pass.
3. Help text and examples are accurate.
4. README/manifest are refreshed when command surface changed.
5. Changes are minimal, consistent with nearby command patterns, and avoid unrelated refactors.

## Reference

- oclif repository and docs: https://github.com/oclif/oclif
