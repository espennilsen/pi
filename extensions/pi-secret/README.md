# pi-secret

`pi-secret` is a host-side secret broker for Pi Coding Agent extensions. It stores secrets in the OS keychain through [`cross-keychain`](https://www.npmjs.com/package/cross-keychain) and exposes a narrow dependency-injection API for trusted first-party extensions.

It intentionally does **not** register any LLM-callable tool that returns raw secrets.

## Trust model

Pi extensions run host-side with the user's permissions. Some extensions also register tools that the model can call. If a secret manager exposed a normal `get_secret` tool, the plaintext value would become a tool result and could enter the LLM context, logs, or transcripts.

`pi-secret` therefore works as a broker/library:

- admin commands can set, delete, and list configured secret names
- raw values are never shown in command output
- consuming extensions call `globalThis.__piSecret` from host-side code
- access is checked against an explicit first-party policy manifest
- cross-extension reads are denied unless allowlisted
- plaintext may exist in process memory while a trusted extension callback runs

This is designed for first-party trusted extensions. It is not a safe mechanism for arbitrary third-party extensions.

## Storage

Primary storage uses `cross-keychain` with service/account naming:

- service: `com.earendil.pi-secret`
- account: `ext:<extension-id>:secret:<secret-name>`

If the OS keychain is unavailable, `pi-secret` can fall back to JSON at:

```text
~/.pi/agents/secret.json
```

The fallback store is outside the normal project cwd, uses strict path handling, rejects symlinked secret files, writes atomically, and forces `chmod 600` for the file (`0700` for the directory). It is still less secure than the OS keychain because plaintext exists on disk. Disable it with SettingsManager if you require keychain-only operation.

## SettingsManager configuration

Configure under the `pi-secret` key in Pi settings. Global settings are merged with project settings using Pi's `SettingsManager`; no extension configuration is read from environment variables.

```json
{
  "pi-secret": {
    "allowFallback": true,
    "fallbackFile": "~/.pi/agents/secret.json",
    "policy": {
      "extensions": {
        "my-first-party-extension": {
          "secrets": ["api_key"],
          "rawSecretAccess": ["api_key"]
        }
      }
    }
  }
}
```

The built-in policy includes:

- `elevenlabs-extension`: `api_key`, `voice_id`
- `github-extension`: `token`

Cross-extension access is denied by default. To allow it, add a secret-specific allowlist:

```json
{
  "pi-secret": {
    "policy": {
      "extensions": {
        "github-extension": {
          "secrets": ["token"],
          "rawSecretAccess": ["token"],
          "allowRequesters": {
            "token": ["trusted-release-extension"]
          }
        }
      }
    }
  }
}
```

## Commands

These commands are for user/admin management. They never print plaintext secret values.

```text
/pi-secret-set <extension> <name>
/pi-secret-delete <extension> <name>
/pi-secret-list
```

`/pi-secret-set` prompts for the value separately instead of accepting it as an argument. Do not paste secrets into normal prompts, shell commands, `.env`, or project files.

## Consuming from another extension

Load order matters: `pi-secret` must be loaded before an extension tries to read `globalThis.__piSecret`. In auto-discovered extension directories, keep `pi-secret` installed and either:

1. read `globalThis.__piSecret` lazily inside command/tool/event handlers, or
2. check for it during `session_start` and show a non-secret error if unavailable.

Do not capture a missing value at module import time.

### Minimal consumer snippet

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("my-service-status", {
    description: "Check whether my service secret is configured",
    handler: async (_args, ctx) => {
      const secretApi = globalThis.__piSecret;
      if (!secretApi) {
        ctx.ui.notify("pi-secret is not loaded", "error");
        return;
      }

      const configured = await secretApi.hasSecret("elevenlabs-extension", "api_key");
      ctx.ui.notify(configured ? "API key configured" : "API key missing", "info");
    },
  });
}
```

### ElevenLabs integration using `withSecret(...)`

```ts
async function synthesizeSpeech(text: string): Promise<ArrayBuffer> {
  const secretApi = globalThis.__piSecret;
  if (!secretApi) throw new Error("pi-secret is not loaded");

  return secretApi.withSecret(
    "elevenlabs-extension",
    "api_key",
    "elevenlabs-extension",
    async (apiKey) => {
      const response = await fetch("https://api.elevenlabs.io/v1/text-to-speech/voice-id", {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error(`ElevenLabs request failed: ${response.status}`);
      return response.arrayBuffer();
    },
  ).then((result) => {
    if (!result) throw new Error("ElevenLabs API key is not configured");
    return result;
  });
}
```

### Capability-oriented service client

```ts
const client = globalThis.__piSecret?.getServiceClient("elevenlabs-extension", "elevenlabs");

await client?.withApiKey(async (apiKey) => {
  // Use apiKey only inside this host-side callback.
  // Never return it, log it, or put it in a tool result.
});
```

## API

```ts
await secretApi.setSecret(extensionId, secretName, value);
await secretApi.getSecret(extensionId, secretName, requesterExtensionId); // narrow raw accessor
await secretApi.deleteSecret(extensionId, secretName);
await secretApi.hasSecret(extensionId, secretName);
await secretApi.withSecret(extensionId, secretName, requesterExtensionId, async (value) => { ... });
await secretApi.getServiceClient(extensionId, serviceName);
```

Prefer `withSecret(...)` or a service client. Use `getSecret(...)` only for trusted first-party extensions that must integrate with APIs that cannot be wrapped cleanly.

## Audit log

`secretApi.getAuditLog()` returns a small in-memory audit log for the current process. Entries include set, delete, successful access, and denied access events. Audit entries include extension ids, secret names, requester ids, and backend names, but never plaintext values.

## Remaining risks

If an agent-exposed extension is allowed plaintext access, that extension becomes part of the secret boundary. It must never return the value in tool output, exceptions, notifications, session messages, logs, HTTP responses visible to the model, or files in the project. A malicious or buggy trusted extension can still exfiltrate secrets. Keep the policy manifest small, prefer capability-style callbacks, and deny third-party extensions by default.
