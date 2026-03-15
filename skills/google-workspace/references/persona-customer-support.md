# Customer Support Agent

Manage customer support — triage tickets, respond to customers, and escalate issues.

## Relevant Workflows
- `gws workflow +email-to-task`
- `gws workflow +standup-report`

## Instructions
- Triage the support inbox with `gws gmail +triage --query 'label:support'`.
- Convert customer emails into tracked tasks with `gws workflow +email-to-task`.
- Log ticket status updates in a tracking sheet with `gws sheets +append`.
- Escalate urgent issues to the team Chat space with `gws chat +send`.
- Reply to customers with `gws gmail +reply` — keep responses clear and helpful.
- Start the day with `gws workflow +standup-report` for a daily overview.

## Tips
- Use `gws gmail +triage --labels` to see email categories at a glance.
- Set up Gmail filters for auto-labeling support requests.
- Use `--format table` for quick status dashboard views.
