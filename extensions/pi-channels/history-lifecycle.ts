import type { EventBus } from "@earendil-works/pi-coding-agent";
import { MessageHistory } from "./history.ts";

/** Info and ready are registry snapshots, not guarantees that a default DB exists. */
function hasDefaultDatabase(payload: unknown): boolean {
	if (!payload || typeof payload !== "object") return false;
	const info = payload as { defaultDatabase?: unknown; databases?: unknown };
	return typeof info.defaultDatabase === "string" && Array.isArray(info.databases)
		&& info.databases.some(db => db?.name === info.defaultDatabase);
}

/** Start a session-scoped readiness subscription without blocking other startup handlers. */
export function startHistory(
	events: EventBus,
	retentionDays: number,
	publish: (history: MessageHistory | null) => void,
	log: (event: string, data: unknown, level?: string) => void,
	warn: (message: string) => void,
): () => void {
	const history = new MessageHistory(events, retentionDays);
	history.setErrorLogger(log);
	let stopped = false;
	let initializing = false;
	let initialized = false;
	let unsubscribe: (() => void) | undefined;

	// Diagnostic only: keep the subscription alive for eventual readiness.
	const timeout = setTimeout(() => {
		if (!stopped) warn("pi-channels: Message history unavailable (pi-kysely default database not ready); waiting for readiness");
	}, 10_000);
	timeout.unref?.();

	const onReady = (info: unknown) => {
		if (stopped || initializing || initialized || !hasDefaultDatabase(info)) return;
		initializing = true;
		clearTimeout(timeout);
		void history.init().then(() => {
			if (stopped) return;
			initialized = true;
			unsubscribe?.();
			publish(history);
			log("history-init", { retentionDays });
		}).catch(error => {
			if (stopped) return;
			log("history-init-failed", { error }, "ERROR");
			warn(`pi-channels: Message history unavailable (${error instanceof Error ? error.message : String(error)})`);
		}).finally(() => { initializing = false; });
	};

	publish(null);
	unsubscribe = events.on("kysely:ready", onReady);
	events.emit("kysely:info", { reply: onReady });

	return () => {
		if (stopped) return;
		stopped = true;
		clearTimeout(timeout);
		unsubscribe?.();
		history.dispose();
		publish(null);
	};
}
