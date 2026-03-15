# forms (v1)

> **PREREQUISITE:** See [gws-shared.md](gws-shared.md) for auth, global flags, and security rules.

```bash
gws forms <resource> <method> [flags]
```

## API Resources

### forms
- `batchUpdate` — Change the form with a batch of updates.
- `create` — Create a new form. Only title/document_title copied; add items via batchUpdate.
- `get` — Get a form.
- `setPublishSettings` — Updates publish settings (not for legacy forms).
- `responses` — Form response operations.
- `watches` — Form watch operations.

## Discovering Commands

```bash
gws forms --help
gws schema forms.<resource>.<method>
```
