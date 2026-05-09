import type { TelemetrySnapshot, ToolCallRecord } from "./types.ts";

/** Copy buffered tool calls into a snapshot payload without draining the buffer. */
export function buildRecentToolCallsSnapshot(recentToolCalls: readonly ToolCallRecord[]): ToolCallRecord[] | undefined {
	return recentToolCalls.length > 0 ? [...recentToolCalls] : undefined;
}

/** Build the final idle snapshot sent during shutdown, including any unsent tool calls. */
export function buildIdleTelemetrySnapshot(recentToolCalls: readonly ToolCallRecord[]): TelemetrySnapshot {
	const snapshot: TelemetrySnapshot = {
		queueDepth: 0,
		activeTasks: 0,
		maxConcurrent: 1,
	};
	const toolCallSnapshot = buildRecentToolCallsSnapshot(recentToolCalls);
	if (toolCallSnapshot !== undefined) snapshot.recentToolCalls = toolCallSnapshot;
	return snapshot;
}

/** Serialize async telemetry operations so snapshot + drain stays atomic. */
export function createSerializedAsyncRunner() {
	let queue = Promise.resolve();
	return async function runSerialized<T>(operation: () => Promise<T>): Promise<T> {
		const result = queue.then(operation, operation);
		queue = result.then(() => undefined, () => undefined);
		return result;
	};
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
