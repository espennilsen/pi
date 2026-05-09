import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";

import {
  normalizeOpenAIBaseUrl,
  testModelsEndpointConnectivity,
  validateOpenAIBaseUrl,
} from "./endpoint-validator.ts";

test("validateOpenAIBaseUrl enforces /v1 with auto-fix suggestion", () => {
  const result = validateOpenAIBaseUrl("https://llm.example/openai");

  assert.equal(result.ok, false);
  assert.match(result.error, /must end with \/v1/i);
  assert.equal(result.suggestion, "https://llm.example/openai/v1");
});

test("normalizeOpenAIBaseUrl canonicalizes trailing slash on /v1", () => {
  assert.equal(normalizeOpenAIBaseUrl("https://llm.example/api/v1/"), "https://llm.example/api/v1");
});

test("testModelsEndpointConnectivity calls GET /models with auth strategy", async () => {
  let seenAuthorization: string | null = null;

  const server = http.createServer((req, res) => {
    seenAuthorization = req.headers.authorization ?? null;
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/v1/models");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: "gpt-4.1-mini", object: "model" }] }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Expected TCP server address");
  }

  try {
    const result = await testModelsEndpointConnectivity({
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      authStrategy: {
        async apply(headers) {
          headers.set("authorization", "Bearer test-token");
        },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.modelCount, 1);
    assert.equal(seenAuthorization, "Bearer test-token");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
