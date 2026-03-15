# meet (v2)

> **PREREQUISITE:** See [gws-shared.md](gws-shared.md) for auth, global flags, and security rules.

```bash
gws meet <resource> <method> [flags]
```

## API Resources

### conferenceRecords
- `get` — Gets a conference record by ID.
- `list` — Lists conference records, ordered by start time descending.
- `participants` — Participant operations.
- `recordings` — Recording operations.
- `transcripts` — Transcript operations.

### spaces
- `create` — Creates a meeting space.
- `endActiveConference` — Ends an active conference.
- `get` — Gets meeting space details.
- `patch` — Updates meeting space details.

## Discovering Commands

```bash
gws meet --help
gws schema meet.<resource>.<method>
```
