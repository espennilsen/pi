/**
 * pi-heartbeat — Periodic health check extension for pi.
 *
 * Runs a configurable prompt on an interval as an isolated subprocess.
 * If the agent responds with HEARTBEAT_OK, the result is suppressed.
 * Otherwise, the alert is delivered via pi-channels event bus.
 *
 * Disabled by default. Enable with:
 *   - --heartbeat flag
 *   - /heartbeat on command
 *   - settings.json: { "pi-heartbeat": { "autostart": true } }
 *
 * Reads HEARTBEAT.md from cwd as a checklist of things to verify.
 * If HEARTBEAT.md is missing or empty, does a generic check.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolveSettings } from "./settings.ts";
import { HeartbeatRunner } from "./heartbeat.ts";
import { mountHeartbeatRoutes, unmountHeartbeatRoutes } from "./web.ts";
import { createLogger } from "./logger.ts";
import { setStore, isStoreReady, getStore, createMemoryStore, createKyselyStore, resetStore } from "./store.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	let runner: HeartbeatRunner | null = null;
	let cwd = process.cwd();
	let webMounted = false;
	let unsubKyselyReady: (() => void) | null = null;

	// ── Flag: --heartbeat ─────────────────────────────────────

	pi.registerFlag("heartbeat", {
		description: "Enable heartbeat health checks on startup",
		type: "boolean",
		default: false,
	});

	// ── Helpers ───────────────────────────────────────────────

	function createRunner(): HeartbeatRunner {
		const settings = resolveSettings(cwd);
		return new HeartbeatRunner(settings, cwd, {
			onCheck: () => {
				pi.events.emit("heartbeat:check", { time: new Date().toISOString() });
			},
			onResult: (result) => {
				pi.events.emit("heartbeat:result", {
					ok: result.ok,
					response: result.response.slice(0, 500),
					durationMs: result.durationMs,
					time: new Date().toISOString(),
				});
			},
			onAlert: (message) => {
				pi.events.emit("channel:send", {
					route: resolveSettings(cwd).route,
					text: message,
					source: "pi-heartbeat",
				});
			},
			log,
		});
	}

	function startHeartbeat(): string {
		if (runner?.isActive()) return "Heartbeat is already running.";
		if (!runner) runner = createRunner();
		runner.start();
		const interval = resolveSettings(cwd).intervalMinutes;
		log("start", { intervalMinutes: interval });
		return `✓ Heartbeat started (every ${interval}m)`;
	}

	function stopHeartbeat(): string {
		if (!runner?.isActive()) return "Heartbeat is not running.";
		runner.stop();
		log("stop", {});
		return "✓ Heartbeat stopped";
	}

	// ── Web UI mount helper ───────────────────────────────────

	function mountWeb(): void {
		if (webMounted) return;
		mountHeartbeatRoutes(pi.events, {
			getRunner: () => runner,
			startHeartbeat: () => startHeartbeat(),
			stopHeartbeat: () => stopHeartbeat(),
			createRunner: () => {
				if (!runner) runner = createRunner();
				return runner;
			},
		});
		webMounted = true;
	}

	function unmountWeb(): void {
		if (!webMounted) return;
		unmountHeartbeatRoutes(pi.events);
		webMounted = false;
	}

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
		const settings = resolveSettings(cwd);

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
					// Fall back to memory store
					setStore(createMemoryStore());
					log("fallback", { backend: "memory", reason: err.message }, "WARN");
				}
			};

			unsubKyselyReady = pi.events.on("kysely:ready", initKysely);

			log("init", { backend: "kysely", status: "probing for kysely" });
			let kyselyAlreadyReady = false;
			pi.events.emit("kysely:info", {
				reply: () => { kyselyAlreadyReady = true; },
			});
			if (kyselyAlreadyReady) {
				log("init", { backend: "kysely", status: "kysely already available" });
				await initKysely();
			} else {
				log("init", { backend: "kysely", status: "waiting for kysely:ready" });
			}
		} else {
			setStore(createMemoryStore());
			log("ready", { backend: "memory" });
		}

		if (pi.getFlag("--heartbeat") || settings.autostart) {
			runner = createRunner();
			runner.start();
			ctx.ui.setStatus("pi-heartbeat", "🫀 heartbeat active");
		}

		if (settings.webui) {
			mountWeb();
		}
	});

	pi.on("session_shutdown", async () => {
		unmountWeb();
		if (unsubKyselyReady) {
			unsubKyselyReady();
			unsubKyselyReady = null;
		}
		if (runner) {
			runner.stop();
			runner = null;
		}
		// Reset store to avoid stale state across sessions
		await resetStore();
	});

	// ── Command: /heartbeat ───────────────────────────────────

	pi.registerCommand("heartbeat", {
		description: "Toggle heartbeat: /heartbeat on | off | status | run",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "on", label: "on — Start periodic heartbeat checks" },
				{ value: "off", label: "off — Stop heartbeat checks" },
				{ value: "status", label: "status — Show heartbeat status" },
				{ value: "run", label: "run — Run a heartbeat check now" },
			];
			return items.filter((i) => i.value.startsWith(prefix));
		},
		handler: async (args, ctx) => {
			const arg = args?.trim().toLowerCase();

			if (arg === "on" || arg === "start") {
				const result = startHeartbeat();
				ctx.ui.notify(result, result.startsWith("✓") ? "info" : "error");
				if (result.startsWith("✓")) {
					ctx.ui.setStatus("pi-heartbeat", "🫀 heartbeat active");
				}
			} else if (arg === "off" || arg === "stop") {
				const result = stopHeartbeat();
				ctx.ui.notify(result, result.startsWith("✓") ? "info" : "error");
				ctx.ui.setStatus("pi-heartbeat", undefined);
			} else if (arg === "run" || arg === "now") {
				if (!runner) runner = createRunner();
				ctx.ui.notify("Running heartbeat check…", "info");
				const result = await runner.runNow();
				const msg = result.ok
					? `✅ HEARTBEAT_OK (${(result.durationMs / 1000).toFixed(1)}s)`
					: `🫀 Alert (${(result.durationMs / 1000).toFixed(1)}s):\n${result.response.slice(0, 200)}`;
				ctx.ui.notify(msg, result.ok ? "info" : "warning");
			} else {
				// Status
				const s = runner?.getStatus();
				if (!s || !s.active) {
					ctx.ui.notify("Heartbeat: inactive. Use /heartbeat on to start.", "info");
				} else {
					// Prefer DB stats over in-memory counters
					let runCount = s.runCount;
					let okCount = s.okCount;
					let alertCount = s.alertCount;
					let lastRunStr = s.lastRun ? s.lastRun.toLocaleTimeString() : null;
					let lastOkLabel = s.lastResult?.ok ? "OK" : "alert";

					if (isStoreReady()) {
						try {
							const dbStats = await getStore().getStats();
							runCount = dbStats.runCount;
							okCount = dbStats.okCount;
							alertCount = dbStats.alertCount;
							if (dbStats.lastRun) {
								lastRunStr = new Date(dbStats.lastRun).toLocaleTimeString();
								lastOkLabel = dbStats.lastOk ? "OK" : "alert";
							}
						} catch { /* fall back to in-memory */ }
					}

					const lines = [
						`Heartbeat: ✅ active (every ${s.intervalMinutes}m)`,
						`Runs: ${runCount} · OK: ${okCount} · Alerts: ${alertCount}`,
						lastRunStr ? `Last: ${lastRunStr} (${lastOkLabel})` : "No runs yet",
					];
					ctx.ui.notify(lines.join("\n"), "info");
				}
			}
		},
	});
}
