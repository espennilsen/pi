import test from "node:test";
import assert from "node:assert/strict";
import type { ToolCallRecord } from "./types.ts";
import {
	buildRecentToolCallsSnapshot,
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

void test("resetToolTelemetryState clears both in-progress and completed tool telemetry", () => {
	const toolCallsInProgress = new Map<string, { toolName: string }>([["call-1", { toolName: "read" }]]);
	const recentToolCalls = [makeToolCall("read", 1)];

	resetToolTelemetryState(toolCallsInProgress, recentToolCalls);

	assert.equal(toolCallsInProgress.size, 0);
	assert.deepEqual(recentToolCalls, []);
});
