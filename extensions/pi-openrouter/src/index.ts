import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { login, refreshToken, getApiKey } from "./oauth.ts";
import { loadCache, saveCache, fetchModels, filterModels, toProviderModel } from "./models.ts";
import { resolveSettings, type OpenRouterSettings } from "./settings.ts";

const PROVIDER_NAME = "openrouter-oauth";
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
	pi.on("session_start", async (_event: any, ctx: any) => {
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
		description: "Manage OpenRouter: /openrouter [refresh]",
		getArgumentCompletions: (prefix: string) =>
			[{ value: "refresh", label: "Fetch latest models from API" }].filter((i) => i.value.startsWith(prefix)),
		handler: async (args: string | undefined, ctx: any) => {
			const cmd = args?.trim().toLowerCase();

			if (cmd === "refresh") {
				await handleRefresh(ctx);
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

	function handleStatus(ctx: { ui: { notify: (msg: string, type?: "info" | "error" | "warning") => void } }) {
		const cached = loadCache();
		const filtered = filterModels(cached, settings.models);

		const lines = [
			`Models: ${filtered.length} registered (${cached.length} cached)`,
			`Patterns: ${settings.models.join(", ")}`,
			"",
			"Run /openrouter refresh to fetch latest models",
		];

		ctx.ui.notify(lines.join("\n"), "info");
	}

	// Event bus listener for web/mobile slash command support
	pi.events.on("command:openrouter", async (data: unknown) => {
		const { args: rawArgs } = data as { args: string };
		const cmd = rawArgs?.trim().toLowerCase();
		const shimmedCtx = {
			ui: {
				notify: (msg: string, type?: "info" | "error" | "warning") => {
					pi.sendMessage({ customType: "command_result", content: msg, display: true, details: { type: type ?? "info" } });
					pi.events.emit("command_result", { command: "openrouter", message: msg, type: type ?? "info" });
				},
			},
		};
		if (cmd === "refresh") {
			await handleRefresh(shimmedCtx);
		} else {
			handleStatus(shimmedCtx);
		}
	});
}
