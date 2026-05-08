# @e9n/pi-gondolin

Secure-by-default [Gondolin](https://github.com/earendil-works/gondolin) micro-VM sandbox for Pi. When loaded, the extension overrides Pi's `read`, `write`, `edit`, and `bash` tools so file and shell operations run inside a VM instead of directly on the host.

## Features

- Enabled by default when the extension is loaded
- Opt out per run with `--no-gondolin`
- Mounts the current working directory at the same absolute path inside the VM
- Supports extra host path mounts via CLI flag and `settings.json`
- Runs user `!` shell commands inside the VM too
- Keeps Pi's normal tool UI/rendering by reusing the built-in tool implementations
- Stops the VM on session shutdown/reload

## Requirements

- QEMU and any Gondolin runtime requirements installed on the host
- Pi extension runtime with `@mariozechner/pi-coding-agent`

Install package dependencies from this extension directory:

```bash
npm install
```

## Usage

Load the extension normally. Sandboxing is enabled by default:

```bash
pi
```

Opt out for a session:

```bash
pi --no-gondolin
```

Mount extra paths at the same absolute path inside the VM:

```bash
pi --gondolin-mounts "/Users/espen/.npm,/Users/espen/.cache"
```

Mount a host path at a different guest path:

```bash
pi --gondolin-mounts "/Users/espen/shared:/mnt/shared"
```

## Settings

Add settings under `pi-gondolin` in global `~/.pi/agent/settings.json` or project `.pi/settings.json`:

```json
{
  "pi-gondolin": {
    "enabled": true,
    "eagerStart": true,
    "mounts": [
      "/Users/espen/.npm",
      { "host": "/Users/espen/shared", "guest": "/mnt/shared" }
    ]
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Enable Gondolin sandboxing when the extension is loaded. `--no-gondolin` overrides this. |
| `eagerStart` | `true` | Start the VM during `session_start` so startup errors are visible early. If `false`, the VM starts on first tool use. |
| `mounts` | `[]` | Extra mounts. Strings mount the same host path at the same guest path. Objects support `{ "host": "...", "guest": "..." }`. |

CLI `--gondolin-mounts` entries are appended to settings mounts.

## Path model

The current working directory is mirrored into the VM at the same absolute path. If Pi starts in:

```text
/Users/espen/Dev/my-project
```

then the VM also sees that project at:

```text
/Users/espen/Dev/my-project
```

Tool paths must stay within the cwd mount or one of the configured extra mounts. Access outside mounted paths fails instead of falling back to the host.

## License

MIT
