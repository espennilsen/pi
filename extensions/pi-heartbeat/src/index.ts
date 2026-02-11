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
 *   - settings.json: { "pi-heartbeat": { "enabled": true } }
 *
 * Reads HEARTBEAT.md from cwd as a checklist of things to verify.
 * If HEARTBEAT.md is missing or empty, does a generic check.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolveSettings } from "./settings.ts";
import { HeartbeatRunner } from "./heartbeat.ts";

export default function (pi: ExtensionAPI) {
	let runner: HeartbeatRunner | null = null;
	let cwd = process.cwd();

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
		});
	}

	function startHeartbeat(): string {
		if (runner?.isActive()) return "Heartbeat is already running.";
		if (!runner) runner = createRunner();
		runner.start();
		return `✓ Heartbeat started (every ${resolveSettings(cwd).intervalMinutes}m)`;
	}

	function stopHeartbeat(): string {
		if (!runner?.isActive()) return "Heartbeat is not running.";
		runner.stop();
		return "✓ Heartbeat stopped";
	}

	// ── Lifecycle ─────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
		const settings = resolveSettings(cwd);

		if (pi.getFlag("--heartbeat") || settings.enabled) {
			runner = createRunner();
			runner.start();
			ctx.ui.setStatus("pi-heartbeat", "🫀 heartbeat active");
		}
	});

	pi.on("session_shutdown", async () => {
		if (runner) {
			runner.stop();
			runner = null;
		}
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
					const lines = [
						`Heartbeat: ✅ active (every ${s.intervalMinutes}m)`,
						`Runs: ${s.runCount} · OK: ${s.okCount} · Alerts: ${s.alertCount}`,
						s.lastRun ? `Last: ${s.lastRun.toLocaleTimeString()} (${s.lastResult?.ok ? "OK" : "alert"})` : "No runs yet",
					];
					ctx.ui.notify(lines.join("\n"), "info");
				}
			}
		},
	});
}
