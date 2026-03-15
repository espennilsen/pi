# gmail +forward

Forward a message to new recipients.

## Usage

```bash
gws gmail +forward --message-id <ID> --to <EMAILS>
```

## Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--message-id` | ✓ | — | Gmail message ID to forward |
| `--to` | ✓ | — | Recipient email address(es), comma-separated |
| `--from` | — | — | Sender address (for send-as/alias) |
| `--cc` | — | — | CC email address(es) |
| `--bcc` | — | — | BCC email address(es) |
| `--body` | — | — | Optional note above the forwarded message |
| `--html` | — | — | Send as HTML |
| `--dry-run` | — | — | Show request without executing |

## Examples

```bash
gws gmail +forward --message-id 18f1a2b3c4d --to dave@example.com
gws gmail +forward --message-id 18f1a2b3c4d --to dave@example.com --body 'FYI see below'
```

## Tips

- Includes original message with sender, date, subject, and recipients.
