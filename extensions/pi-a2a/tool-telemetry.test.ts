import test from "node:test";
import assert from "node:assert/strict";
import type { ToolCallRecord } from "./types.ts";
import {
	buildIdleTelemetrySnapshot,
	buildRecentToolCallsSnapshot,
	createSerializedAsyncRunner,
	drainRecentToolCalls,
	resetToolTelemetryState,
} from "./tool-telemetry.ts";

function makeToolCall(toolName: string, timestamp: number): ToolCallRecord {
	return {
		toolName,
		durationMs: 12,
		isError: false,
		errorText: null,
		timestamp,
	};
}

void test("buildRecentToolCallsSnapshot copies records without draining the buffer", () => {
	const recentToolCalls = [makeToolCall("read", 1), makeToolCall("bash", 2)];

	const snapshot = buildRecentToolCallsSnapshot(recentToolCalls);

	assert.deepEqual(snapshot, recentToolCalls);
	assert.notStrictEqual(snapshot, recentToolCalls);
	assert.equal(recentToolCalls.length, 2);
});

void test("drainRecentToolCalls removes only successfully sent records", () => {
	const recentToolCalls = [makeToolCall("read", 1), makeToolCall("bash", 2), makeToolCall("edit", 3)];

	drainRecentToolCalls(recentToolCalls, 2);

	assert.deepEqual(recentToolCalls, [makeToolCall("edit", 3)]);
});

void test("buildIdleTelemetrySnapshot includes a copied recent tool call batch", () => {
	const recentToolCalls = [makeToolCall("read", 1), makeToolCall("bash", 2)];

	const snapshot = buildIdleTelemetrySnapshot(recentToolCalls);

	assert.equal(snapshot.queueDepth, 0);
	assert.equal(snapshot.activeTasks, 0);
	assert.equal(snapshot.maxConcurrent, 1);
	assert.deepEqual(snapshot.recentToolCalls, recentToolCalls);
	assert.notStrictEqual(snapshot.recentToolCalls, recentToolCalls);
	assert.equal(recentToolCalls.length, 2);
});

void test("createSerializedAsyncRunner runs telemetry sends one at a time", async () => {
	const runSerialized = createSerializedAsyncRunner();
	const steps: string[] = [];
	let releaseFirst!: () => void;
	const firstGate = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});

	const first = runSerialized(async () => {
		steps.push("first:start");
		await firstGate;
		steps.push("first:end");
	});
	const second = runSerialized(async () => {
		steps.push("second:start");
		steps.push("second:end");
	});

	await Promise.resolve();
	assert.deepEqual(steps, ["first:start"]);

	releaseFirst();
	await Promise.all([first, second]);

	assert.deepEqual(steps, ["first:start", "first:end", "second:start", "second:end"]);
});

void test("resetToolTelemetryState clears both in-progress and completed tool telemetry", () => {
	const toolCallsInProgress = new Map<string, { toolName: string }>([["call-1", { toolName: "read" }]]);
	const recentToolCalls = [makeToolCall("read", 1)];

	resetToolTelemetryState(toolCallsInProgress, recentToolCalls);

	assert.equal(toolCallsInProgress.size, 0);
	assert.deepEqual(recentToolCalls, []);
});
