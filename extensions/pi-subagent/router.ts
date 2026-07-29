/**
 * pi-subagent — Message router.
 *
 * Handles message routing policy and cycle detection for the agent pool.
 * Prevents deadlocks when agent A sends to B which sends back to A.
 */

export class MessageRouter {
	/** Map of agentId → agentId it's currently waiting on */
	private waitingOn = new Map<string, string>();

	/**
	 * Check if sending from → to would create a cycle (deadlock).
	 * A cycle exists if `to` is (transitively) waiting on `from`.
	 */
	wouldCycle(fromId: string, toId: string): boolean {
		let current = toId;
		const visited = new Set<string>();
		while (this.waitingOn.has(current)) {
			if (current === fromId) return true;
			if (visited.has(current)) return true; // shouldn't happen, but safety
			visited.add(current);
			current = this.waitingOn.get(current)!;
		}
		return current === fromId;
	}

	/** Mark that `fromId` is now waiting on `toId` (blocking send). */
	markWaiting(fromId: string, toId: string): void {
		this.waitingOn.set(fromId, toId);
	}

	/** Clear the waiting state for `fromId` (send completed). */
	clearWaiting(fromId: string): void {
		this.waitingOn.delete(fromId);
	}

	/** Get all current waiting relationships (for debugging). */
	getWaitGraph(): Array<{ from: string; to: string }> {
		return Array.from(this.waitingOn.entries()).map(([from, to]) => ({ from, to }));
	}

	/** Reset all state. */
	reset(): void {
		this.waitingOn.clear();
	}
}
