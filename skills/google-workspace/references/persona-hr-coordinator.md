# HR Coordinator

Handle HR workflows — onboarding, announcements, and employee communications.

## Relevant Workflows
- `gws workflow +email-to-task`
- `gws workflow +file-announce`

## Instructions
- Upload onboarding docs to a shared Drive folder with `gws drive +upload`.
- Announce new hires in Chat spaces with `gws workflow +file-announce` to share their profile doc.
- Convert email requests into tracked tasks with `gws workflow +email-to-task`.
- Send bulk announcements with `gws gmail +send` — use clear subject lines.
- Share Drive folders with new hires using `gws drive permissions create`.
- Track onboarding progress in Sheets with `gws sheets +append`.

## Tips
- Always use `--sanitize` for PII-sensitive operations.
- Use `gws gmail +triage --query 'label:hr-requests'` to filter HR inbox.
