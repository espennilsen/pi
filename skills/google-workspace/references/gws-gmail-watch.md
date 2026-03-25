# gmail +watch

Watch for new emails and stream them as NDJSON.

## Usage

```bash
gws gmail +watch
```

## Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--project` | — | — | GCP project ID for Pub/Sub resources |
| `--subscription` | — | — | Existing Pub/Sub subscription name |
| `--topic` | — | — | Existing Pub/Sub topic with Gmail push permission |
| `--label-ids` | — | — | Comma-separated Gmail label IDs to filter |
| `--max-messages` | — | 10 | Max messages per pull batch |
| `--poll-interval` | — | 5 | Seconds between pulls |
| `--msg-format` | — | full | Gmail message format: full, metadata, minimal, raw |
| `--once` | — | — | Pull once and exit |
| `--cleanup` | — | — | Delete created Pub/Sub resources on exit |
| `--output-dir` | — | — | Write each message to a separate JSON file |

## Examples

```bash
gws gmail +watch --project my-gcp-project
gws gmail +watch --project my-project --label-ids INBOX --once
gws gmail +watch --subscription projects/p/subscriptions/my-sub
```

## Tips

- Gmail watch expires after 7 days — re-run to renew.
- Without --cleanup, Pub/Sub resources persist for reconnection.
- `--cleanup` only runs on graceful exit (Ctrl-C). Resources may persist after a crash or SIGKILL — use `gcloud pubsub subscriptions delete` and `gcloud pubsub topics delete` (or the Cloud Console) to recover orphaned Pub/Sub resources.
- Press Ctrl-C to stop gracefully.

> [!CAUTION]
> This is a **write** command — confirm with the user before executing.
