import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";

import {
  MODELS_ENDPOINT_AUTH_REDIRECT_MESSAGE,
  MODELS_ENDPOINT_HTML_RESPONSE_MESSAGE,
  normalizeOpenAIBaseUrl,
  testModelsEndpointConnectivity,
  validateOpenAIBaseUrl,
} from "../llm/endpoint-validator.ts";

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

test("testModelsEndpointConnectivity without auth rejects Authentik-style login redirects", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const reqUrl = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    assert.match(reqUrl, /\/v1\/models$/);
    return new Response(null, {
      status: 302,
      headers: { location: "https://idp.example/if/flow/default-authentication-flow/?next=/" },
    });
  };

  const result = await testModelsEndpointConnectivity({
    baseUrl: "https://proxy.example/services/llm/v1",
    fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, MODELS_ENDPOINT_AUTH_REDIRECT_MESSAGE);
  assert.equal(result.authUrl, "https://idp.example/if/flow/default-authentication-flow/?next=/");
});

test("testModelsEndpointConnectivity without auth rejects HTML bodies", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("<!DOCTYPE html><html><title>Login</title></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });

  const result = await testModelsEndpointConnectivity({
    baseUrl: "https://api.example/v1",
    fetchImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, MODELS_ENDPOINT_HTML_RESPONSE_MESSAGE);
});

test("testModelsEndpointConnectivity without auth follows benign redirects then parses JSON", async () => {
  let call = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const reqUrl = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    call += 1;
    if (call === 1) {
      assert.equal(reqUrl, "https://api.example/v1/models");
      return new Response(null, {
        status: 307,
        headers: { location: "https://api.example/alt/v1/models" },
      });
    }
    assert.equal(reqUrl, "https://api.example/alt/v1/models");
    return new Response(JSON.stringify({ object: "list", data: [{ id: "m1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await testModelsEndpointConnectivity({
    baseUrl: "https://api.example/v1",
    fetchImpl,
  });

  assert.equal(result.modelCount, 1);
  assert.equal(result.normalizedUrl, "https://api.example/v1");
});
