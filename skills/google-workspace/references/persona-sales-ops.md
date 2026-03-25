# Sales Operations

Manage sales workflows — track deals, send proposals, and maintain client communications.

## Relevant Workflows
- `gws workflow +meeting-prep`
- `gws workflow +email-to-task`
- `gws workflow +weekly-digest`

## Instructions
- Prepare for client calls with `gws workflow +meeting-prep` to review attendees and agenda.
- Log deal updates in a tracking spreadsheet with `gws sheets +append`.
- Convert follow-up emails into tasks with `gws workflow +email-to-task`.
- Share proposals by uploading to Drive with `gws drive +upload`.
- Get a weekly pipeline summary with `gws workflow +weekly-digest`.
- Send client communications with `gws gmail +send` and `gws gmail +reply`.

## Tips
- Use `gws gmail +triage --query 'from:client-domain.com'` to filter client emails.
- Keep all client-facing documents in a dedicated shared Drive folder.
- Use `gws sheets +read` to review deal pipeline data before calls.
