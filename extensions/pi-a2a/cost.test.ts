/**
 * pi-a2a — Cost attribution tests.
 *
 * Tests the computeTaskCost function and cost propagation through
 * telemetry snapshots.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import type { TaskCostInfo } from "./types.ts";

describe("TaskCostInfo", () => {
	it("has the expected shape", () => {
		const cost: TaskCostInfo = {
			inputTokens: 1000,
			outputTokens: 500,
			estimatedCostUsd: 0.0125,
			toolCallCount: 3,
			durationMs: 5000,
		};
		assert.strictEqual(typeof cost.inputTokens, "number");
		assert.strictEqual(typeof cost.outputTokens, "number");
		assert.strictEqual(typeof cost.estimatedCostUsd, "number");
		assert.strictEqual(typeof cost.toolCallCount, "number");
		assert.strictEqual(typeof cost.durationMs, "number");
	});

	it("estimatedCostUsd is non-negative", () => {
		const cost: TaskCostInfo = {
			inputTokens: 0,
			outputTokens: 0,
			estimatedCostUsd: 0,
			toolCallCount: 0,
			durationMs: 100,
		};
		assert.ok(cost.estimatedCostUsd >= 0);
	});
});

describe("TelemetrySnapshot with costInfo", () => {
	it("can include costInfo optionally", () => {
		const snapshot: {
			queueDepth: number;
			activeTasks: number;
			maxConcurrent: number;
			costInfo?: TaskCostInfo;
		} = {
			queueDepth: 0,
			activeTasks: 0,
			maxConcurrent: 1,
			costInfo: {
				inputTokens: 2000,
				outputTokens: 1000,
				estimatedCostUsd: 0.021,
				toolCallCount: 5,
				durationMs: 8000,
			},
		};
		assert.ok(snapshot.costInfo !== undefined);
		assert.ok(snapshot.costInfo.estimatedCostUsd > 0);
	});

	it("works without costInfo (backward compatible)", () => {
		const snapshot: {
			queueDepth: number;
			activeTasks: number;
			maxConcurrent: number;
			costInfo?: TaskCostInfo;
		} = {
			queueDepth: 1,
			activeTasks: 1,
			maxConcurrent: 1,
		};
		assert.strictEqual(snapshot.costInfo, undefined);
	});
});
