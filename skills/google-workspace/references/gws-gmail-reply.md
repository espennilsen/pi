# gmail +reply

Reply to a message (handles threading automatically).

## Usage

```bash
gws gmail +reply --message-id <ID> --body <TEXT>
```

## Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--message-id` | ✓ | — | Gmail message ID to reply to |
| `--body` | ✓ | — | Reply body (plain text, or HTML with --html) |
| `--from` | — | — | Sender address (for send-as/alias) |
| `--to` | — | — | Additional To email address(es) |
| `--cc` | — | — | Additional CC email address(es) |
| `--bcc` | — | — | BCC email address(es) |
| `--html` | — | — | Send as HTML |
| `--dry-run` | — | — | Show request without executing |

## Examples

```bash
gws gmail +reply --message-id 18f1a2b3c4d --body 'Thanks, got it!'
gws gmail +reply --message-id 18f1a2b3c4d --body 'Looping in Carol' --cc carol@example.com
gws gmail +reply --message-id 18f1a2b3c4d --body '<b>Bold reply</b>' --html
```

## Tips

- Automatically sets In-Reply-To, References, and threadId headers.
- Quotes the original message in the reply body.
- For reply-all, use +reply-all instead.
