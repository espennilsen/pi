# chat +send

Send a message to a space.

## Usage

```bash
gws chat +send --space <NAME> --text <TEXT>
```

## Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--space` | ✓ | — | Space name (e.g. spaces/AAAA...) |
| `--text` | ✓ | — | Message text (plain text) |

## Examples

```bash
gws chat +send --space spaces/AAAAxxxx --text 'Hello team!'
```

## Tips

- Use `gws chat spaces list` to find space names.
- For cards or threaded replies, use the raw API.

> [!CAUTION]
> This is a **write** command — confirm with the user before executing.
