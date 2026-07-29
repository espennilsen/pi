/**
 * pi-a2a — Supervisor tests for trace ID propagation and loop control.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import {
	extractLoopMetadata,
	injectLoopMetadata,
	supervise,
	seedLoopMetadata,
	generateTraceId,
	DEFAULT_MAX_HOPS,
} from "./supervisor.ts";

describe("generateTraceId", () => {
	it("returns a string prefixed with a2a-trace-", () => {
		const id = generateTraceId();
		assert.ok(typeof id === "string");
		assert.ok(id.startsWith("a2a-trace-"));
	});

	it("returns unique IDs on each call", () => {
		const id1 = generateTraceId();
		const id2 = generateTraceId();
		assert.notStrictEqual(id1, id2);
	});
});

describe("seedLoopMetadata", () => {
	it("seeds with hopCount=0, traceId, and the agent in visitedAgents", () => {
		const meta = seedLoopMetadata("http://agent-a:3100");
		assert.strictEqual(meta.hopCount, 0);
		assert.deepStrictEqual(meta.visitedAgents, ["http://agent-a:3100"]);
		assert.ok(meta.traceId?.startsWith("a2a-trace-"));
		assert.strictEqual(meta.parentTaskId, undefined);
	});

	it("includes budgets when maxHops is provided", () => {
		const meta = seedLoopMetadata("http://agent-a:3100", 5);
		assert.deepStrictEqual(meta.budgets, { maxHops: 5 });
	});
});

describe("extractLoopMetadata", () => {
	it("returns zero-state when metadata is null/undefined", () => {
		assert.deepStrictEqual(extractLoopMetadata(null), {
			hopCount: 0, visitedAgents: [], budgets: undefined, traceId: undefined, parentTaskId: undefined,
		});
		assert.deepStrictEqual(extractLoopMetadata(undefined), {
			hopCount: 0, visitedAgents: [], budgets: undefined, traceId: undefined, parentTaskId: undefined,
		});
	});

	it("extracts pi:traceId and pi:parentTaskId from metadata", () => {
		const meta = extractLoopMetadata({
			"pi:hopCount": 2,
			"pi:visitedAgents": ["http://a", "http://b"],
			"pi:traceId": "a2a-trace-abc123",
			"pi:parentTaskId": "task-parent-123",
		});
		assert.strictEqual(meta.hopCount, 2);
		assert.deepStrictEqual(meta.visitedAgents, ["http://a", "http://b"]);
		assert.strictEqual(meta.traceId, "a2a-trace-abc123");
		assert.strictEqual(meta.parentTaskId, "task-parent-123");
	});

	it("returns undefined for traceId/parentTaskId when not present", () => {
		const meta = extractLoopMetadata({ "pi:hopCount": 1 });
		assert.strictEqual(meta.traceId, undefined);
		assert.strictEqual(meta.parentTaskId, undefined);
	});
});

describe("injectLoopMetadata", () => {
	it("injects pi:traceId and pi:parentTaskId when present", () => {
		const result = injectLoopMetadata({}, {
			hopCount: 3,
			visitedAgents: ["http://a"],
			traceId: "a2a-trace-xyz",
			parentTaskId: "parent-task-456",
		});
		assert.strictEqual(result["pi:traceId"], "a2a-trace-xyz");
		assert.strictEqual(result["pi:parentTaskId"], "parent-task-456");
		assert.strictEqual(result["pi:hopCount"], 3);
	});

	it("does not inject traceId/parentTaskId when undefined", () => {
		const result = injectLoopMetadata({}, {
			hopCount: 1,
			visitedAgents: ["http://a"],
		});
		assert.strictEqual("pi:traceId" in result, false);
		assert.strictEqual("pi:parentTaskId" in result, false);
	});

	it("preserves existing metadata keys", () => {
		const result = injectLoopMetadata({ "pi:sender": { name: "test" } }, {
			hopCount: 1,
			visitedAgents: ["http://a"],
			traceId: "a2a-trace-test",
		});
		assert.deepStrictEqual(result["pi:sender"], { name: "test" });
	});
});

describe("supervise", () => {
	const config = { agentId: "http://agent-b:3100", defaultMaxHops: DEFAULT_MAX_HOPS };

	it("approves first hop and propagates traceId", () => {
		const traceId = generateTraceId();
		const result = supervise({
			hopCount: 0,
			visitedAgents: ["http://agent-a:3100"],
			traceId,
			parentTaskId: "task-123",
		}, config);

		assert.strictEqual(result.approved, true);
		assert.strictEqual(result.metadata.traceId, traceId);
		assert.strictEqual(result.metadata.parentTaskId, "task-123");
		assert.strictEqual(result.metadata.hopCount, 1);
		assert.ok(result.metadata.visitedAgents.includes("http://agent-b:3100"));
	});

	it("propagates traceId on cycle detection rejection", () => {
		const traceId = "a2a-trace-cycle-test";
		const result = supervise({
			hopCount: 5,
			visitedAgents: ["http://agent-a:3100", "http://agent-b:3100"],
			traceId,
			parentTaskId: "task-cycle",
		}, config);

		assert.strictEqual(result.approved, false);
		assert.strictEqual(result.metadata.traceId, traceId);
		assert.strictEqual(result.metadata.parentTaskId, "task-cycle");
		assert.ok(result.reason?.includes("Cycle detected"));
	});

	it("propagates traceId on hop limit rejection", () => {
		const traceId = "a2a-trace-hop-limit";
		const tightConfig = { agentId: "http://agent-b:3100", defaultMaxHops: 3 };
		const result = supervise({
			hopCount: 3,
			visitedAgents: ["http://a", "http://b", "http://c"],
			traceId,
		}, tightConfig);

		assert.strictEqual(result.approved, false);
		assert.strictEqual(result.metadata.traceId, traceId);
		assert.ok(result.reason?.includes("Hop limit exceeded"));
	});
});

describe("trace propagation: A → B → C chain", () => {
	it("maintains the same traceId across three hops with different parentTaskIds", () => {
		// Seed at agent A (originator)
		const seed = seedLoopMetadata("http://agent-a:3100");
		assert.ok(seed.traceId);
		assert.strictEqual(seed.parentTaskId, undefined);

		// Agent A sends to agent B
		const bConfig = { agentId: "http://agent-b:3100", defaultMaxHops: DEFAULT_MAX_HOPS };
		const bResult = supervise({ ...seed }, bConfig);
		assert.strictEqual(bResult.approved, true);
		assert.strictEqual(bResult.metadata.traceId, seed.traceId);

		// Agent B sends to agent C, setting parentTaskId
		bResult.metadata.parentTaskId = "task-from-a";
		const cConfig = { agentId: "http://agent-c:3100", defaultMaxHops: DEFAULT_MAX_HOPS };
		const cResult = supervise(bResult.metadata, cConfig);
		assert.strictEqual(cResult.approved, true);
		assert.strictEqual(cResult.metadata.traceId, seed.traceId);
		assert.strictEqual(cResult.metadata.parentTaskId, "task-from-a");

		// All three share the same traceId
		assert.strictEqual(seed.traceId, bResult.metadata.traceId);
		assert.strictEqual(seed.traceId, cResult.metadata.traceId);
	});
});
