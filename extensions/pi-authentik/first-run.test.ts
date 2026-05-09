import assert from "node:assert/strict";
import test from "node:test";

import { runFirstRunSetup, type FirstRunUi } from "./first-run.ts";
import type { AuthentikStoredSettings } from "./types.ts";

test("runFirstRunSetup prompts in order, tests endpoint, and saves only non-secret config", async () => {
  const prompts: string[] = [];
  const notifications: Array<{ message: string; level: string }> = [];
  const saved: AuthentikStoredSettings[] = [];
  const connectivityCalls: string[] = [];

  const ui = createUi({
    inputs: [
      "https://auth.example/",
      "main-provider",
      "pi-client",
      "openid profile email",
      "https://llm.example/v1",
    ],
    confirms: [true, true, true],
    prompts,
    notifications,
  });

  const result = await runFirstRunSetup({
    ui,
    saveSettings(settings) {
      saved.push(settings);
    },
    testConnectivity: async (baseUrl) => {
      connectivityCalls.push(baseUrl);
      return { ok: true, normalizedUrl: baseUrl, modelCount: 3 };
    },
  });

  assert.deepEqual(prompts, [
    "Authentik host",
    "Provider slug",
    "Client ID",
    "Scopes",
    "LLM base URL",
  ]);
  assert.equal(connectivityCalls[0], "https://llm.example/v1");
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], {
    authentikHost: "https://auth.example",
    providerSlug: "main-provider",
    clientId: "pi-client",
    scopes: ["openid", "profile", "email"],
    enableOfflineAccess: true,
    llmBaseUrl: "https://llm.example/v1",
  });
  assert.deepEqual(result.settings, saved[0]);
  assert.equal("clientSecret" in saved[0], false);
  assert.match(notifications.map(({ message }) => message).join("\n"), /3 models/i);
});

test("runFirstRunSetup offers to auto-append /v1 after confirmation", async () => {
  const ui = createUi({
    inputs: [
      "https://auth.example",
      "main-provider",
      "pi-client",
      "",
      "https://llm.example/openai",
    ],
    confirms: [false, true, true],
  });

  const saved: AuthentikStoredSettings[] = [];

  await runFirstRunSetup({
    ui,
    saveSettings(settings) {
      saved.push(settings);
    },
    testConnectivity: async (baseUrl) => ({ ok: true, normalizedUrl: baseUrl, modelCount: 1 }),
  });

  assert.equal(saved[0]?.llmBaseUrl, "https://llm.example/openai/v1");
  assert.deepEqual(saved[0]?.scopes, ["openid", "profile", "email"]);
  assert.equal(saved[0]?.enableOfflineAccess, false);
});

test("runFirstRunSetup rejects invalid LLM URLs with helpful examples and retries", async () => {
  const notifications: Array<{ message: string; level: string }> = [];
  const ui = createUi({
    inputs: [
      "https://auth.example",
      "main-provider",
      "pi-client",
      "openid,email",
      "not-a-url",
      "https://llm.example/v1",
    ],
    confirms: [false, false],
    notifications,
  });

  const saved: AuthentikStoredSettings[] = [];

  await runFirstRunSetup({
    ui,
    saveSettings(settings) {
      saved.push(settings);
    },
    testConnectivity: async (baseUrl) => ({ ok: true, normalizedUrl: baseUrl, modelCount: 1 }),
  });

  assert.equal(saved[0]?.llmBaseUrl, "https://llm.example/v1");
  assert.match(notifications.map(({ message }) => message).join("\n"), /examples?:.*https:\/\/llm\.example\/v1.*https:\/\/llm\.example\/openai\/v1/i);
});

test("runFirstRunSetup offers endpoint test before final save and can skip it", async () => {
  const notifications: Array<{ message: string; level: string }> = [];
  const ui = createUi({
    inputs: [
      "https://auth.example",
      "main-provider",
      "pi-client",
      "openid profile email offline_access",
      "https://llm.example/v1",
    ],
    confirms: [false, false],
    notifications,
  });

  let connectivityCalled = false;
  let saveCount = 0;

  await runFirstRunSetup({
    ui,
    saveSettings() {
      saveCount += 1;
    },
    testConnectivity: async () => {
      connectivityCalled = true;
      return { ok: true, normalizedUrl: "https://llm.example/v1", modelCount: 1 };
    },
  });

  assert.equal(connectivityCalled, false);
  assert.equal(saveCount, 1);
  assert.match(notifications.map(({ message }) => message).join("\n"), /skip.*connectivity test/i);
});

function createUi(options: {
  inputs: string[];
  confirms: boolean[];
  prompts?: string[];
  notifications?: Array<{ message: string; level: string }>;
}): FirstRunUi {
  const inputs = [...options.inputs];
  const confirms = [...options.confirms];
  const prompts = options.prompts ?? [];
  const notifications = options.notifications ?? [];

  return {
    async input(prompt) {
      prompts.push(prompt);
      const value = inputs.shift();
      if (value === undefined) throw new Error(`Unexpected input prompt: ${prompt}`);
      return value;
    },
    async confirm(title, message) {
      notifications.push({ message: `${title}${message ? `: ${message}` : ""}`, level: "confirm" });
      const value = confirms.shift();
      if (value === undefined) throw new Error(`Unexpected confirm prompt: ${title}`);
      return value;
    },
    notify(message, level = "info") {
      notifications.push({ message, level });
    },
  };
}
