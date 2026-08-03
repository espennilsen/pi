# Pi A2A Dual-Mode Authentication Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Add per-peer negotiation for legacy API-key, OAuth 2.0, and OAuth 2.0+mTLS authentication to `pi-a2a`, while preserving every valid existing `pi-a2a` settings.json configuration.

**Architecture:** Keep extension configuration under the existing `pi-a2a.local`, `pi-a2a.hub`, and `pi-a2a.staticAgents[]` hierarchy. Add focused auth types plus four isolated runtime modules: peer-metadata resolution, mutually supported-mode selection, token acquisition, and inbound/outbound middleware. The Hub remains the source for Hub-peer metadata and OAuth authorization-server metadata; static peers use their configured metadata and fetched Agent Cards. OAuth uses standard client-credentials tokens, resource/audience restriction, and mTLS sender-constrained tokens where negotiated.

**Tech Stack:** TypeScript, Node.js `http`/`https`, `@a2a-js/sdk`, OAuth 2.0 client credentials, OAuth 2.0 Authorization Server Metadata (RFC 8414), OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens (RFC 8705), Node test runner.

---

## Constraints and decisions

- Preserve `local.apiKey`, `local.requireApiKey`, `hub.apiKey`, and `staticAgents[].apiKey` unchanged. Their current Bearer-header semantics remain the `legacy-api-key` mode.
- Do **not** put Hub metadata, issued tokens, or Hub OAuth settings in settings.json. Hub peer details must expose their supported modes and authorization-server metadata. The extension uses `hub.apiKey` only to authenticate to the Hub itself.
- Use standard OAuth client credentials, not a custom Hub token RPC. The supported client-authentication method is `client_secret_post`: `local.auth.oauth2.clientId` and `clientSecret` are sent only in the form body of a TLS-protected token request. Secrets are read from the loaded local settings, never logged or published, and changing either value on configuration reload creates a distinct provider/cache entry; operators rotate by replacing the secret and retiring the old credential at the authorization server.
- Token endpoints are accepted only from trusted Hub metadata or an explicit static-agent override, must be HTTPS and origin-pinned by `local.auth.oauth2.trustedTokenEndpointOrigins`, and credentialed fetches reject redirects. Agent Cards can describe supported modes but do not authorize a token endpoint.
- `oauth2+mtls` means OAuth bearer authentication plus mTLS client authentication and certificate-bound token verification. The current HTTP server/client cannot install the required certificate-bearing transport, so this mode is explicitly unsupported: do not select or advertise it until both outbound client-certificate transport and inbound TLS client-certificate verification are implemented.
- If peer metadata is absent or does not intersect local capability, fail closed. A sensitive skill must never retry as legacy after an OAuth/mTLS failure.
- Agent Cards must contain no credentials and must reflect the modes that the server can actually enforce at startup.

### Minimal additive settings shape

Keep the current settings hierarchy. Add an optional `auth` object under existing `local`, `hub`, and `staticAgents[]` records only where the extension needs local policy or static-peer overrides:

```jsonc
{
  "pi-a2a": {
    "local": {
      "apiKey": "existing legacy key",
      "auth": {
        "supportedModes": ["legacy-api-key", "oauth2", "oauth2+mtls"],
        "preferModern": true,
        "modernOnlySkills": ["deploy-production"],
        "oauth2": {
          "clientId": "pi-a2a-client",
          "clientSecret": "loaded-secret",
          "trustedTokenEndpointOrigins": ["https://issuer.example"],
          "issuer": "https://issuer.example",
          "audience": "https://agent.example"
        },
        "mtls": {
          "certPath": "/secure/pi-a2a-client.crt",
          "keyPath": "/secure/pi-a2a-client.key",
          "caPath": "/secure/peer-ca.pem"
        }
      }
    },
    "staticAgents": [{
      "name": "legacy-peer",
      "url": "https://peer.example",
      "apiKey": "existing legacy key",
      "auth": { "supportedModes": ["legacy-api-key"] }
    }]
  }
}
```

Omitting `local.auth` preserves the existing API-key-only behavior. The implementation must validate these additions and emit warnings for invalid values rather than changing existing settings semantics.

### Hub metadata contract required before implementation

`agents.get`/discovery responses need to expose peer `supportedAuthModes`, and for modern peers either an authorization-server metadata URL or enough standard metadata to locate it. The Hub must not receive the extension's settings.json. The plan assumes the Hub returns metadata similar to `{ auth: { supportedModes, authorizationServer, resource } }` as agent metadata; exact field names must be confirmed against the Hub API before coding the adapter. The Hub's own API-key authentication remains unchanged.

### Task 1: Define auth and peer contracts

**Files:**
- Modify: `extensions/pi-a2a/types.ts`
- Create: `extensions/pi-a2a/auth-types.ts`
- Test: `extensions/pi-a2a/auth-selector.test.ts`

**Step 1: Write failing selector tests**

Cover the pure selector with peer/local combinations:

```ts
assert.equal(selectAuthMode(["legacy-api-key", "oauth2"], ["oauth2", "legacy-api-key"]), "oauth2");
assert.equal(selectAuthMode(["oauth2+mtls", "oauth2"], ["oauth2+mtls"]), "oauth2+mtls");
assert.throws(() => selectAuthMode(["oauth2"], ["legacy-api-key"]), /No mutually supported/);
```

Add a modern-only case proving a sensitive skill rejects legacy even when both peers support it.

**Step 2: Run the test to verify it fails**

Run: `cd extensions/pi-a2a && node --test auth-selector.test.ts`

Expected: FAIL because `selectAuthMode` and the auth contract types do not exist.

**Step 3: Add additive types**

In `auth-types.ts`, define:
- `AuthMode = "legacy-api-key" | "oauth2" | "oauth2+mtls"`
- `PeerMetadataSource = "hub" | "static-directory" | "agent-card"`
- immutable `PeerAuthMetadata` with `agentId`, `endpoint`, `supportedAuthModes`, `source`, optional authorization-server/resource metadata, and optional transport capability metadata
- local and static-agent auth override types that describe capabilities, not a preselected mode
- an `AuthSelection` result that is computed for each request and includes mode, source, and denial reason when no mode is available

Extend `LocalConfig` and `StaticAgentConfig` in `types.ts` with optional `auth` fields. Do not rename or remove any existing fields. Extend `RemoteAgentDetail` only with optional Hub-provided auth metadata.

**Step 4: Implement the pure selector**

Create `auth-selector.ts` with a fixed strength order: `oauth2+mtls`, `oauth2`, `legacy-api-key`. It must:
- intersect validated local and peer modes;
- omit `oauth2+mtls` when local transport support is unavailable;
- honor `local.auth.preferModern === false` by preferring legacy only when both sides support it and the skill is not modern-only;
- reject a modern-only skill unless the selected mode is OAuth-based;
- return a typed fail-closed error rather than a legacy fallback.

**Step 5: Run selector tests**

Run: `cd extensions/pi-a2a && node --test auth-selector.test.ts`

Expected: PASS, including ranking, disabled-modern preference, capability filtering, and denial behavior.

**Step 6: Commit**

```bash
git add extensions/pi-a2a/auth-types.ts extensions/pi-a2a/auth-selector.ts extensions/pi-a2a/types.ts extensions/pi-a2a/auth-selector.test.ts
git commit -m "feat(pi-a2a): add peer auth mode selection"
```

### Task 2: Load and validate additive settings without changing existing behavior

**Files:**
- Modify: `extensions/pi-a2a/config.ts`
- Modify: `extensions/pi-a2a/types.ts`
- Test: `extensions/pi-a2a/config-auth.test.ts`

**Step 1: Write failing settings tests**

Extract the settings normalization/validation portion of `loadConfig()` into an exported pure helper taking global and project `pi-a2a` records. Test that:
- existing flat and `local` API-key configurations produce the exact current effective local config;
- absent `local.auth` derives legacy support only when the legacy API-key behavior is configured;
- valid auth additions retain unknown existing keys and preserve the deep merge of `local` and `hub`;
- invalid auth modes, duplicate modes, unreadable certificate paths, or mTLS without the required local material produce warnings and remove only the invalid addition.

**Step 2: Run tests to verify failure**

Run: `cd extensions/pi-a2a && node --test config-auth.test.ts`

Expected: FAIL because the pure config helper and auth validation do not exist.

**Step 3: Implement minimal validation**

Keep `SETTINGS_KEY`, flat-field migration, `local` merge, and `hub` merge exactly as they are. Add deep merging only for the new `local.auth` object and per-static-agent auth objects. Validate the three exact mode strings. Do not auto-enable OAuth from a Hub URL alone; modern modes are opt-in through locally configured support plus peer negotiation.

**Step 4: Run config tests**

Run: `cd extensions/pi-a2a && node --test config-auth.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add extensions/pi-a2a/config.ts extensions/pi-a2a/types.ts extensions/pi-a2a/config-auth.test.ts
git commit -m "feat(pi-a2a): validate additive auth settings"
```

### Task 3: Resolve peer metadata across Hub, static directory, and Agent Cards

**Files:**
- Create: `extensions/pi-a2a/peer-metadata.ts`
- Modify: `extensions/pi-a2a/static-agents.ts`
- Modify: `extensions/pi-a2a/hub.ts`
- Modify: `extensions/pi-a2a/index.ts:1690-2055`
- Test: `extensions/pi-a2a/peer-metadata.test.ts`

**Step 1: Write failing resolution tests**

Use injected Hub and card-fetch functions. Cover:
- Hub detail metadata wins for a resolved Hub peer and has `source: "hub"`;
- static-agent `auth.supportedModes` takes priority for a configured static agent and has `source: "static-directory"`;
- a static agent lacking an override parses `securitySchemes`/`security` from its fetched Agent Card and has `source: "agent-card"`;
- an unrecognized/ambiguous card advertises no modes and causes selection to fail closed;
- a static Agent Card is fetched without sending a legacy API key unless the configured peer policy explicitly permits it.

**Step 2: Run tests to verify failure**

Run: `cd extensions/pi-a2a && node --test peer-metadata.test.ts`

Expected: FAIL because the resolver does not exist.

**Step 3: Implement resolver and adapters**

Create `resolvePeerMetadata()` with dependencies injected for deterministic tests. Resolution order for a selected peer is:
1. Hub metadata when the peer was resolved via Hub;
2. static-directory override when the peer is configured statically;
3. cached/fetched Agent Card as a fallback.

Update `getAgentFromHub()` to preserve optional trusted Hub auth metadata without requiring settings.json changes. Update `StaticAgentRegistry` to cache immutable normalized peer capabilities with the fetched card. Parse only the security scheme forms that the extension itself publishes; unknown schemes are not treated as OAuth support. Agent Card discovery may contribute supported modes but never an authorization-server/token endpoint; that endpoint must come from trusted Hub metadata or explicit static configuration. Preserve current name/URL resolution behavior in `a2a_send`, but replace its separate `credential`/`fromStatic` state with a resolved peer object and run selection anew for every request.

**Step 4: Run peer metadata tests**

Run: `cd extensions/pi-a2a && node --test peer-metadata.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add extensions/pi-a2a/peer-metadata.ts extensions/pi-a2a/static-agents.ts extensions/pi-a2a/hub.ts extensions/pi-a2a/index.ts extensions/pi-a2a/peer-metadata.test.ts
git commit -m "feat(pi-a2a): resolve per-peer auth metadata"
```

### Task 4: Add standard token providers and outbound transport middleware

**Files:**
- Create: `extensions/pi-a2a/token-provider.ts`
- Create: `extensions/pi-a2a/outbound-auth.ts`
- Modify: `extensions/pi-a2a/client.ts`
- Modify: `extensions/pi-a2a/index.ts:1942-2178`
- Test: `extensions/pi-a2a/token-provider.test.ts`
- Test: `extensions/pi-a2a/outbound-auth.test.ts`

**Step 1: Write failing provider and request-construction tests**

Test a `TokenProvider` interface such as `getAccessToken(peer, selection): Promise<AccessToken>`:
- `LegacyApiKeyProvider` returns the existing configured key and keeps the current `Authorization: Bearer <key>` behavior;
- `OAuthClientCredentialsProvider` uses an HTTPS token endpoint from trusted Hub metadata or explicit static configuration, sends `client_id`/`client_secret` only as `client_secret_post` form fields, and requests the peer resource/audience;
- token cache is keyed by peer ID + audience + mode, expires before `expires_in`, coalesces concurrent misses with one in-flight promise, and makes 401 invalidation generation-aware so only the failed token generation is evicted and a stale in-flight fetch cannot repopulate it;
- tests cover form-body client authentication, secret redaction, configuration-reload credential rotation (new provider/cache key), trusted-origin rejection, and rejected redirects;
- token provider errors never return the legacy key as an OAuth fallback;
- mTLS mode creates an HTTPS dispatcher/agent from configured certificate paths and rejects selection when it cannot;
- logs contain peer ID, task ID, metadata source, skill, and mode but never token/key values.

**Step 2: Run tests to verify failure**

Run: `cd extensions/pi-a2a && node --test token-provider.test.ts outbound-auth.test.ts`

Expected: FAIL because providers and middleware do not exist.

**Step 3: Implement providers and transport**

Implement a provider interface with three implementations:
- legacy: existing static `apiKey` or Hub credential retrieval;
- Hub/static OAuth: standards-based client-credentials request to a trusted, origin-pinned authorization server from Hub metadata or static configuration, requesting the selected peer as `resource`/audience; never obtain this endpoint from an Agent Card;
- external provider placeholder: typed but disabled unless a future provider is explicitly configured.

Do not create a custom Hub exchange method. For static modern peers, only use an authorization-server endpoint explicitly supplied by static configuration; fetched Agent Cards are not a trusted authority source. Reject redirects before a credential-bearing request is sent. Build outbound auth once and pass its headers/fetch/HTTPS transport to both `sendA2AMessage()` and `getRemoteTask()` so polling, retries, and input-required follow-ups retain the same mode.

Change client option names from the ambiguous `credential` to a typed auth context. Retain a compatibility adapter until all callers are migrated. Ensure `createAuthenticatingFetchWithRetry` only refreshes OAuth tokens, not legacy API keys.

**Step 4: Run provider and middleware tests**

Run: `cd extensions/pi-a2a && node --test token-provider.test.ts outbound-auth.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add extensions/pi-a2a/token-provider.ts extensions/pi-a2a/outbound-auth.ts extensions/pi-a2a/client.ts extensions/pi-a2a/index.ts extensions/pi-a2a/token-provider.test.ts extensions/pi-a2a/outbound-auth.test.ts
git commit -m "feat(pi-a2a): add OAuth and mTLS outbound auth"
```

### Task 5: Enforce inbound policy and expose accurate Agent Card security

**Files:**
- Create: `extensions/pi-a2a/inbound-auth.ts`
- Modify: `extensions/pi-a2a/server.ts`
- Modify: `extensions/pi-a2a/agent-card.ts`
- Modify: `extensions/pi-a2a/index.ts:855-1055`
- Test: `extensions/pi-a2a/inbound-auth.test.ts`
- Test: `extensions/pi-a2a/agent-card-auth.test.ts`

**Step 1: Write failing inbound and card tests**

Test request authentication with injected JWT verification and TLS peer-certificate evidence:
- legacy key succeeds only when `legacy-api-key` is enabled and the constant-time comparison matches;
- a JWT bearer token succeeds only when OAuth mode is enabled and issuer, signature/JWKS, audience/resource, expiration, and required scope validate; opaque access tokens are unsupported and rejected;
- bearer token without valid mTLS certificate binding fails when `oauth2+mtls` is selected/required;
- no configured matching mode returns 401/403 before SDK dispatch;
- a modern-only skill/operation cannot be authorized with a legacy key;
- legacy-only card contains only its legacy security scheme;
- mixed card advertises legacy and OAuth alternatives; mTLS requires both the OAuth and mTLS scheme in the relevant security requirement;
- card contains no key, token, certificate material, endpoint secret, or Hub API-key data.

**Step 2: Run tests to verify failure**

Run: `cd extensions/pi-a2a && node --test inbound-auth.test.ts agent-card-auth.test.ts`

Expected: FAIL because middleware and conditional Agent Card security do not exist.

**Step 3: Implement fail-closed inbound auth**

Make `server.ts` call a pure `authenticateInboundRequest()` before parsing/dispatching JSON-RPC. It returns an authenticated principal containing mode and redacted identity. Keep API-key equality constant time. The negotiated `oauth2` mode is JWT-access-token-only: validate issuer, signature/JWKS, expected audience, expiration, and scope; reject opaque values because introspection is not implemented. Agent Card OAuth security therefore denotes this JWT-validated profile, not generic opaque-token OAuth. For mTLS, a future implementation must start an HTTPS server only when configured certificate material is usable, request/verify peer certificates against configured trust, and compare the JWT `cnf` certificate thumbprint to the TLS peer certificate. Until then, omit `oauth2+mtls` from runtime modes and Agent Cards. If TLS terminates upstream, do not trust forwarded certificate headers; retain mTLS as unsupported unless a future trusted-proxy integration is explicitly designed.

Pass the authenticated principal and method/skill context to the policy check. Permit legacy only for operations not in `modernOnlySkills`; default-deny any mismatch.

Update `buildAgentCard()` to derive schemes from validated runtime capabilities, not merely `local.apiKey`. Preserve SDK compatibility with targeted `AgentCard` casts if its current type does not model OAuth/mTLS security schemes. Publish `apiKey` only for legacy, OAuth only for modern, and OR alternatives for mixed deployments. Regenerate/update the card after final TLS/port startup capability resolution.

**Step 4: Run inbound/card tests**

Run: `cd extensions/pi-a2a && node --test inbound-auth.test.ts agent-card-auth.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add extensions/pi-a2a/inbound-auth.ts extensions/pi-a2a/server.ts extensions/pi-a2a/agent-card.ts extensions/pi-a2a/index.ts extensions/pi-a2a/inbound-auth.test.ts extensions/pi-a2a/agent-card-auth.test.ts
git commit -m "feat(pi-a2a): enforce negotiated inbound authentication"
```

### Task 6: Integrate policy, logging, documentation, and migration guidance

**Files:**
- Modify: `extensions/pi-a2a/index.ts`
- Modify: `extensions/pi-a2a/logger.ts`
- Modify: `extensions/pi-a2a/README.md`
- Modify: `extensions/pi-a2a/AGENTS.md`
- Modify: `extensions/pi-a2a/CHANGELOG.md`
- Create: `extensions/pi-a2a/auth-integration.test.ts`

**Step 1: Write failing end-to-end mode tests**

Use a fake Hub adapter, fake static directory, and test HTTP server. Cover:
- Hub-backed modern peer: Hub metadata yields OAuth, receives a resource-scoped bearer token, and logs selected mode/source;
- static-directory legacy peer: existing `staticAgents[].apiKey` still succeeds with the existing Bearer header;
- mixed peer: chooses mTLS first when local capability exists, OAuth second when mTLS is unavailable, and legacy only when explicitly preferred/allowed;
- deny-by-default: no mutual mode, malformed Agent Card, invalid token, or modern-only skill with legacy credentials never dispatches to the executor.

**Step 2: Run test to verify failure**

Run: `cd extensions/pi-a2a && node --test auth-integration.test.ts`

Expected: FAIL until the resolver, policy, server, and client are wired together.

**Step 3: Wire the lifecycle and redact logs**

At `session_start`, compute validated local runtime auth capabilities before building the Agent Card and starting the server. In `a2a_send`, resolve peer metadata, select a mode before starting its background IIFE, and return a user-visible fail-closed error for selection/provider failure. Carry the auth context through retries and task polling. Add structured logs for selection, legacy warnings, token refresh, inbound allow/deny, and policy denial. Every auth log includes peer ID, task ID when known, skill/operation, metadata source, and mode; logger-side redaction recursively masks `apiKey`, `credential`, `authorization`, `token`, and certificate/key content before emitting.

**Step 4: Update migration documentation**

Document:
- no-action upgrade path for existing API-key settings;
- enabling OAuth gradually by adding `local.auth.supportedModes` and using Hub/Agent Card metadata;
- certificate path handling and the fact that mTLS is unavailable behind an untrusted TLS proxy;
- static-directory override examples;
- modern-only skill policy and fail-closed behavior;
- Hub contract prerequisites; and
- the fact that secrets never belong in Agent Cards or environment variables for this extension.

Add an Unreleased changelog entry.

**Step 5: Run all extension tests and typecheck**

Run:

```bash
cd extensions/pi-a2a
npm run typecheck
npm test
npm pack --dry-run --json
```

Expected: typecheck exits 0; all existing and new tests pass; package contents include all new auth modules/tests where project packaging policy requires them and no credentials.

**Step 6: Commit**

```bash
git add extensions/pi-a2a/index.ts extensions/pi-a2a/logger.ts extensions/pi-a2a/README.md extensions/pi-a2a/AGENTS.md extensions/pi-a2a/CHANGELOG.md extensions/pi-a2a/auth-integration.test.ts
git commit -m "docs(pi-a2a): document dual-mode auth migration"
```

### Task 7: Independent review and release handoff

**Files:**
- Inspect: complete `extensions/pi-a2a/` diff

**Step 1: Request an independent security review**

Review the full diff specifically for token leakage, any unintended legacy fallback, OAuth validation gaps, TLS trust mistakes, stale token caching, and Agent Card/runtime divergence.

**Step 2: Address review findings with targeted tests**

For every defect, add a failing regression test first, fix only the issue, then rerun the affected test and the full suite.

**Step 3: Re-run final verification**

Run:

```bash
cd extensions/pi-a2a
npm run typecheck
npm test
npm pack --dry-run --json
git diff --check
```

Expected: all commands exit 0.

**Step 4: Commit and deliver**

```bash
git add extensions/pi-a2a
git commit -m "fix(pi-a2a): address dual auth review findings"
git push origin <task-branch>
gh pr create --fill
```
