# @e9n/pi-personal-crm

Personal CRM extension for [pi](https://github.com/mariozechner/pi-coding-agent). Manage contacts, companies, interactions, and reminders — all from the terminal or a web dashboard.

## Features

- **Contacts** — full profiles with emails, phones, custom fields, and company association
- **Companies** — organization records with member contacts
- **Interactions** — timeline of calls, meetings, emails, notes, gifts, and messages
- **Relationships** — link contacts to each other with labeled relationships
- **Groups** — tag contacts into named groups
- **Reminders** — birthdays, anniversaries, and custom reminders with upcoming view
- **Fuzzy search** — typo-tolerant search across contacts and companies
- **Extension fields** — third-party extensions can attach read-only data to contacts/companies
- **CSV import/export** — bulk import with duplicate detection
- **Web dashboard** — 6-page UI (Contacts, Companies, Groups, Interactions, Reminders, Upcoming)

## Setup

Add to `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-personal-crm": {
    "dbPath": "db/crm.db"
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `dbPath` | `"db/crm.db"` | SQLite file path (relative to agent dir, or absolute) |
| `useKysely` | `false` | Use shared pi-kysely DB instead of local SQLite |

## Tool: `crm`

Manages all CRM entities. Pass `action` plus the relevant fields.

### Actions

| Group | Actions |
|-------|---------|
| **Contacts** | `search`, `contact`, `add_contact`, `update_contact`, `delete_contact` |
| **Interactions** | `log_interaction` |
| **Reminders** | `add_reminder`, `upcoming` |
| **Relationships** | `add_relationship` |
| **Companies** | `list_companies`, `add_company` |
| **Groups** | `list_groups`, `add_to_group`, `remove_from_group` |
| **Import/Export** | `export_csv`, `import_csv` |

### Key Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string | Action to perform (required) |
| `query` | string | Search query (for `search`) |
| `contact_id` | number | Contact ID (for `contact`, `update_contact`, `log_interaction`, `add_reminder`) |
| `name` | string | Contact name — alternative to `contact_id` for `contact` action |
| `first_name` / `last_name` | string | Contact name fields |
| `email` / `phone` | string | Primary email / phone |
| `company_name` | string | Company association |
| `interaction_type` | string | `call`, `meeting`, `email`, `note`, `gift`, `message` |
| `summary` | string | Interaction summary (required for `log_interaction`) |
| `reminder_type` | string | `birthday`, `anniversary`, `custom` |
| `reminder_date` | string | ISO date for the reminder |

## Commands

| Command | Description |
|---------|-------------|
| `/crm-web [port]` | Start standalone web UI (default port 4100) |
| `/crm-web stop` | Stop the standalone server |
| `/crm-web status` | Show whether CRM is running standalone or via pi-webserver |
| `/crm-export` | Export all contacts to `crm-contacts.csv` |
| `/crm-import <path>` | Import contacts from a CSV file |

## Web UI

The dashboard (`crm.html`) auto-mounts at `/crm` when [pi-webserver](https://github.com/espennilsen/pi) is installed. Use `/crm-web` to start a standalone server on port 4100.

## Install

```bash
pi install npm:@e9n/pi-personal-crm
```

## License

MIT
