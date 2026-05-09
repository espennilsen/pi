import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { startCallbackServer } from "./callback-server.ts";

async function httpGet(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.text(),
  };
}

test("startCallbackServer listens on 127.0.0.1 and shuts down after one successful callback", async () => {
  const callbackServer = await startCallbackServer({ expectedState: "expected-state", timeoutMs: 5_000 });

  assert.equal(callbackServer.host, "127.0.0.1");
  assert.ok(callbackServer.port > 0);
  assert.equal(callbackServer.redirectUri, `http://127.0.0.1:${callbackServer.port}/callback`);

  const response = await httpGet(`${callbackServer.redirectUri}?code=test-code&state=expected-state`);
  const result = await callbackServer.waitForCallback();

  assert.equal(response.status, 200);
  assert.match(response.body, /authentication complete/i);
  assert.deepEqual(result, { code: "test-code", state: "expected-state" });

  await assert.rejects(
    () => httpGet(callbackServer.redirectUri),
    /fetch failed|ECONNREFUSED/i,
  );
});

test("startCallbackServer rejects state mismatch and closes immediately", async () => {
  const callbackServer = await startCallbackServer({ expectedState: "expected-state", timeoutMs: 5_000 });
  const callbackResult = callbackServer.waitForCallback();

  const response = await httpGet(`${callbackServer.redirectUri}?code=test-code&state=wrong-state`);

  assert.equal(response.status, 400);
  await assert.rejects(callbackResult, /state mismatch/i);
  await assert.rejects(() => httpGet(callbackServer.redirectUri), /fetch failed|ECONNREFUSED/i);
});

test("startCallbackServer rejects provider error and timeout paths", async () => {
  const errorServer = await startCallbackServer({ timeoutMs: 5_000 });
  const errorResult = errorServer.waitForCallback();
  const errorResponse = await httpGet(`${errorServer.redirectUri}?error=access_denied&error_description=Denied`);

  assert.equal(errorResponse.status, 400);
  await assert.rejects(errorResult, /access_denied.*Denied/i);

  const timeoutServer = await startCallbackServer({ timeoutMs: 25 });
  const timeoutResult = timeoutServer.waitForCallback();
  await assert.rejects(timeoutResult, /timed out/i);
  await assert.rejects(() => httpGet(timeoutServer.redirectUri), /fetch failed|ECONNREFUSED/i);
});
