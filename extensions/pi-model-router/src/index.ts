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
import { resolveSettings, type RouterSettings, type Tier } from "./settings.ts";
import { matchOverride } from "./rules.ts";
import { ClassificationCache } from "./cache.ts";
import { classify } from "./classifier.ts";
import { resolveModel } from "./resolver.ts";
import { createLogger } from "./logger.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	let settings: RouterSettings;
	let cache: ClassificationCache;

	pi.on("session_start", async (_event, ctx) => {
		settings = resolveSettings(ctx.cwd);
		cache = new ClassificationCache(settings.cache);
		log("init", { interactive: settings.interactive, default: settings.default });
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!settings) return;

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
			source = "cache";
		}

		// ── 3. LLM classifier ──────────────────────────────
		if (!tier) {
			tier = await classify(prompt, settings.classifier, ctx.modelRegistry);
			source = "classifier";

			if (tier) {
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
			if (currentModel && currentModel.id !== model.id) {
				ctx.ui.notify(
					`💡 Model router: "${tier}" task — consider ${model.name} (currently ${currentModel.name})`,
					"info",
				);
			}
			return; // Don't auto-switch in suggest mode
		}

		// ── Switch model ────────────────────────────────────
		const switched = await pi.setModel(model);
		if (switched && target.thinking) {
			pi.setThinkingLevel(target.thinking as any);
		}

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
	});
}
