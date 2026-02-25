/**
 * pi-model-router — LLM-classified model routing for pi.
 *
 * Shims into any pi subprocess (cron, heartbeat, subagent) or TUI session.
 * Hooks `before_agent_start` to classify the prompt and switch the active
 * model before the first LLM call.
 *
 * Resolution chain (first match wins):
 *   1. Static override (regex on prompt)
 *   2. Cache hit (prompt hash)
 *   3. LLM classifier (cheap model)
 *   4. Default tier
 *
 * Mode-aware:
 *   - Subprocess (pi -p): always auto-switch
 *   - TUI (ctx.hasUI):    configurable — off / suggest / auto
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolveSettings, type InteractiveMode, type RouterSettings, type Tier } from "./settings.ts";
import { matchOverride } from "./rules.ts";
import { ClassificationCache } from "./cache.ts";
import { classify } from "./classifier.ts";
import { resolveModel } from "./resolver.ts";
import { findModel } from "./match.ts";

const CH = "pi-model-router";

export default function (pi: ExtensionAPI) {
	const log = (event: string, data: unknown, level: string = "INFO") =>
		pi.events.emit("log", { channel: CH, event, data, level });

	let settings: RouterSettings;
	let cache: ClassificationCache;
	let enabled = true;

	// ── /model-router command ───────────────────────────────
	pi.registerCommand("model-router", {
		description: "Control model router — toggle on/off, check status, set mode",
		getArgumentCompletions: (prefix) => {
			const subcommands = [
				{ value: "on", label: "on — enable routing" },
				{ value: "off", label: "off — disable routing" },
				{ value: "status", label: "status — show current state" },
				{ value: "suggest", label: "suggest — switch to suggest mode" },
				{ value: "auto", label: "auto — switch to auto mode" },
			];
			const filtered = subcommands.filter((s) => s.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const sub = args.trim().toLowerCase();

			if (sub === "off") {
				enabled = false;
				ctx.ui.notify("🔌 Model router disabled", "info");
			} else if (sub === "on") {
				enabled = true;
				ctx.ui.notify("⚡ Model router enabled", "info");
			} else if (sub === "suggest" || sub === "auto") {
				if (!settings) {
					ctx.ui.notify("Model router not initialized", "warning");
					return;
				}
				enabled = true;
				settings.interactive = sub as InteractiveMode;
				ctx.ui.notify(`⚡ Model router: interactive mode → ${sub}`, "info");
			} else if (sub === "status") {
				if (!settings) {
					ctx.ui.notify("Model router not initialized", "warning");
					return;
				}
				const tiers = Object.entries(settings.tiers)
					.map(([k, v]) => `  ${k}: ${v.model} (thinking: ${v.thinking})`)
					.join("\n");
				ctx.ui.notify(
					[
						`Model router: ${enabled ? "✅ enabled" : "❌ disabled"}`,
						`Mode: ${settings.interactive}`,
						`Default tier: ${settings.default}`,
						`Classifier: ${settings.classifier.model}`,
						`Cache: ~${cache.size} entries (incl. expired)`,
						`Tiers:\n${tiers}`,
					].join("\n"),
					"info",
				);
			} else {
				// No arg or unknown — toggle
				enabled = !enabled;
				ctx.ui.notify(enabled ? "⚡ Model router enabled" : "🔌 Model router disabled", "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const result = resolveSettings(ctx.cwd);
		settings = result.settings;
		if (result.configError) {
			log("config-error", { error: result.configError }, "WARN");
		}
		if (result.skippedOverrides?.length) {
			log("invalid-overrides", { patterns: result.skippedOverrides }, "WARN");
		}

		cache = new ClassificationCache(settings.cache);

		const classifierModel = findModel(settings.classifier.model, ctx.modelRegistry);
		if (!classifierModel) {
			log("classifier-model-not-found", { model: settings.classifier.model }, "WARN");
		}

		log("init", { interactive: settings.interactive, default: settings.default });
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!settings || !cache || !enabled) return;

		// ── Mode check ──────────────────────────────────────
		const isInteractive = ctx.hasUI;
		if (isInteractive && settings.interactive === "off") return;

		const prompt = event.prompt;
		if (!prompt) return;

		const startTime = Date.now();

		// ── 1. Static override ──────────────────────────────
		let tier: Tier | null = matchOverride(settings.overrides, prompt);
		let source: "override" | "cache" | "classifier" | "default" = "override";

		// ── 2. Cache ────────────────────────────────────────
		if (!tier) {
			tier = cache.get(prompt);
			if (tier) source = "cache";
		}

		// ── 3. LLM classifier ──────────────────────────────
		if (!tier) {
			tier = await classify(prompt, settings.classifier, ctx.modelRegistry, log);

			if (tier) {
				source = "classifier";
				cache.set(prompt, tier);
			}
		}

		// ── 4. Default fallback ─────────────────────────────
		if (!tier) {
			tier = settings.default;
			source = "default";
		}

		const target = settings.tiers[tier];
		if (!target) return;

		const latencyMs = Date.now() - startTime;

		// ── Resolve model ───────────────────────────────────
		const model = resolveModel(target, ctx.modelRegistry);
		if (!model) {
			log("resolve-failed", { tier, target: target.model }, "WARN");
			return;
		}

		// ── Interactive suggest mode ────────────────────────
		if (isInteractive && settings.interactive === "suggest") {
			const currentModel = ctx.model;
			if (ctx.ui && currentModel && currentModel.id !== model.id) {
				ctx.ui.notify(
					`💡 Model router: "${tier}" task — consider ${model.name} (currently ${currentModel.name})`,
					"info",
				);

				log("suggested", {
					tier,
					source,
					model: model.id,
					thinking: target.thinking,
					latencyMs,
				});

				pi.events.emit("model-router:suggested", {
					tier,
					source,
					model: model.id,
					thinking: target.thinking,
					latencyMs,
				});
			}

			return; // Don't auto-switch in suggest mode
		}

		// ── Switch model ────────────────────────────────────
		try {
			const switched = await pi.setModel(model);

			// Always apply thinking level — even if model didn't change, the tier's
			// thinking level may differ from the current one (e.g. same model, different tier)
			pi.setThinkingLevel(target.thinking);

			log("routed", {
				tier,
				source,
				model: model.id,
				thinking: target.thinking,
				switched,
				latencyMs,
				cached: source === "cache",
			});

			pi.events.emit("model-router:routed", {
				tier,
				source,
				model: model.id,
				thinking: target.thinking,
				switched,
				latencyMs,
				cached: source === "cache",
			});
		} catch (err) {
			log("switch-error", { tier, model: model.id, error: String(err) }, "WARN");
		}
	});
}
