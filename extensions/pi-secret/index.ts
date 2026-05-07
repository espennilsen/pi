import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";
import { homedir } from "node:os";
import { relative, resolve } from "node:path";
import { createSecretApi, installSecretRegistry, uninstallSecretRegistry } from "./registry.ts";
import { SecretPolicyError, validateIdentifier } from "./policy.ts";
import type { PiSecretApi, PiSecretSettings } from "./types.ts";

const SETTINGS_KEY = "pi-secret";

/**
 * pi-secret is deliberately not a normal LLM tool.
 *
 * Pi extensions run host-side and may be exposed to the model as tools/capabilities.
 * A raw "get secret" tool would put plaintext credentials into tool results and the
 * conversation context. Instead, this extension installs a host-only dependency API
 * on globalThis.__piSecret for trusted first-party extensions to call directly.
 */
export default function (pi: ExtensionAPI) {
	let api: PiSecretApi | undefined;
	let settings: PiSecretSettings = {};

	function ensureApi(): PiSecretApi {
		if (!api) {
			api = createSecretApi({ settings });
			installSecretRegistry(api);
		}
		return api;
	}

	pi.on("session_start", async (_event, ctx) => {
		settings = loadSettings(ctx.cwd);
		if (api) uninstallSecretRegistry(api);
		api = createSecretApi({ settings });
		installSecretRegistry(api);
		ctx.ui.setStatus("pi-secret", settings.allowFallback === false ? "secrets: keychain-only" : "secrets: keychain+fallback");
	});

	pi.on("session_shutdown", async () => {
		if (api) uninstallSecretRegistry(api);
		api = undefined;
	});

	pi.registerCommand("pi-secret-set", {
		description: "Set a managed secret without exposing its value to the LLM: /pi-secret-set <extension> <name>",
		getArgumentCompletions: () => null,
		handler: async (args, ctx) => {
			const secretApi = ensureApi();
			const parsed = parseExtensionAndSecret(args);
			if (!parsed) {
				ctx.ui.notify("Usage: /pi-secret-set <extension> <name>. The value is always prompted separately.", "warning");
				return;
			}
			const { extensionId, secretName } = parsed;
			if (!ctx.hasUI) {
				ctx.ui.notify("pi-secret-set requires interactive UI so the secret is not passed in command text.", "error");
				return;
			}

			const confirmed = await ctx.ui.confirm(
				"Set secret?",
				`Store secret "${secretName}" for extension "${extensionId}". Do not paste this value into prompts, files, or shell commands.`,
			);
			if (!confirmed) return;

			const value = await ctx.ui.input(`Secret value for ${extensionId}/${secretName}:`, "paste secret value");
			if (!value) {
				ctx.ui.notify("No secret stored.", "warning");
				return;
			}

			try {
				await secretApi.setSecret(extensionId, secretName, value);
				ctx.ui.notify(`Stored secret ${extensionId}/${secretName}. Plaintext was not returned to the model.`, "info");
			} catch (error) {
				ctx.ui.notify(`Failed to store secret: ${safeErrorMessage(error)}`, "error");
			}
		},
	});

	pi.registerCommand("pi-secret-delete", {
		description: "Delete a managed secret: /pi-secret-delete <extension> <name>",
		getArgumentCompletions: () => null,
		handler: async (args, ctx) => {
			const secretApi = ensureApi();
			const parsed = parseExtensionAndSecret(args);
			if (!parsed) {
				ctx.ui.notify("Usage: /pi-secret-delete <extension> <name>", "warning");
				return;
			}
			const { extensionId, secretName } = parsed;
			const confirmed = await ctx.ui.confirm("Delete secret?", `Delete secret "${secretName}" for extension "${extensionId}"?`);
			if (!confirmed) return;
			try {
				await secretApi.deleteSecret(extensionId, secretName);
				ctx.ui.notify(`Deleted secret ${extensionId}/${secretName}.`, "info");
			} catch (error) {
				ctx.ui.notify(`Failed to delete secret: ${safeErrorMessage(error)}`, "error");
			}
		},
	});

	pi.registerCommand("pi-secret-list", {
		description: "List managed secrets and whether values are configured. Values are never shown.",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			const secretApi = ensureApi();
			try {
				const items = await secretApi.listSecrets();
				if (items.length === 0) {
					ctx.ui.notify("pi-secret has no managed secrets in policy.", "info");
					return;
				}
				const lines = items.map((item) => `${item.present ? "✓" : "·"} ${item.extensionId}/${item.secretName}`);
				ctx.ui.notify(`pi-secret managed secrets (values hidden):\n${lines.join("\n")}`, "info");
			} catch (error) {
				ctx.ui.notify(`Failed to list secrets: ${safeErrorMessage(error)}`, "error");
			}
		},
	});
}

function loadSettings(cwd: string): PiSecretSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, unknown>;
		const project = sm.getProjectSettings() as Record<string, unknown>;
		const cfg = {
			...((global[SETTINGS_KEY] as Record<string, unknown> | undefined) ?? {}),
			...((project[SETTINGS_KEY] as Record<string, unknown> | undefined) ?? {}),
		};
		const settings: PiSecretSettings = {
			allowFallback: typeof cfg.allowFallback === "boolean" ? cfg.allowFallback : true,
			fallbackFile: typeof cfg.fallbackFile === "string" ? cfg.fallbackFile : undefined,
			policy: typeof cfg.policy === "object" && cfg.policy !== null ? (cfg.policy as PiSecretSettings["policy"]) : undefined,
		};
		if (settings.fallbackFile && isInside(cwd, settings.fallbackFile)) {
			throw new SecretPolicyError("pi-secret fallbackFile must not be inside the current project workspace");
		}
		return settings;
	} catch (error) {
		if (error instanceof SecretPolicyError) throw error;
		return { allowFallback: true };
	}
}

function parseExtensionAndSecret(args: string | undefined): { extensionId: string; secretName: string } | undefined {
	const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
	if (parts.length !== 2) return undefined;
	try {
		return {
			extensionId: validateIdentifier(parts[0] ?? "", "extensionId"),
			secretName: validateIdentifier(parts[1] ?? "", "secretName"),
		};
	} catch {
		return undefined;
	}
}

function isInside(cwd: string, candidate: string): boolean {
	const expanded = candidate.replace(/^~(?=$|\/)/, homedir());
	const rel = relative(resolve(cwd), resolve(expanded));
	return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

function safeErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : "Unknown error";
	return message
		.replace(/(password|secret|token|api[_-]?key)=([^\s,;]+)/gi, "$1=<redacted>")
		.replace(/sk-[A-Za-z0-9_-]{8,}/g, "<redacted>")
		.replace(/[A-Za-z0-9_\-]{32,}/g, "<redacted>");
}
