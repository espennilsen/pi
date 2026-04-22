---
name: bot-status
description: |
  Generate a full operational status report for the Aivena bot. Checks all subsystems: extensions, webserver, Telegram, chat bridge, heartbeat, cron, database, memory, CRM, calendar, task management, jobs/telemetry, and storage.

  **Triggers — use this skill when:**
  - User asks for "status", "bot status", "system status", "operational status"
  - User asks "is everything running?", "how's Aivena doing?"
  - User says "health check", "diagnostics", "systems check"
  - User asks "what's the state of the bot?"
---

# Bot Status Skill

Generate a comprehensive operational status report for the Aivena bot, covering every subsystem.

## Report Structure

Produce all sections in order. Use status icons consistently:
- ✅ healthy / running / OK
- ⚠️ degraded / warning
- ❌ down / error / missing
- ⏳ unknown / checking
- 📊 informational metric

---

### 1. Overview

Show:
- Bot name, version (from package.json if available)
- Current branch and git status (clean/dirty, uncommitted count)
- Uptime context: when the current pi session started (from jobs tool if available)
- Current date/time

### 2. Extensions

Check both extension directories for installed extensions:

- **Workspace extensions:** `.pi/extensions/`
- **Global extensions:** `~/.pi/agent/extensions/`

```bash
ls -1 .pi/extensions/ 2>/dev/null
ls -1 ~/.pi/agent/extensions/ 2>/dev/null
```

For each extension found, read its `package.json` to get the version:

```bash
cat .pi/extensions/<name>/package.json 2>/dev/null | grep '"version"'
cat ~/.pi/agent/extensions/<name>/package.json 2>/dev/null | grep '"version"'
```

Report each extension with its source (workspace or global), version, and whether it's a symlink.

If an extension appears in both locations, note it — workspace takes precedence.

Format as a compact table:
```
Extensions (16 loaded)
  Workspace (.pi/extensions/):
    ✅ pi-calendar        0.1.0  (symlink)
    ✅ pi-channels        0.1.0  (symlink)
  Global (~/.pi/agent/extensions/):
    ✅ pi-memory           0.2.1  (symlink)
    ✅ pi-jobs             0.1.0  (symlink)
    ...
```

### 3. Webserver

Check if the pi-webserver is responding:

```bash
curl -s --connect-timeout 5 --max-time 10 -o /dev/null -w "%{http_code}" http://localhost:4110/ 2>/dev/null
```

Report:
- HTTP status code
- Port (from `.pi/settings.json` → `pi-webserver.port`)
- Whether autostart is enabled

Format:
```
Webserver
  ✅ Responding on port 4110 (HTTP 200)
  Autostart: enabled
```

If unreachable:
```
Webserver
  ❌ Not responding on port 4110
```

### 4. Telegram & Chat Bridge

Read `.pi/settings.json` → `pi-channels` config and report:

- **Telegram adapter**: configured ✅/❌, polling enabled, allowed chat IDs
- **Chat bridge**: enabled ✅/❌, max queue, timeout, max concurrent
- **Routes**: list all configured routes (name → adapter → recipient)

Do NOT print the bot token — just confirm it's set (e.g., "Bot token: configured ✅").

Format:
```
Telegram & Chat Bridge
  Telegram adapter: ✅ configured
    Bot token: set
    Polling: enabled (30s timeout)
    Allowed chats: 1 configured
  Chat bridge: ✅ enabled
    Max queue: 5/sender, timeout: 300s, concurrency: 2
  Routes:
    ops  → telegram → chat 5991...451
    cron → telegram → chat 5991...451
```

### 5. Heartbeat

Read `.pi/settings.json` → `pi-heartbeat` config:
- Enabled/disabled
- Interval
- Active hours
- Route

Format:
```
Heartbeat
  ✅ Enabled — every 60min, 08:00–22:00
  Route: ops
  Autostart: enabled
```

### 6. Cron Jobs

Use the `cron` tool (action: list) to show all scheduled jobs:
- Job name, schedule, enabled/disabled, last run

If no jobs:
```
Cron Jobs
  ⚠️ No cron jobs configured
```

### 7. Database

Check the SQLite database (managed by pi-kysely at `.pi/db/aivena.db`):

```bash
# Size
du -sh .pi/db/aivena.db

# Tables
sqlite3 -readonly .pi/db/aivena.db "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"

# Row counts for key tables (robust against missing tables)
for table in contacts interactions companies reminders; do
  count=$(sqlite3 -readonly .pi/db/aivena.db "SELECT CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='$table') THEN (SELECT COUNT(*) FROM $table) ELSE 0 END" 2>/dev/null)
  echo "$table: ${count:-0}"
done
```

If the database is empty (0 bytes) or has no tables, note it:
```
Database
  ⚠️ aivena.db exists but is empty (0 bytes)
```

If populated:
```
Database (.pi/db/aivena.db — 156KB)
  Tables: contacts, interactions, companies, reminders, ...
  CRM: 12 contacts, 34 interactions, 5 companies, 3 reminders
```

### 8. Memory System

Check memory health:

```bash
# Long-term memory
wc -l < MEMORY.md 2>/dev/null
wc -c < MEMORY.md 2>/dev/null

# Daily logs
ls -1 .pi/memory/ 2>/dev/null | wc -l
ls -lt .pi/memory/ 2>/dev/null | head -3
```

Also use `memory_read` (target: long_term) to verify it's readable, and `memory_read` (target: list) to count daily logs.

Format:
```
Memory
  ✅ MEMORY.md: 142 lines, 4.2KB
  📊 Daily logs: 8 files
  Latest: 2026-02-12
```

### 9. CRM

Use the `crm` tool to check:
- `crm search` with a broad query to count contacts
- `crm upcoming` to show upcoming reminders
- `crm list_companies` to count companies

Format:
```
CRM
  ✅ Operational
  📊 15 contacts, 7 companies
  Upcoming: 2 reminders in next 7 days
```

Or if empty:
```
CRM
  ⚠️ No contacts yet
```

### 10. Calendar

Use the `calendar` tool:
- `calendar today` — today's events
- `calendar upcoming` — next 7 days

Format:
```
Calendar
  Today: 2 events
    10:00 — Team standup
    14:00 — Client call
  Next 7 days: 5 events
```

Or:
```
Calendar
  Today: no events
  Next 7 days: no events
```

### 11. Task Management (td)

```bash
td next 2>/dev/null
td reviewable 2>/dev/null
td list --status open 2>/dev/null | head -20
td list --status in_progress 2>/dev/null | head -10
td list --status in_review 2>/dev/null | head -10
```

Format:
```
Task Management
  📊 Open: 12 issues, In progress: 2, In review: 3
  Next up: td-abc123 "Some important task" (P1)
  Reviewable: td-def456, td-ghi789
```

### 12. Jobs & Telemetry

Use the `jobs` tool:
- `jobs stats` — overall statistics
- `jobs recent` (limit: 5) — recent runs

Format:
```
Jobs & Telemetry
  📊 Total runs: 245, Errors: 3 (1.2%)
  Avg duration: 28.4s
  Total cost: $1.23
  Recent:
    12:05 — tui — 34s — success
    11:42 — cron — 12s — success
    11:00 — heartbeat — 45s — success
```

### 13. Storage

```bash
du -sh .pi/db/aivena.db
du -sh .pi/memory/
du -sh log/
du -sh .todos/
du -sh .pi/extensions/
# Total workspace size (excluding node_modules, .git)
du -sh --exclude=node_modules --exclude=.git . 2>/dev/null || du -sh . 2>/dev/null
```

Format:
```
Storage
  aivena.db:     156KB
  Memory:        12KB
  Logs:          48KB
  Tasks (.todos): 8KB
  Extensions:    2.1MB
  Workspace:     3.4MB
```

### 14. Configuration Validation

Cross-check `.pi/settings.json` for:
- All referenced adapters exist in the config
- Routes reference valid adapters
- Required fields are present (bot token set, ports defined)
- No obvious misconfigurations

```
Config Validation
  ✅ All routes reference valid adapters
  ✅ Webserver port configured
  ✅ Bot token present
  ⚠️ pi-cron in settings but extension not found
```

### 15. Summary & Health Score

Aggregate all checks into a health score:

```
Health Score: 12/14 checks passing

Summary:
  Aivena is operational with 13 extensions loaded. Telegram bridge and
  webserver are responding. No cron jobs configured — consider adding
  scheduled tasks. Database is empty — CRM not yet populated.

Action Items:
  1. ⚠️ Configure cron jobs for recurring tasks
  2. ⚠️ Populate CRM with initial contacts
  3. ✅ All core systems operational
```

---

## Formatting Guidelines

- **NEVER** wrap output in triple-backtick code fences — use plain text with Unicode
- Use em-dash (—) for inline descriptions
- Keep compact but comprehensive
- Mask sensitive data (tokens, keys) — show only "configured ✅" or first/last 4 chars
- Status icons: ✅ ⚠️ ❌ 📊
- Section headers in bold

## Execution Order

Run all independent checks in parallel where possible (e.g., curl + sqlite + td can all run concurrently). Group tool calls that don't depend on each other.

## Security

- Never print full bot tokens, API keys, or secrets
- Use `-readonly` flag for SQLite queries
- Don't modify any state — this is a read-only diagnostic
