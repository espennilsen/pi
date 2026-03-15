---
name: google-workspace
description: >
  Manage Google Workspace via the gws CLI — Drive, Gmail, Sheets, Docs, Slides,
  People, Chat, Meet, Forms, and cross-service workflows. Use when asked to
  send email, read/write spreadsheets, upload files to Drive, manage contacts,
  create presentations, send Chat messages, create docs, or any Google Workspace
  operation. Also triggers on "gws", "Google Drive", "Google Sheets", "Gmail",
  "Google Docs", "Google Slides", "Google Chat", "Google Meet", "Google Forms",
  "check my inbox", "upload to Drive", "read spreadsheet", "send an email",
  "create a doc", "send a chat message", "create a presentation".
---

# Google Workspace CLI (`gws`)

Interact with Google Workspace services via the `gws` CLI. This skill covers
all supported services, helper shortcuts, cross-service workflows, role-based
personas, and multi-step recipes.

## Installation & Auth

The `gws` binary must be on `$PATH`. Version: 0.16.0+.

```bash
# Browser-based OAuth (interactive)
gws auth login

# Service Account
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json

# Check status
gws auth status
```

### Auth Flags

| Flag | Description |
|------|-------------|
| `--readonly` | Request read-only scopes |
| `--full` | Request all scopes incl. pubsub + cloud-platform |
| `--scopes` | Comma-separated custom scopes |
| `-s, --services` | Limit scope picker to specific services (e.g. `-s drive,gmail`) |

## CLI Syntax

```bash
gws <service> <resource> [sub-resource] <method> [flags]
```

### Global Flags

| Flag | Description |
|------|-------------|
| `--format <FMT>` | Output format: `json` (default), `table`, `yaml`, `csv` |
| `--dry-run` | Validate locally without calling the API |
| `--sanitize <TEMPLATE>` | Screen responses through Model Armor |
| `--params '{"key": "val"}'` | URL/query parameters |
| `--json '{"key": "val"}'` | Request body |
| `-o, --output <PATH>` | Save binary responses to file |
| `--upload <PATH>` | Upload file content (multipart) |
| `--page-all` | Auto-paginate (NDJSON output) |
| `--page-limit <N>` | Max pages with --page-all (default: 10) |
| `--page-delay <MS>` | Delay between pages in ms (default: 100) |

### Discovering Commands

```bash
gws <service> --help                    # Browse resources and methods
gws schema <service.resource.method>    # Inspect params, types, defaults
```

## Shell Tips

- **zsh `!` expansion:** Use double quotes for sheet ranges: `--range "Sheet1!A1:D10"`
- **JSON with double quotes:** Wrap `--params`/`--json` in single quotes: `--params '{"pageSize": 5}'`

## Security Rules

- **Never** output secrets (API keys, tokens) directly
- **Always** confirm with user before executing write/delete commands
- Prefer `--dry-run` for destructive operations
- Use `--sanitize` for PII/content safety screening

## Services

Core Google Workspace API skills. Read the reference file for full resource/method details.

| Service | Description | Reference |
|---------|-------------|-----------|
| Drive | Manage files, folders, shared drives | [references/gws-drive.md](references/gws-drive.md) |
| Sheets | Read and write spreadsheets | [references/gws-sheets.md](references/gws-sheets.md) |
| Gmail | Send, read, and manage email | [references/gws-gmail.md](references/gws-gmail.md) |
| Docs | Read and write Google Docs | [references/gws-docs.md](references/gws-docs.md) |
| Slides | Read and write presentations | [references/gws-slides.md](references/gws-slides.md) |
| People | Manage contacts and profiles | [references/gws-people.md](references/gws-people.md) |
| Chat | Manage Chat spaces and messages | [references/gws-chat.md](references/gws-chat.md) |
| Meet | Manage Google Meet conferences | [references/gws-meet.md](references/gws-meet.md) |
| Forms | Read and write Google Forms | [references/gws-forms.md](references/gws-forms.md) |
| Admin Reports | Audit logs and usage reports | [references/gws-admin-reports.md](references/gws-admin-reports.md) |
| Events | Subscribe to Workspace events | [references/gws-events.md](references/gws-events.md) |
| Keep | Manage Google Keep notes | [references/gws-keep.md](references/gws-keep.md) |
| Model Armor | Filter content for safety | [references/gws-modelarmor.md](references/gws-modelarmor.md) |
| Workflow | Cross-service productivity workflows | [references/gws-workflow.md](references/gws-workflow.md) |

## Helper Shortcuts

Quick commands for common operations. Read the reference file for flags and examples.

### Drive
| Command | Reference |
|---------|-----------|
| `gws drive +upload <file>` | [references/gws-drive-upload.md](references/gws-drive-upload.md) |

### Sheets
| Command | Reference |
|---------|-----------|
| `gws sheets +read --spreadsheet ID --range RANGE` | [references/gws-sheets-read.md](references/gws-sheets-read.md) |
| `gws sheets +append --spreadsheet ID --values '...'` | [references/gws-sheets-append.md](references/gws-sheets-append.md) |

### Gmail
| Command | Reference |
|---------|-----------|
| `gws gmail +send --to EMAIL --subject S --body B` | [references/gws-gmail-send.md](references/gws-gmail-send.md) |
| `gws gmail +triage` | [references/gws-gmail-triage.md](references/gws-gmail-triage.md) |
| `gws gmail +reply --message-id ID --body TEXT` | [references/gws-gmail-reply.md](references/gws-gmail-reply.md) |
| `gws gmail +reply-all --message-id ID --body TEXT` | [references/gws-gmail-reply-all.md](references/gws-gmail-reply-all.md) |
| `gws gmail +forward --message-id ID --to EMAIL` | [references/gws-gmail-forward.md](references/gws-gmail-forward.md) |
| `gws gmail +watch` | [references/gws-gmail-watch.md](references/gws-gmail-watch.md) |

### Docs
| Command | Reference |
|---------|-----------|
| `gws docs +write --document ID --text TEXT` | [references/gws-docs-write.md](references/gws-docs-write.md) |

### Chat
| Command | Reference |
|---------|-----------|
| `gws chat +send --space NAME --text TEXT` | [references/gws-chat-send.md](references/gws-chat-send.md) |

### Events
| Command | Reference |
|---------|-----------|
| `gws events +subscribe` | [references/gws-events-subscribe.md](references/gws-events-subscribe.md) |
| `gws events +renew` | [references/gws-events-renew.md](references/gws-events-renew.md) |

### Model Armor
| Command | Reference |
|---------|-----------|
| `gws modelarmor +sanitize-prompt --template NAME` | [references/gws-modelarmor-sanitize-prompt.md](references/gws-modelarmor-sanitize-prompt.md) |
| `gws modelarmor +sanitize-response --template NAME` | [references/gws-modelarmor-sanitize-response.md](references/gws-modelarmor-sanitize-response.md) |
| `gws modelarmor +create-template --project P --location L --template-id ID` | [references/gws-modelarmor-create-template.md](references/gws-modelarmor-create-template.md) |

### Workflow
| Command | Reference |
|---------|-----------|
| `gws workflow +standup-report` | [references/gws-workflow-standup-report.md](references/gws-workflow-standup-report.md) |
| `gws workflow +meeting-prep` | [references/gws-workflow-meeting-prep.md](references/gws-workflow-meeting-prep.md) |
| `gws workflow +email-to-task --message-id ID` | [references/gws-workflow-email-to-task.md](references/gws-workflow-email-to-task.md) |
| `gws workflow +weekly-digest` | [references/gws-workflow-weekly-digest.md](references/gws-workflow-weekly-digest.md) |
| `gws workflow +file-announce --file-id ID --space SPACE` | [references/gws-workflow-file-announce.md](references/gws-workflow-file-announce.md) |

## Personas

Role-based skill bundles for common workflows. Read the reference for instructions.

| Persona | Description | Reference |
|---------|-------------|-----------|
| Executive Assistant | Schedule, inbox, and communications | [references/persona-exec-assistant.md](references/persona-exec-assistant.md) |
| Project Manager | Tasks, meetings, and doc sharing | [references/persona-project-manager.md](references/persona-project-manager.md) |
| Team Lead | Standups, coordination, and comms | [references/persona-team-lead.md](references/persona-team-lead.md) |
| Sales Operations | Deal tracking, calls, client comms | [references/persona-sales-ops.md](references/persona-sales-ops.md) |
| Content Creator | Create, organize, distribute content | [references/persona-content-creator.md](references/persona-content-creator.md) |
| Event Coordinator | Scheduling, invitations, logistics | [references/persona-event-coordinator.md](references/persona-event-coordinator.md) |
| Customer Support | Tickets, responses, escalation | [references/persona-customer-support.md](references/persona-customer-support.md) |
| HR Coordinator | Onboarding, announcements, comms | [references/persona-hr-coordinator.md](references/persona-hr-coordinator.md) |
| IT Administrator | Security monitoring, configuration | [references/persona-it-admin.md](references/persona-it-admin.md) |
| Researcher | References, notes, collaboration | [references/persona-researcher.md](references/persona-researcher.md) |

## Recipes

Multi-step task sequences with real commands. Read the reference for step-by-step instructions.

### Gmail Recipes
| Recipe | Reference |
|--------|-----------|
| Label and archive emails | [references/recipe-label-and-archive-emails.md](references/recipe-label-and-archive-emails.md) |
| Create Gmail filter | [references/recipe-create-gmail-filter.md](references/recipe-create-gmail-filter.md) |
| Forward labeled emails | [references/recipe-forward-labeled-emails.md](references/recipe-forward-labeled-emails.md) |
| Set vacation responder | [references/recipe-create-vacation-responder.md](references/recipe-create-vacation-responder.md) |
| Save email attachments to Drive | [references/recipe-save-email-attachments.md](references/recipe-save-email-attachments.md) |
| Save email to Google Doc | [references/recipe-save-email-to-doc.md](references/recipe-save-email-to-doc.md) |
| Draft email from Doc | [references/recipe-draft-email-from-doc.md](references/recipe-draft-email-from-doc.md) |

### Drive Recipes
| Recipe | Reference |
|--------|-----------|
| Organize Drive folder | [references/recipe-organize-drive-folder.md](references/recipe-organize-drive-folder.md) |
| Share folder with team | [references/recipe-share-folder-with-team.md](references/recipe-share-folder-with-team.md) |
| Email a Drive link | [references/recipe-email-drive-link.md](references/recipe-email-drive-link.md) |
| Bulk download folder | [references/recipe-bulk-download-folder.md](references/recipe-bulk-download-folder.md) |
| Find large files | [references/recipe-find-large-files.md](references/recipe-find-large-files.md) |
| Create shared drive | [references/recipe-create-shared-drive.md](references/recipe-create-shared-drive.md) |
| Watch Drive changes | [references/recipe-watch-drive-changes.md](references/recipe-watch-drive-changes.md) |

### Sheets Recipes
| Recipe | Reference |
|--------|-----------|
| Create expense tracker | [references/recipe-create-expense-tracker.md](references/recipe-create-expense-tracker.md) |
| Copy sheet for new month | [references/recipe-copy-sheet-for-new-month.md](references/recipe-copy-sheet-for-new-month.md) |
| Log deal update | [references/recipe-log-deal-update.md](references/recipe-log-deal-update.md) |
| Compare sheet tabs | [references/recipe-compare-sheet-tabs.md](references/recipe-compare-sheet-tabs.md) |
| Backup sheet as CSV | [references/recipe-backup-sheet-as-csv.md](references/recipe-backup-sheet-as-csv.md) |
| Sync contacts to sheet | [references/recipe-sync-contacts-to-sheet.md](references/recipe-sync-contacts-to-sheet.md) |
| Generate report from sheet | [references/recipe-generate-report-from-sheet.md](references/recipe-generate-report-from-sheet.md) |

### Cross-Service Recipes
| Recipe | Reference |
|--------|-----------|
| Create doc from template | [references/recipe-create-doc-from-template.md](references/recipe-create-doc-from-template.md) |
| Share doc and notify | [references/recipe-share-doc-and-notify.md](references/recipe-share-doc-and-notify.md) |
| Send team announcement | [references/recipe-send-team-announcement.md](references/recipe-send-team-announcement.md) |
| Create feedback form | [references/recipe-create-feedback-form.md](references/recipe-create-feedback-form.md) |
| Create Meet space | [references/recipe-create-meet-space.md](references/recipe-create-meet-space.md) |
| Review Meet participants | [references/recipe-review-meet-participants.md](references/recipe-review-meet-participants.md) |
| Create presentation | [references/recipe-create-presentation.md](references/recipe-create-presentation.md) |
| Collect form responses | [references/recipe-collect-form-responses.md](references/recipe-collect-form-responses.md) |
| Create classroom course | [references/recipe-create-classroom-course.md](references/recipe-create-classroom-course.md) |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | API error — Google returned an error response |
| 2 | Auth error — credentials missing or invalid |
| 3 | Validation — bad arguments or input |
| 4 | Discovery — could not fetch API schema |
| 5 | Internal — unexpected failure |

## Community & Feedback

- Star the repo: https://github.com/googleworkspace/cli
- Bugs / feature requests: https://github.com/googleworkspace/cli/issues
- Always search existing issues before creating new ones
