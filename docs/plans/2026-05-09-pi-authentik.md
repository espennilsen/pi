# pi-authentik Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Build a production-ready `pi-authentik` Pi extension that signs users into authentik via OIDC PKCE, securely stores session tokens through `pi-secret`, validates and persists an OpenAI-compatible LLM base URL ending in `/v1`, dynamically discovers models from that endpoint, and registers a working Pi model provider.

**Architecture:** A flat extension at `extensions/pi-authentik/` with focused root-level modules for config, OIDC discovery/login/refresh, secure token storage, endpoint validation, model discovery/filtering, and command-driven first-run setup. The extension will register a provider after restoring or acquiring a valid token, then re-register as models refresh.

**Tech Stack:** TypeScript, Node built-in `http`, `jose`, `open`, Pi extension API, Pi SettingsManager, `pi-secret`, Node test runner or `tsx --test`.

---

### Task 1: Scaffold extension package

**Files:**
- Create: `extensions/pi-authentik/package.json`
- Create: `extensions/pi-authentik/tsconfig.json`
- Create: `extensions/pi-authentik/README.md`
- Create: `extensions/pi-authentik/.env.example`
- Create: `extensions/pi-authentik/AUTHENTIK_SETUP.md`
- Create: `extensions/pi-authentik/LLM_ENDPOINT_SETUP.md`
- Create: `extensions/pi-authentik/index.ts`
- Test: `extensions/pi-authentik/package.json` scripts run cleanly

**Step 1: Write the failing test**
Create a minimal smoke test file `extensions/pi-authentik/settings.test.ts` that imports a missing `resolveSettings()` function.

**Step 2: Run test to verify it fails**
Run: `cd extensions/pi-authentik && npm test`
Expected: FAIL because `settings.ts` or exported function does not exist yet.

**Step 3: Write minimal implementation**
Add package metadata, test/typecheck scripts, peer/dev dependencies, and a placeholder `settings.ts` + `index.ts` export shape sufficient for the smoke test to load.

**Step 4: Run test to verify it passes**
Run: `cd extensions/pi-authentik && npm test`
Expected: PASS for the smoke import test.

**Step 5: Commit**
```bash
git add extensions/pi-authentik
git commit -m "feat: scaffold pi-authentik extension"
```

### Task 2: Implement settings resolution and persistence

**Files:**
- Create: `extensions/pi-authentik/types.ts`
- Create: `extensions/pi-authentik/settings.ts`
- Create: `extensions/pi-authentik/settings-store.ts`
- Test: `extensions/pi-authentik/settings.test.ts`

**Step 1: Write the failing test**
Add tests for:
- env overrides over settings
- default scopes
- `offline_access` only when enabled
- canonical `LLM_BASE_URL` normalization to end at `/v1`
- invalid URLs rejected
- model filter fallback defaults

**Step 2: Run test to verify it fails**
Run: `cd extensions/pi-authentik && npm test -- settings.test.ts`
Expected: FAIL on missing parsing/validation behavior.

**Step 3: Write minimal implementation**
Implement typed config resolution from Pi settings + env, plus atomic global settings persistence for non-secret values.

**Step 4: Run test to verify it passes**
Run: `cd extensions/pi-authentik && npm test -- settings.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add extensions/pi-authentik/types.ts extensions/pi-authentik/settings.ts extensions/pi-authentik/settings-store.ts extensions/pi-authentik/settings.test.ts
git commit -m "feat: add pi-authentik settings resolution"
```

### Task 3: Implement endpoint validator and OpenAI-compatible client core

**Files:**
- Create: `extensions/pi-authentik/endpoint-validator.ts`
- Create: `extensions/pi-authentik/llm-client.ts`
- Create: `extensions/pi-authentik/models.ts`
- Test: `extensions/pi-authentik/endpoint-validator.test.ts`
- Test: `extensions/pi-authentik/models.test.ts`

**Step 1: Write the failing test**
Add tests for:
- `/v1` enforcement and auto-fix suggestion
- canonicalization of `/v1/` to `/v1`
- `/models` connectivity test using a local stub server
- OpenAI-compatible model list mapping
- glob filtering and “if no matches, return all” fallback

**Step 2: Run test to verify it fails**
Run: `cd extensions/pi-authentik && npm test -- endpoint-validator.test.ts models.test.ts`
Expected: FAIL because validator/client/modules are missing.

**Step 3: Write minimal implementation**
Implement validation helpers, a reusable client (`listModels`, `chatCompletion`, optional `responses`), auth strategy injection, and model mapping/filtering.

**Step 4: Run test to verify it passes**
Run: `cd extensions/pi-authentik && npm test -- endpoint-validator.test.ts models.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add extensions/pi-authentik/endpoint-validator.ts extensions/pi-authentik/llm-client.ts extensions/pi-authentik/models.ts extensions/pi-authentik/endpoint-validator.test.ts extensions/pi-authentik/models.test.ts
git commit -m "feat: add OpenAI-compatible endpoint validation and model discovery"
```

### Task 4: Implement PKCE, callback server, and discovery

**Files:**
- Create: `extensions/pi-authentik/pkce.ts`
- Create: `extensions/pi-authentik/callback-server.ts`
- Create: `extensions/pi-authentik/auth-config.ts`
- Create: `extensions/pi-authentik/discovery.ts`
- Test: `extensions/pi-authentik/pkce.test.ts`
- Test: `extensions/pi-authentik/callback-server.test.ts`
- Test: `extensions/pi-authentik/discovery.test.ts`

**Step 1: Write the failing test**
Add tests for:
- verifier/challenge/state/nonce generation shape
- derived discovery URL from host + provider slug
- callback server only listening on `127.0.0.1`
- state mismatch handling and callback timeout path

**Step 2: Run test to verify it fails**
Run: `cd extensions/pi-authentik && npm test -- pkce.test.ts callback-server.test.ts discovery.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**
Implement cryptographic helpers, strict callback server, and OIDC metadata fetch/validation.

**Step 4: Run test to verify it passes**
Run: `cd extensions/pi-authentik && npm test -- pkce.test.ts callback-server.test.ts discovery.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add extensions/pi-authentik/pkce.ts extensions/pi-authentik/callback-server.ts extensions/pi-authentik/auth-config.ts extensions/pi-authentik/discovery.ts extensions/pi-authentik/pkce.test.ts extensions/pi-authentik/callback-server.test.ts extensions/pi-authentik/discovery.test.ts
git commit -m "feat: add authentik OIDC discovery and PKCE callback flow"
```

### Task 5: Implement JWT verification and secure token store

**Files:**
- Create: `extensions/pi-authentik/jwt.ts`
- Create: `extensions/pi-authentik/token-store.ts`
- Test: `extensions/pi-authentik/jwt.test.ts`
- Test: `extensions/pi-authentik/token-store.test.ts`

**Step 1: Write the failing test**
Add tests for:
- valid ID token accepted only with matching issuer/audience/nonce
- invalid nonce or audience rejected
- expired token rejected
- token-store reads/writes through a mocked `globalThis.__piSecret`
- no plaintext fallback outside `pi-secret` path

**Step 2: Run test to verify it fails**
Run: `cd extensions/pi-authentik && npm test -- jwt.test.ts token-store.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**
Implement JWKS-backed JWT verification with `jose` and a token/session persistence layer on top of `pi-secret`.

**Step 4: Run test to verify it passes**
Run: `cd extensions/pi-authentik && npm test -- jwt.test.ts token-store.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add extensions/pi-authentik/jwt.ts extensions/pi-authentik/token-store.ts extensions/pi-authentik/jwt.test.ts extensions/pi-authentik/token-store.test.ts
git commit -m "feat: add token verification and secure session storage"
```

### Task 6: Implement auth client and logout flow

**Files:**
- Create: `extensions/pi-authentik/auth-client.ts`
- Create: `extensions/pi-authentik/logout.ts`
- Test: `extensions/pi-authentik/auth-client.test.ts`

**Step 1: Write the failing test**
Add tests for:
- authorization URL composition with PKCE/state/nonce
- code exchange request shape
- refresh-token request path
- refresh only when refresh token exists
- logout URL generation with optional end-session endpoint

**Step 2: Run test to verify it fails**
Run: `cd extensions/pi-authentik && npm test -- auth-client.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**
Implement browser-login orchestration, token exchange, refresh logic, session assembly, and logout helper behavior.

**Step 4: Run test to verify it passes**
Run: `cd extensions/pi-authentik && npm test -- auth-client.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add extensions/pi-authentik/auth-client.ts extensions/pi-authentik/logout.ts extensions/pi-authentik/auth-client.test.ts
git commit -m "feat: add authentik login refresh and logout client"
```

### Task 7: Implement first-run setup command flow

**Files:**
- Create: `extensions/pi-authentik/first-run.ts`
- Modify: `extensions/pi-authentik/settings-store.ts`
- Test: `extensions/pi-authentik/first-run.test.ts`

**Step 1: Write the failing test**
Add tests for:
- prompting sequence
- auto-appending `/v1` after confirmation
- refusing invalid URLs
- saving only non-secret config
- offering endpoint test before final save

**Step 2: Run test to verify it fails**
Run: `cd extensions/pi-authentik && npm test -- first-run.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**
Implement the interactive `/authentik-setup` wizard and endpoint retest/edit behavior.

**Step 4: Run test to verify it passes**
Run: `cd extensions/pi-authentik && npm test -- first-run.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add extensions/pi-authentik/first-run.ts extensions/pi-authentik/settings-store.ts extensions/pi-authentik/first-run.test.ts
git commit -m "feat: add first-run authentik and endpoint setup flow"
```

### Task 8: Integrate provider registration and extension commands

**Files:**
- Modify: `extensions/pi-authentik/index.ts`
- Create: `extensions/pi-authentik/logger.ts`
- Test: `extensions/pi-authentik/index.test.ts`

**Step 1: Write the failing test**
Add tests for:
- unauthenticated startup status
- missing endpoint startup status
- authenticated startup restores session and registers provider
- provider refresh after model discovery
- command handlers for login/logout/status/endpoint/refresh-models

**Step 2: Run test to verify it fails**
Run: `cd extensions/pi-authentik && npm test -- index.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**
Wire lifecycle, status UI, command registration, provider registration, startup restore/refresh, and event-safe notifications.

**Step 4: Run test to verify it passes**
Run: `cd extensions/pi-authentik && npm test -- index.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add extensions/pi-authentik/index.ts extensions/pi-authentik/logger.ts extensions/pi-authentik/index.test.ts
git commit -m "feat: integrate pi-authentik provider and commands"
```

### Task 9: Finish docs and examples

**Files:**
- Modify: `extensions/pi-authentik/README.md`
- Modify: `extensions/pi-authentik/.env.example`
- Modify: `extensions/pi-authentik/AUTHENTIK_SETUP.md`
- Modify: `extensions/pi-authentik/LLM_ENDPOINT_SETUP.md`

**Step 1: Write the failing test**
Add a lightweight docs assertion or checklist in `extensions/pi-authentik/readme.test.ts` checking the presence of required headings/strings:
- setup
- loopback redirect
- scopes
- `/v1` endpoint requirement
- troubleshooting

**Step 2: Run test to verify it fails**
Run: `cd extensions/pi-authentik && npm test -- readme.test.ts`
Expected: FAIL until docs are complete.

**Step 3: Write minimal implementation**
Complete user docs, examples, troubleshooting, and setup instructions.

**Step 4: Run test to verify it passes**
Run: `cd extensions/pi-authentik && npm test -- readme.test.ts`
Expected: PASS.

**Step 5: Commit**
```bash
git add extensions/pi-authentik/README.md extensions/pi-authentik/.env.example extensions/pi-authentik/AUTHENTIK_SETUP.md extensions/pi-authentik/LLM_ENDPOINT_SETUP.md extensions/pi-authentik/readme.test.ts
git commit -m "docs: document pi-authentik setup and endpoint requirements"
```

### Task 10: Full verification

**Files:**
- Verify: `extensions/pi-authentik/**/*`

**Step 1: Run targeted tests**
Run:
```bash
cd extensions/pi-authentik && npm test
```
Expected: all tests pass.

**Step 2: Run typecheck**
Run:
```bash
cd extensions/pi-authentik && npm run typecheck
```
Expected: no TypeScript errors.

**Step 3: Run package install/update if needed**
Run:
```bash
cd extensions/pi-authentik && npm install
```
Expected: lockfile consistent with dependencies.

**Step 4: Re-run verification**
Run:
```bash
cd extensions/pi-authentik && npm test && npm run typecheck
```
Expected: PASS.

**Step 5: Commit**
```bash
git add extensions/pi-authentik/package-lock.json
 git commit -m "chore: finalize pi-authentik dependencies and verification"
```
