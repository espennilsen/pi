import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_MODEL_FILTERS, resolveSettings } from "./settings.ts";
import { loadGlobalSettings, saveGlobalSettings } from "./settings-store.ts";
import type { AuthentikStoredSettings } from "./types.ts";

test("resolveSettings uses default scopes and omits offline_access by default", async () => {
  const settings = await resolveSettings(process.cwd(), {
    globalSettings: {},
    projectSettings: {},
  });

  assert.deepEqual(settings.scopes, ["openid", "profile", "email"]);
  assert.equal(settings.enableOfflineAccess, false);
});

test("resolveSettings appends offline_access only when enabled", async () => {
  const settings = await resolveSettings(process.cwd(), {
    globalSettings: {
      enableOfflineAccess: true,
      scopes: ["openid", "email", "profile", "offline_access"],
    },
    projectSettings: {},
  });

  assert.equal(settings.enableOfflineAccess, true);
  assert.deepEqual(settings.scopes, ["openid", "email", "profile", "offline_access"]);
});

test("resolveSettings merges project settings over global settings", async () => {
  const settings = await resolveSettings(process.cwd(), {
    globalSettings: {
      authentikHost: "https://global.example",
      providerSlug: "global-provider",
      clientId: "global-client",
      scopes: ["openid", "profile", "email"],
      llmBaseUrl: "https://global.example/v1",
      modelFilters: ["gpt-*"],
    },
    projectSettings: {
      providerSlug: "project-provider",
      clientId: "project-client",
      llmBaseUrl: "https://project.example/openai/v1/",
      modelFilters: ["o3-*"],
    },
  });

  assert.equal(settings.authentikHost, "https://global.example");
  assert.equal(settings.providerSlug, "project-provider");
  assert.equal(settings.clientId, "project-client");
  assert.deepEqual(settings.scopes, ["openid", "profile", "email"]);
  assert.equal(settings.llmBaseUrl, "https://project.example/openai/v1");
  assert.deepEqual(settings.modelFilters, ["o3-*"]);
});

test("resolveSettings canonicalizes llm base url to an absolute /v1 endpoint", async () => {
  const settings = await resolveSettings(process.cwd(), {
    globalSettings: {
      llmBaseUrl: "https://llm.example/internal/v1/",
    },
    projectSettings: {},
  });

  assert.equal(settings.llmBaseUrl, "https://llm.example/internal/v1");
});

test("resolveSettings auto-appends /v1 and rejects invalid urls", async () => {
  const fixed = await resolveSettings(process.cwd(), {
    globalSettings: {
      llmBaseUrl: "https://llm.example/internal",
    },
    projectSettings: {},
  });
  assert.equal(fixed.llmBaseUrl, "https://llm.example/internal/v1");

  await assert.rejects(
    async () =>
      await resolveSettings(process.cwd(), {
        globalSettings: {
          llmBaseUrl: "/not/absolute",
        },
        projectSettings: {},
      }),
    /LLM_BASE_URL must be an absolute http\/https URL/,
  );
});

test("resolveSettings falls back to default model filters", async () => {
  const settings = await resolveSettings(process.cwd(), {
    globalSettings: {
      modelFilters: "",
    },
    projectSettings: {
      modelFilters: [123 as never],
    },
  });

  assert.deepEqual(settings.modelFilters, DEFAULT_MODEL_FILTERS);
});

test("saveGlobalSettings persists only the extension key atomically", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-authentik-settings-"));
  const settingsFile = path.join(tempRoot, "settings.json");
  fs.writeFileSync(settingsFile, JSON.stringify({ unrelated: { keep: true } }, null, 2));

  const input: AuthentikStoredSettings = {
    authentikHost: "https://auth.example",
    providerSlug: "main",
    clientId: "client-id",
    enableOfflineAccess: true,
    llmBaseUrl: "https://llm.example/v1",
    modelFilters: ["gpt-*"],
  };

  saveGlobalSettings(settingsFile, input);

  const parsed = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Record<string, unknown>;
  assert.deepEqual(parsed.unrelated, { keep: true });
  assert.deepEqual(parsed["pi-authentik"], {
    authentikHost: "https://auth.example",
    providerSlug: "main",
    clientId: "client-id",
    enableOfflineAccess: true,
    llmBaseUrl: "https://llm.example/v1",
    modelFilters: ["gpt-*"]
  });
  assert.equal(fs.existsSync(`${settingsFile}.tmp`), false);
});

test("loadGlobalSettings returns sanitized persisted values", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-authentik-settings-"));
  const settingsFile = path.join(tempRoot, "settings.json");
  fs.writeFileSync(
    settingsFile,
    JSON.stringify(
      {
        "pi-authentik": {
          authentikHost: "https://auth.example/",
          modelFilters: ["anthropic/*", 123],
          llmBaseUrl: "https://llm.example/v1/",
        },
      },
      null,
      2,
    ),
  );

  assert.deepEqual(await loadGlobalSettings(settingsFile), {
    authentikHost: "https://auth.example/",
    llmBaseUrl: "https://llm.example/v1/",
    modelFilters: ["anthropic/*"],
  });
});
