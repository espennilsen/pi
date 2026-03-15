# slides (v1)

> **PREREQUISITE:** See [gws-shared.md](gws-shared.md) for auth, global flags, and security rules.

```bash
gws slides <resource> <method> [flags]
```

## API Resources

### presentations
- `batchUpdate` — Applies one or more updates to the presentation.
- `create` — Creates a blank presentation.
- `get` — Gets the latest version of the specified presentation.
- `pages` — Operations on pages.

## Discovering Commands

```bash
gws slides --help
gws schema slides.<resource>.<method>
```
