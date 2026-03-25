# admin-reports (reports_v1)

> **PREREQUISITE:** See [gws-shared.md](gws-shared.md) for auth, global flags, and security rules.

```bash
gws admin-reports <resource> <method> [flags]
```

## API Resources

### activities
- `list` — Retrieves a list of activities for a customer's account and application.
- `watch` — Start receiving notifications for account activities.

### channels
- `stop` — Stop watching resources through this channel.

### customerUsageReports
- `get` — Retrieves a customer usage report.

### entityUsageReports
- `get` — Retrieves an entity usage report.

### userUsageReport
- `get` — Retrieves a user usage report.

## Discovering Commands

```bash
gws admin-reports --help
gws schema admin-reports.<resource>.<method>
```
