/**
 * pi-supabase — Read-only Supabase integration for pi.
 *
 * Provides:
 *   - `supabase` tool — query, describe, tables, count, rpc, status
 *   - Realtime subscriptions → pi-channels notifications
 *   - Optional query logging via pi-kysely
 *
 * Configure in settings.json:
 *   "pi-supabase": {
 *     "url": "https://xxx.supabase.co",
 *     "anonKey": "eyJ...",
 *     "useKysely": false,
 *     "notifications": {
 *       "enabled": true,
 *       "route": "ops",
 *       "tables": ["users", "orders"]
 *     }
 *   }
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveSettings } from "./settings.ts";
import { initClient, resetClient, isClientReady, getClient } from "./client.ts";
import { registerSupabaseTool, setRpcAllowList } from "./tool.ts";
import { startSubscriptions, stopSubscriptions } from "./realtime.ts";
import { setStore, isStoreReady, createMemoryStore, createKyselyStore, resetStore } from "./store.ts";
import { createLogger } from "./logger.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	let unsubKyselyReady: (() => void) | null = null;

	// ── Tool (available immediately, guards on client readiness) ──

	registerSupabaseTool(pi);

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const settings = resolveSettings(ctx.cwd);

		// ── Initialize store ────────────────────────────────────
		if (settings.useKysely) {
			const initKysely = async () => {
				if (isStoreReady()) return;
				try {
					const store = await createKyselyStore(pi.events as any);
					setStore(store);
					log("ready", { backend: "kysely" });
				} catch (err: any) {
					log("error", { backend: "kysely", error: err.message }, "ERROR");
					setStore(createMemoryStore());
					log("fallback", { backend: "memory", reason: err.message }, "WARN");
				}
			};

			unsubKyselyReady = pi.events.on("kysely:ready", initKysely);

			log("init", { backend: "kysely", status: "probing" });
			let kyselyAlreadyReady = false;
			pi.events.emit("kysely:info", {
				reply: () => { kyselyAlreadyReady = true; },
			});
			if (kyselyAlreadyReady) {
				await initKysely();
			} else {
				log("init", { backend: "kysely", status: "waiting for kysely:ready" });
			}
		} else {
			setStore(createMemoryStore());
			log("ready", { backend: "memory" });
		}

		// ── Initialize Supabase client ──────────────────────────
		if (!settings.url || (!settings.anonKey && !settings.serviceRoleKey)) {
			log("skip", { reason: "url or key not configured" });
			return;
		}

		// ── Configure RPC allow-list ────────────────────────────
		setRpcAllowList(settings.rpc.allowList);

		try {
			initClient(settings);
			log("connected", { url: settings.url, useServiceRole: settings.useServiceRole });
			ctx.ui.setStatus("pi-supabase", "🔌 supabase");
		} catch (err: any) {
			log("error", { error: err.message }, "ERROR");
			ctx.ui.notify(`pi-supabase: ${err.message}`, "error");
			return;
		}

		// ── Start realtime subscriptions ────────────────────────
		if (settings.notifications.enabled && settings.notifications.tables.length > 0) {
			startSubscriptions(getClient(), settings.notifications, pi.events as any, log);
			log("realtime", { tables: settings.notifications.tables });
		}
	});

	pi.on("session_shutdown", async () => {
		if (unsubKyselyReady) {
			unsubKyselyReady();
			unsubKyselyReady = null;
		}

		if (isClientReady()) {
			stopSubscriptions(getClient());
		}
		resetClient();
		await resetStore();
	});
}
