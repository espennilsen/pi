/**
 * pi-a2a — Hub RPC tests for task claiming, leases, and telemetry.
 */

import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { claimHubTask, heartbeatHubTask, reportTelemetryToHub, HubRpcError } from "./hub.ts";
import type { HubConfig, TelemetrySnapshot } from "./types.ts";

const hubConfig: HubConfig = {
	url: "http://hub.local/api",
	apiKey: "secret",
};

const log = () => {};

let originalFetch: typeof fetch | null = null;

afterEach(() => {
	if (originalFetch) {
		globalThis.fetch = originalFetch;
		originalFetch = null;
	}
});

function mockFetch(handler: (input: unknown, init?: RequestInit) => Promise<Response> | Response): void {
	originalFetch = globalThis.fetch;
	globalThis.fetch = handler as typeof fetch;
}

function rpcResponse(result: unknown): Response {
	return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function rpcError(code: number, message: string, data?: unknown): Response {
	return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code, message, data } }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

describe("claimHubTask", () => {
	it("returns no task when the hub has nothing eligible", async () => {
		mockFetch(async (_input, init) => {
			const body = JSON.parse(init?.body as string) as { method: string; params: Record<string, unknown> };
			assert.strictEqual(body.method, "tasks.claim");
			assert.strictEqual(body.params.agentId, "agent-1");
			assert.strictEqual(body.params.instanceId, "instance-1");
			assert.strictEqual(body.params.leaseDurationSeconds, 900);
			return rpcResponse({ task: null, claimed: false });
		});

		const result = await claimHubTask({ agentId: "agent-1", instanceId: "instance-1" }, hubConfig, log);
		assert.deepStrictEqual(result, { task: null, claimed: false });
	});

	it("throws conflict when a specific task cannot be claimed", async () => {
		mockFetch(() => rpcError(-32003, "Task is already claimed"));

		await assert.rejects(
			() => claimHubTask({ agentId: "agent-1", instanceId: "instance-1", taskId: "task-1" }, hubConfig, log),
			(err: unknown) => err instanceof HubRpcError && err.code === -32003,
		);
	});

	it("throws when the hub is unavailable", async () => {
		mockFetch(() => new Response("", { status: 500 }));

		await assert.rejects(
			() => claimHubTask({ agentId: "agent-1", instanceId: "instance-1" }, hubConfig, log),
			(err: unknown) => err instanceof HubRpcError && err.message === "No response from hub",
		);
	});

	it("throws when the hub claims a task without returning a task object", async () => {
		mockFetch(() => rpcResponse({ task: null, claimed: true }));

		await assert.rejects(
			() => claimHubTask({ agentId: "agent-1", instanceId: "instance-1" }, hubConfig, log),
			(err: unknown) => err instanceof HubRpcError && err.message === "Malformed claim response from hub",
		);
	});
});

describe("heartbeatHubTask", () => {
	it("renews a task lease for the current agent instance", async () => {
		mockFetch(async (_input, init) => {
			const body = JSON.parse(init?.body as string) as { method: string; params: Record<string, unknown> };
			assert.strictEqual(body.method, "tasks.heartbeat");
			assert.strictEqual(body.params.agentId, "agent-1");
			assert.strictEqual(body.params.instanceId, "instance-1");
			assert.strictEqual(body.params.taskId, "task-1");
			assert.strictEqual(body.params.leaseDurationSeconds, 1200);
			return rpcResponse({
				task: {
					id: "task-1",
					title: "Implement leases",
					description: null,
					project: "pi-a2a",
					repo: null,
					state: "planning",
					priority: "normal",
					assignedAgentId: "agent-1",
					createdBy: "system",
					externalTaskId: null,
					branch: null,
					prUrl: null,
					prNumber: null,
					reportPath: null,
					blockedReason: null,
					reviewRound: 0,
					maxReviewRounds: 3,
					metadata: {},
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:01:00.000Z",
					startedAt: null,
					completedAt: null,
					leaseOwnerAgentId: "agent-1",
					leaseOwnerInstanceId: "instance-1",
					leaseExpiresAt: "2026-01-01T00:21:00.000Z",
				},
				renewed: true,
			});
		});

		const result = await heartbeatHubTask({ agentId: "agent-1", instanceId: "instance-1", taskId: "task-1", leaseDurationSeconds: 1200 }, hubConfig, log);
		assert.strictEqual(result.renewed, true);
		assert.strictEqual(result.task.id, "task-1");
		assert.strictEqual(result.task.leaseOwnerInstanceId, "instance-1");
	});

	it("throws conflict when the lease is invalid", async () => {
		mockFetch(() => rpcError(-32003, "Lease expired"));

		await assert.rejects(
			() => heartbeatHubTask({ agentId: "agent-1", instanceId: "instance-1", taskId: "task-1" }, hubConfig, log),
			(err: unknown) => err instanceof HubRpcError && err.code === -32003,
		);
	});

	it("throws when the hub returns an invalid heartbeat payload", async () => {
		mockFetch(() => rpcResponse({ task: null, renewed: true }));

		await assert.rejects(
			() => heartbeatHubTask({ agentId: "agent-1", instanceId: "instance-1", taskId: "task-1" }, hubConfig, log),
			(err: unknown) => err instanceof HubRpcError && err.message === "Malformed heartbeat response from hub",
		);
	});
});

describe("reportTelemetryToHub", () => {
	it("includes the instanceId in the telemetry payload", async () => {
		mockFetch(async (_input, init) => {
			const body = JSON.parse(init?.body as string) as { method: string; params: Record<string, unknown> };
			assert.strictEqual(body.method, "agents.reportTelemetry");
			assert.strictEqual(body.params.agentId, "agent-1");
			assert.strictEqual(body.params.instanceId, "instance-1");
			assert.strictEqual(body.params.queueDepth, 2);
			assert.strictEqual(body.params.activeTasks, 1);
			assert.strictEqual(body.params.maxConcurrent, 3);
			return rpcResponse({ telemetryUpdatedAt: "2026-01-01T00:00:00.000Z" });
		});

		const telemetry: TelemetrySnapshot = {
			queueDepth: 2,
			activeTasks: 1,
			maxConcurrent: 3,
		};

		const result = await reportTelemetryToHub("agent-1", telemetry, hubConfig, log, "instance-1");
		assert.deepStrictEqual(result, { telemetryUpdatedAt: "2026-01-01T00:00:00.000Z" });
	});
});
