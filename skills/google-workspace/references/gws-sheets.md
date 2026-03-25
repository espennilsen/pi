# sheets (v4)

> **PREREQUISITE:** See [gws-shared.md](gws-shared.md) for auth, global flags, and security rules.

```bash
gws sheets <resource> <method> [flags]
```

## Helper Commands

| Command | Description |
|---------|-------------|
| `+append` | Append a row — see [gws-sheets-append.md](gws-sheets-append.md) |
| `+read` | Read values — see [gws-sheets-read.md](gws-sheets-read.md) |

## API Resources

### spreadsheets
- `batchUpdate` — Applies one or more updates to the spreadsheet.
- `create` — Creates a spreadsheet, returning the newly created spreadsheet.
- `get` — Returns the spreadsheet at the given ID.
- `getByDataFilter` — Returns the spreadsheet using data filters.
- `developerMetadata` — Operations on developer metadata.
- `sheets` — Operations on sheets.
- `values` — Operations on values.

## Discovering Commands

```bash
gws sheets --help
gws schema sheets.<resource>.<method>
```
