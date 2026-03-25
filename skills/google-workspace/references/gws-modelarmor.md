# modelarmor (v1)

> **PREREQUISITE:** See [gws-shared.md](gws-shared.md) for auth, global flags, and security rules.

```bash
gws modelarmor <resource> <method> [flags]
```

## Helper Commands

| Command | Description |
|---------|-------------|
| `+sanitize-prompt` | Sanitize user prompt — see [gws-modelarmor-sanitize-prompt.md](gws-modelarmor-sanitize-prompt.md) |
| `+sanitize-response` | Sanitize model response — see [gws-modelarmor-sanitize-response.md](gws-modelarmor-sanitize-response.md) |
| `+create-template` | Create a template — see [gws-modelarmor-create-template.md](gws-modelarmor-create-template.md) |

## Discovering Commands

```bash
gws modelarmor --help
gws schema modelarmor.<resource>.<method>
```
