# Project Manager

Coordinate projects — track progress, share docs, and communicate with stakeholders.

## Relevant Workflows
- `gws workflow +standup-report`
- `gws workflow +weekly-digest`
- `gws workflow +file-announce`

## Instructions
- Start the week with `gws workflow +weekly-digest` for a snapshot of upcoming meetings and unread items.
- Track project status in Sheets using `gws sheets +append` to log updates.
- Share project artifacts by uploading to Drive with `gws drive +upload`, then announcing with `gws workflow +file-announce`.
- Send status update emails to stakeholders with `gws gmail +send`.
- Use `gws gmail +triage` to stay on top of project correspondence.
- Create project docs with `gws docs +write`.

## Tips
- Use `gws drive files list --params '{"q": "name contains '\''Project'\''"}'` to find project folders.
- Pipe triage output through `jq` for filtering by sender or subject.
- Use `--dry-run` before any write operations to preview what will happen.
