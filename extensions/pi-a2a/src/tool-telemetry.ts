import type { ToolCallRecord } from "./types.ts";

/** Copy buffered tool calls into a snapshot payload without draining the buffer. */
export function buildRecentToolCallsSnapshot(recentToolCalls: readonly ToolCallRecord[]): ToolCallRecord[] | undefined {
	return recentToolCalls.length > 0 ? [...recentToolCalls] : undefined;
}

/** Drop only the tool calls that were successfully reported to the hub. */
export function drainRecentToolCalls(recentToolCalls: ToolCallRecord[], sentCount: number): void {
	if (sentCount <= 0) return;
	recentToolCalls.splice(0, sentCount);
}

/** Reset all in-memory tool telemetry state for a fresh session lifecycle. */
export function resetToolTelemetryState(
	toolCallsInProgress: Map<string, unknown>,
	recentToolCalls: ToolCallRecord[],
): void {
	toolCallsInProgress.clear();
	recentToolCalls.length = 0;
}
