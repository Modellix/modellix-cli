# modellix-cli

`modellix-cli` is the official command line tool for [Modellix](https://modellix.ai).
It helps you submit model generation tasks and query task results directly from terminal.

## Install

```sh
npm install -g modellix-cli
```

Check installation:

```sh
modellix-cli --version
```

## Authentication

You can provide API key in two ways:

- Preferred: set environment variable once (`MODELLIX_API_KEY`)
- Alternative: pass `--api-key` in each command

Set env var:

```sh
# macOS / Linux
export MODELLIX_API_KEY="your_api_key"
```

```powershell
# Windows PowerShell
$env:MODELLIX_API_KEY="your_api_key"
```

## Core Commands

### 1) List available model types

```sh
modellix-cli model types
```

JSON output:

```sh
modellix-cli model types --json
```

Current supported `--model-type` enum values:

- `text-to-image`
- `text-to-video`
- `image-to-image`
- `image-to-video`
- `video-to-video`

### 2) Create a model task

Use inline JSON body:

```sh
modellix-cli model invoke --model-type text-to-image --model-slug bytedance/seedream-4.5-t2i --body '{"prompt":"A cute cat playing in a garden on a sunny day"}'
```

Use JSON file body:

```sh
modellix-cli model invoke --model-type image-to-image --model-slug alibaba/qwen-image-edit --body-file ./payload.json
```

Common flags:

- `--model-type` (required): model type path, for example `text-to-image`
- `--model-slug` (required): model slug in `provider/model` format, for example `bytedance/seedream-4.5-t2i`
- `--body`: request JSON string
- `--body-file`: path to request JSON file
- `--api-key`: API key (overrides env var)

### 3) Query task result

```sh
modellix-cli task get <task_id>
```

Example:

```sh
modellix-cli task get task-abc123
```

## Recommended Workflow

1. Run `modellix-cli model types` to check supported model type values.
2. Run `modellix-cli model invoke ...` and copy the returned `task_id`.
3. Run `modellix-cli task get <task_id>` to get status and result.

## Troubleshooting

### 401 Unauthorized

- Your API key is missing, invalid, or expired.
- Verify `MODELLIX_API_KEY` or pass `--api-key` explicitly.

### 402 Payment Required

- Your account balance is insufficient.
- Recharge your account in the Modellix console and retry.

### 429 Too Many Requests

- You have hit rate limit or concurrency limit.
- Retry with exponential backoff (for example: 1s, 2s, 4s).

## Help

View all commands:

```sh
modellix-cli --help
```

View help for one command:

```sh
modellix-cli <command> --help
```

## Related Links

- [Modellix Website](https://modellix.ai)
- [Modellix CLI Guide](https://docs.modellix.ai/ways-to-use/cli)
- [Modellix Docs Overview](https://docs.modellix.ai/get-started)
