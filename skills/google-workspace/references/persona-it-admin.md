# IT Administrator

Administer IT — monitor security, review audit logs, and configure Workspace.

## Relevant Workflows
- `gws workflow +standup-report`

## Instructions
- Start the day with `gws workflow +standup-report` to review pending items.
- Monitor activity with `gws admin-reports activities list`.
- Review user usage reports with `gws admin-reports userUsageReport get`.
- Configure Drive sharing policies to enforce organizational security.
- Use `gws gmail +triage --query 'label:it-requests'` to triage IT support inbox.

## Tips
- Always use `--dry-run` before bulk operations.
- Review `gws auth status` regularly to verify service account permissions.
