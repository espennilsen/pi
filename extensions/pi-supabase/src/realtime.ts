/**
 * pi-supabase — Realtime subscriptions.
 *
 * Subscribes to Supabase Realtime changes on configured tables
 * and forwards them as notifications via pi-channels event bus.
 *
 * Requires Supabase Realtime to be enabled on the target tables.
 */

import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import type { NotificationSettings } from "./settings.ts";

type LogFn = (event: string, data: unknown, level?: string) => void;

interface EventBus {
	emit(event: string, data: unknown): void;
}

const channels: RealtimeChannel[] = [];

export function startSubscriptions(
	client: SupabaseClient,
	settings: NotificationSettings,
	eventBus: EventBus,
	log: LogFn,
): void {
	if (!settings.enabled || settings.tables.length === 0) return;

	for (const table of settings.tables) {
		const channel = client
			.channel(`pi-supabase:${table}`)
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table },
				(payload) => {
					const eventType = payload.eventType; // INSERT, UPDATE, DELETE
					const record = (payload.new ?? payload.old ?? {}) as Record<string, any>;

					log("realtime", { table, event: eventType, id: record.id }, "INFO");

					// Build a human-readable notification
					const emoji = eventType === "INSERT" ? "➕" : eventType === "UPDATE" ? "✏️" : "🗑️";
					const lines = [
						`${emoji} **${table}** — ${eventType}`,
					];

					// Show key fields (avoid dumping entire records)
					const preview = buildPreview(record, eventType);
					if (preview) lines.push(preview);

					if (payload.old && eventType === "UPDATE") {
						const changes = diffFields(payload.old as Record<string, unknown>, payload.new as Record<string, unknown>);
						if (changes) lines.push(`Changed: ${changes}`);
					}

					eventBus.emit("channel:send", {
						route: settings.route,
						text: lines.join("\n"),
						source: "pi-supabase",
					});
				},
			)
			.subscribe((status) => {
				log("subscription", { table, status }, status === "SUBSCRIBED" ? "INFO" : "WARN");
			});

		channels.push(channel);
	}

	log("realtime-start", { tables: settings.tables });
}

export function stopSubscriptions(client: SupabaseClient): void {
	for (const channel of channels) {
		client.removeChannel(channel);
	}
	channels.length = 0;
}

// ── Helpers ─────────────────────────────────────────────────────

function buildPreview(record: Record<string, unknown>, eventType: string): string {
	const fields: string[] = [];
	const previewKeys = ["id", "name", "title", "email", "status", "type"];

	for (const key of previewKeys) {
		if (record[key] !== undefined && record[key] !== null) {
			fields.push(`${key}: ${String(record[key]).slice(0, 100)}`);
		}
	}

	if (fields.length === 0) {
		// Fallback: show first 3 keys
		const keys = Object.keys(record).slice(0, 3);
		for (const key of keys) {
			if (record[key] !== undefined && record[key] !== null) {
				fields.push(`${key}: ${String(record[key]).slice(0, 100)}`);
			}
		}
	}

	return fields.length > 0 ? fields.join(" · ") : "";
}

function diffFields(oldRecord: Record<string, unknown>, newRecord: Record<string, unknown>): string | null {
	const changed: string[] = [];
	for (const key of Object.keys(newRecord)) {
		if (JSON.stringify(oldRecord[key]) !== JSON.stringify(newRecord[key])) {
			changed.push(key);
		}
	}
	return changed.length > 0 ? changed.join(", ") : null;
}
