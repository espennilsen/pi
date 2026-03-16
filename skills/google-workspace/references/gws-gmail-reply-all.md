# gmail +reply-all

Reply-all to a message (handles threading automatically).

## Usage

```bash
gws gmail +reply-all --message-id <ID> --body <TEXT>
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
| `--remove` | — | — | Exclude recipients (comma-separated emails) |
| `--html` | — | — | Send as HTML |
| `--dry-run` | — | — | Show request without executing |

## Examples

```bash
gws gmail +reply-all --message-id 18f1a2b3c4d --body 'Sounds good to me!'
gws gmail +reply-all --message-id 18f1a2b3c4d --body 'Updated' --remove bob@example.com
gws gmail +reply-all --message-id 18f1a2b3c4d --body '<i>Noted</i>' --html
```

## Tips

- Replies to sender and all original To/CC recipients.
- Use --remove to exclude recipients from the reply.
- Fails if no To recipient remains after exclusions.

> [!CAUTION]
> This is a **write** command — confirm with the user before executing.
