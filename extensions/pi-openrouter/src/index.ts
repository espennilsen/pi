import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { login, refreshToken, getApiKey } from "./oauth.ts";
import { loadCache, saveCache, fetchModels, filterModels, toProviderModel } from "./models.ts";
import { resolveSettings, type OpenRouterSettings } from "./settings.ts";

const PROVIDER_NAME = "openrouter";
const BASE_URL = "https://openrouter.ai/api/v1";

export default function (pi: ExtensionAPI) {
	let settings: OpenRouterSettings = resolveSettings(process.cwd());

	// ── Load cached models and register provider ─────────────────────────────
	const cached = loadCache();
	const filtered = filterModels(cached, settings.models);
	const models = filtered.map(toProviderModel);

	pi.registerProvider(PROVIDER_NAME, {
		baseUrl: BASE_URL,
		api: "openai-completions",
		authHeader: true,
		models,
		oauth: {
			name: "OpenRouter OAuth",
			login,
			refreshToken,
			getApiKey,
		},
	});

	// ── Refresh models on session start ──────────────────────────────────────
	pi.on("session_start", async (_event, ctx) => {
		settings = resolveSettings(ctx.cwd);

		try {
			const fresh = await fetchModels();
			saveCache(fresh);
			const filtered = filterModels(fresh, settings.models);

			pi.registerProvider(PROVIDER_NAME, {
				baseUrl: BASE_URL,
				api: "openai-completions",
				authHeader: true,
				models: filtered.map(toProviderModel),
				oauth: {
					name: "OpenRouter OAuth",
					login,
					refreshToken,
					getApiKey,
				},
			});
		} catch {
			// Offline or API down — cached models (if any) are already registered
		}
	});

	// ── /openrouter command ──────────────────────────────────────────────────
	pi.registerCommand("openrouter", {
		description: "Manage OpenRouter: /openrouter [models|refresh]",
		getArgumentCompletions: (prefix: string) =>
			[
				{ value: "models", label: "List registered models" },
				{ value: "refresh", label: "Fetch latest models from API" },
			].filter((i) => i.value.startsWith(prefix)),
		handler: async (args, ctx) => {
			const cmd = args?.trim().split(/\s+/) ?? [];
			const action = cmd[0]?.toLowerCase();

			if (action === "refresh") {
				await handleRefresh(ctx);
			} else if (action === "models") {
				const search = cmd.slice(1).join(" ").toLowerCase();
				handleListModels(ctx, search);
			} else {
				handleStatus(ctx);
			}
		},
	});

	// ── Command handlers ─────────────────────────────────────────────────────

	async function handleRefresh(ctx: { ui: { notify: (msg: string, type?: "info" | "error" | "warning") => void } }) {
		ctx.ui.notify("Fetching models from OpenRouter...", "info");
		try {
			const fresh = await fetchModels();
			saveCache(fresh);
			const filtered = filterModels(fresh, settings.models);
			const mapped = filtered.map(toProviderModel);

			pi.registerProvider(PROVIDER_NAME, {
				baseUrl: BASE_URL,
				api: "openai-completions",
				authHeader: true,
				models: mapped,
				oauth: {
					name: "OpenRouter OAuth",
					login,
					refreshToken,
					getApiKey,
				},
			});

			ctx.ui.notify(`Refreshed: ${mapped.length} models registered (${fresh.length} total available)`, "info");
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`Failed to refresh: ${msg}`, "error");
		}
	}

	function handleListModels(
		ctx: { ui: { notify: (msg: string, type?: "info" | "error" | "warning") => void } },
		search: string,
	) {
		const cached = loadCache();
		const filtered = filterModels(cached, settings.models);

		let display = filtered;
		if (search) {
			display = display.filter(
				(m) => m.id.toLowerCase().includes(search) || m.name.toLowerCase().includes(search),
			);
		}

		if (display.length === 0) {
			ctx.ui.notify(
				search ? `No models matching "${search}"` : "No models registered. Run /openrouter refresh",
				"info",
			);
			return;
		}

		const lines = display
			.sort((a, b) => a.id.localeCompare(b.id))
			.map((m) => {
				const pricing = m.pricing;
				const inp = (parseFloat(pricing.prompt ?? "0") * 1_000_000).toFixed(2);
				const out = (parseFloat(pricing.completion ?? "0") * 1_000_000).toFixed(2);
				const ctx = m.context_length?.toLocaleString() ?? "?";
				return `  ${m.id} — $${inp}/$${out} per M tokens, ${ctx} ctx`;
			});

		ctx.ui.notify(
			`OpenRouter models (${display.length}/${cached.length} total):\n${lines.join("\n")}`,
			"info",
		);
	}

	function handleStatus(ctx: { ui: { notify: (msg: string, type?: "info" | "error" | "warning") => void } }) {
		const cached = loadCache();
		const filtered = filterModels(cached, settings.models);

		const lines = [
			`Models: ${filtered.length} registered (${cached.length} cached)`,
			`Patterns: ${settings.models.join(", ")}`,
			`Provider: ${PROVIDER_NAME}`,
			"",
			"Commands:",
			"  /openrouter models [search]  — List registered models",
			"  /openrouter refresh          — Fetch latest from API",
			"",
			"Settings (in settings.json):",
			'  "pi-openrouter": { "models": ["anthropic/*", "openai/gpt-5*", ...] }',
		];

		ctx.ui.notify(lines.join("\n"), "info");
	}
}
