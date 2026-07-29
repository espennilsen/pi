# pi-mobile

PWA mobile app for Pi coding agents. Mounts on pi-webserver at `/mobile`, giving you mobile control over any Pi agent.

## Screens

| Tab | Description |
|-----|-------------|
| 💬 **Chat** | Send messages with streaming responses via SSE. Type `/commands` to invoke extension commands, skills, or prompt templates |
| 📊 **Status** | Agent health, system metrics, uptime, tool count |
| 📋 **Tasks** | td issue list with filters, create/update tasks |
| 📁 **Files** | Browse workspace files, view content |
| 📜 **Logs** | Live log stream with level filters |
| ⏰ **Cron** | Manage scheduled jobs — toggle, run, view schedule |
| 🧠 **Skills** | Browse registered tools with search |
| 👥 **CRM** | Contact list with search (via pi-personal-crm) |
| 📅 **Calendar** | Upcoming events (via pi-calendar) |
| 🧩 **Extensions** | View installed extensions and their tools |
| ⚙️ **Settings** | Connection config, API key, theme |

## Setup

### 1. Install the extension

Add `pi-mobile` to your Pi extensions:

```bash
# Symlink to extensions directory
ln -s ~/Dev/pi-mobile ~/.pi/agent/extensions/pi-mobile

# Install dependencies
cd ~/.pi/agent/extensions/pi-mobile
npm install
```

Or add to `settings.json`:

```json
{
  "extensions": ["~/Dev/pi-mobile"]
}
```

### 2. Ensure pi-webserver is running

pi-mobile mounts on the shared pi-webserver. Make sure `pi-webserver` is enabled.

### 3. Access the app

```
http://localhost:<webserver-port>/mobile
```

## Install as PWA

### iOS (Safari)
1. Open `/mobile` in Safari
2. Tap **Share** (📤) → **Add to Home Screen** → **Add**

### Android (Chrome)
1. Open `/mobile` in Chrome
2. Tap **⋮** → **Install app** → **Install**

## Remote Access via Tailscale

1. Install [Tailscale](https://tailscale.com) on both devices
2. Access via Tailscale hostname:

```
http://your-machine.tail12345.ts.net:<port>/mobile
```

**Important:** Set an API key when binding to external interfaces:

```json
{
  "pi-webserver": {
    "bind": "0.0.0.0",
    "apiKey": "your-secret-key"
  }
}
```

## Architecture

```
pi-mobile/
├──
│   └── index.ts          # Extension + API endpoints + SSE broadcasting
├── public/
│   ├── app.html          # SPA — 11 Preact screens, dark theme (no build step)
│   ├── manifest.json     # PWA manifest
│   └── sw.js             # Service worker
├── package.json
├── tsconfig.json
├── AGENTS.md
└── README.md
```

### Tech Stack

- **Preact + HTM** from esm.sh CDN — no build step
- **CSS Custom Properties** — dark mode theming
- **Service Worker** — offline caching (stale-while-revalidate)
- **SSE** — real-time agent events and log streaming
- **pi-webserver** — shared HTTP server with event-bus mount system
