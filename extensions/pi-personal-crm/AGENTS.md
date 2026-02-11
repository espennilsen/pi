# Agent Integration Guide

## Install as pi package

```bash
# Local path
pi install /path/to/pi-personal-crm

# Or from npm (once published)
pi install npm:pi-personal-crm

# Or test without installing
pi -e /path/to/pi-personal-crm/src/index.ts
```

The extension auto-discovers and loads via the `pi` manifest in `package.json`.

## What it provides

**Tool:** `crm` — 16 actions for contact management, searchable by the agent.

**Commands:**
- `/crm-web [port|stop|status]` — Start/stop a standalone web UI on localhost
- `/crm-export` — Export contacts to CSV file
- `/crm-import path.csv` — Import contacts from CSV

**pi-webserver integration:** If [pi-webserver](https://github.com/espennilsen/pi-webserver) is installed, the CRM auto-mounts at `/crm` on the shared web server (no extra setup needed). Use `/web` to start the shared server, then visit `http://localhost:4100/crm/`. The standalone `/crm-web` command still works independently.

**System prompt:** The agent receives CRM workflow instructions automatically via `before_agent_start`.

**Database:** Self-contained SQLite at `~/.pi/agent/crm/crm.db`. Migrations run automatically.

## Project-local installation

Add to `.pi/settings.json`:

```json
{
  "packages": ["/path/to/pi-personal-crm"]
}
```

Pi will auto-install on startup.

## Extending the CRM

Other pi extensions can import from this package:

```typescript
import { crmApi } from "pi-personal-crm/src/db.ts";
import { crmRegistry } from "pi-personal-crm/src/registry.ts";

// Use the API
const contacts = crmApi.getContacts();

// Listen to events
crmRegistry.on("contact.created", async (contact) => {
  // Custom logic
});
```

### Extension fields

Third-party extensions can attach read-only fields to contacts (displayed in the web UI but not editable there):

```typescript
import { crmApi } from "pi-personal-crm/src/db.ts";

// Write fields (upsert — safe to call repeatedly)
crmApi.setExtensionField({
  contact_id: 42,
  source: "linkedin",          // your extension name
  field_name: "headline",
  field_value: "Senior Engineer at Acme",
  label: "LinkedIn Headline",  // optional display label
  field_type: "text",          // "text" | "url" | "date" | "number" | "json"
});

// Read back
const fields = crmApi.getExtensionFields(42);
const linkedinFields = crmApi.getExtensionFieldsBySource(42, "linkedin");

// Clean up
crmApi.deleteExtensionFields(42, "linkedin");
```

The same API is available for companies:

```typescript
crmApi.setCompanyExtensionField({
  company_id: 5,
  source: "clearbit",
  field_name: "employee_count",
  field_value: "250",
  label: "Employees",
  field_type: "number",
});

const coFields = crmApi.getCompanyExtensionFields(5);
crmApi.deleteCompanyExtensionFields(5, "clearbit");
```

REST API equivalents:
- `GET  /api/crm/contacts/:id/extension-fields[?source=...]`
- `PUT  /api/crm/contacts/:id/extension-fields` (body: `{ source, field_name, field_value, label?, field_type? }`)
- `DELETE /api/crm/contacts/:id/extension-fields?source=...`
- `GET  /api/crm/companies/:id/extension-fields[?source=...]`
- `PUT  /api/crm/companies/:id/extension-fields` (body: `{ source, field_name, field_value, label?, field_type? }`)
- `DELETE /api/crm/companies/:id/extension-fields?source=...`
