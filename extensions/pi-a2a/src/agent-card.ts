/**
 * pi-a2a — Agent Card builder.
 *
 * Produces agent cards in two formats:
 *
 * 1. **SDK format** — used internally by @a2a-js/sdk for JSON-RPC handling.
 *    The SDK has its own `AgentCard` type with some field name differences
 *    from the official spec (e.g. `additionalInterfaces` vs `supportedInterfaces`,
 *    `transport` vs `protocolBinding`). These are handled by the SDK internally.
 *
 * 2. **Spec format** — served at `/.well-known/agent.json` per the A2A spec.
 *    Uses **camelCase** field names as mandated by spec §5.5:
 *    "All JSON serializations MUST use camelCase naming for field names."
 *    Field names follow the spec exactly: `supportedInterfaces`, `protocolBinding`,
 *    `protocolVersion`, `pushNotifications`, `defaultInputModes`, etc.
 */

import type { AgentCard, AgentSkill } from "@a2a-js/sdk";
import type { A2AConfig } from "./types.ts";

/** Minimal tool info matching pi's ToolInfo type. */
export interface ToolInfo {
	name: string;
	description: string;
}

/**
 * Spec-compliant agent card (§4.4.1 AgentCard), served at /.well-known/agent.json.
 *
 * Field names are camelCase per §5.5, matching the official A2A spec exactly.
 * This is distinct from the SDK's internal type which uses slightly different names.
 */
export interface SpecAgentCard {
	name: string;
	description: string;
	version: string;
	/** §4.4.6 — required, ordered list of supported interfaces. */
	supportedInterfaces: Array<{
		url: string;
		protocolBinding: string;
		protocolVersion: string;
		tenant?: string;
	}>;
	provider?: {
		url: string;
		organization: string;
	};
	/** §4.4.3 — all fields optional. */
	capabilities: {
		streaming?: boolean;
		pushNotifications?: boolean;
		extensions?: Array<{
			uri: string;
			description?: string;
			required?: boolean;
			params?: Record<string, unknown>;
		}>;
		extendedAgentCard?: boolean;
	};
	defaultInputModes: string[];
	defaultOutputModes: string[];
	skills: Array<{
		id: string;
		name: string;
		description: string;
		tags: string[];
		examples?: string[];
		inputModes?: string[];
		outputModes?: string[];
	}>;
	documentationUrl?: string;
	iconUrl?: string;
	securitySchemes?: Record<string, unknown>;
	securityRequirements?: Array<Record<string, string[]>>;
	signatures?: Array<{
		protected: string;
		signature: string;
		header?: Record<string, unknown>;
	}>;
}

/** Built-in tools that are always present — no need to advertise individually. */
const BUILTIN_TOOL_NAMES = new Set([
	"bash",
	"read",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
]);

const DEFAULT_SKILLS: AgentSkill[] = [
	{
		id: "general_coding",
		name: "General Coding",
		description: "Read, write, edit, and debug code across languages and frameworks",
		tags: ["coding", "development"],
		examples: ["Fix the bug in auth.ts", "Add input validation to the signup form"],
	},
	{
		id: "file_operations",
		name: "File Operations",
		description: "Read, create, and modify files in the project",
		tags: ["files", "editing"],
		examples: ["Create a new config file", "Read the contents of package.json"],
	},
	{
		id: "shell_commands",
		name: "Shell Commands",
		description: "Execute bash commands for builds, tests, and system operations",
		tags: ["bash", "shell", "cli"],
		examples: ["Run the test suite", "Install the missing dependency"],
	},
];

const PROTOCOL_VERSION = "0.3";

/**
 * Build an A2A Agent Card (SDK format).
 *
 * Used internally by the SDK's DefaultRequestHandler for JSON-RPC protocol handling.
 * The SDK has its own field names (e.g. `additionalInterfaces`, `transport`) that
 * differ from the spec — the SDK maps these internally when processing requests.
 */
export function buildAgentCard(config: A2AConfig, baseUrl: string): AgentCard {
	const configSkills: AgentSkill[] | undefined = config.skills?.map((s) => ({
		...s,
		tags: s.tags ?? [],
	}));

	const card: AgentCard = {
		name: config.name ?? "Pi Agent",
		description: config.description ?? "Personal AI coding agent powered by Pi",
		url: baseUrl,
		version: config.version ?? "1.0.0",
		protocolVersion: PROTOCOL_VERSION,
		provider: {
			organization: config.organization ?? "Pi",
			url: config.providerUrl ?? baseUrl,
		},
		capabilities: {
			streaming: true,
			pushNotifications: true,
		},
		skills: configSkills ?? DEFAULT_SKILLS,
		defaultInputModes: ["text/plain", "application/json"],
		defaultOutputModes: ["text/plain", "application/json"],
		additionalInterfaces: [
			{ url: baseUrl, transport: "JSONRPC" },
		],
	};

	if (config.apiKey) {
		card.securitySchemes = {
			bearerAuth: {
				type: "http",
				scheme: "bearer",
				description: "API key passed as Bearer token in the Authorization header",
			},
		};
		card.security = [{ bearerAuth: [] }];
	}

	return card;
}

/**
 * Convert an SDK agent card to the spec-compliant JSON format.
 *
 * This is the canonical format served at `/.well-known/agent.json`.
 * It follows the A2A spec exactly:
 * - camelCase field names (§5.5)
 * - `supportedInterfaces` (§4.4.1) instead of SDK's `additionalInterfaces`
 * - `protocolBinding` (§4.4.6) instead of SDK's `transport`
 * - `protocolVersion` per interface (§4.4.6)
 * - No top-level `url` or `protocolVersion` (those are per-interface in the spec)
 */
export function toSpecCard(card: AgentCard): SpecAgentCard {
	const url = card.url ?? card.additionalInterfaces?.[0]?.url ?? "";

	const supportedInterfaces = (card.additionalInterfaces ?? []).map((iface) => ({
		url: iface.url,
		protocolBinding: iface.transport ?? "JSONRPC",
		protocolVersion: card.protocolVersion ?? PROTOCOL_VERSION,
	}));

	// Ensure at least one interface exists (spec requires min 1)
	if (supportedInterfaces.length === 0) {
		supportedInterfaces.push({
			url,
			protocolBinding: "JSONRPC",
			protocolVersion: card.protocolVersion ?? PROTOCOL_VERSION,
		});
	}

	const spec: SpecAgentCard = {
		name: card.name,
		description: card.description,
		version: card.version,
		supportedInterfaces,
		capabilities: {
			streaming: card.capabilities?.streaming,
			pushNotifications: card.capabilities?.pushNotifications,
		},
		defaultInputModes: card.defaultInputModes ?? ["text/plain"],
		defaultOutputModes: card.defaultOutputModes ?? ["text/plain"],
		skills: card.skills.map((s) => ({
			id: s.id,
			name: s.name,
			description: s.description,
			tags: s.tags ?? [],
			...(s.examples?.length ? { examples: s.examples } : {}),
		})),
	};

	if (card.provider) {
		spec.provider = {
			url: card.provider.url ?? url,
			organization: card.provider.organization,
		};
	}

	if (card.documentationUrl) {
		spec.documentationUrl = card.documentationUrl;
	}

	if (card.iconUrl) {
		spec.iconUrl = card.iconUrl;
	}

	if (card.securitySchemes) {
		spec.securitySchemes = convertSecuritySchemes(card.securitySchemes);
	}

	if (card.security) {
		spec.securityRequirements = card.security;
	}

	return spec;
}

/**
 * Convert SDK/OpenAPI 3.x security schemes to A2A spec §4.5.1 format.
 *
 * The SDK uses raw OpenAPI format: `{type: "http", scheme: "bearer", ...}`
 * The A2A spec uses a discriminated union with exactly one wrapper key:
 *   `{httpAuthSecurityScheme: {scheme: "bearer", ...}}`
 *
 * Supported wrapper keys (§4.5.1):
 *   apiKeySecurityScheme, httpAuthSecurityScheme, oauth2SecurityScheme,
 *   openIdConnectSecurityScheme, mtlsSecurityScheme
 */
function convertSecuritySchemes(
	schemes: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const [name, value] of Object.entries(schemes)) {
		const scheme = value as Record<string, unknown>;
		const type = scheme.type as string | undefined;

		if (type === "http") {
			result[name] = {
				httpAuthSecurityScheme: {
					scheme: scheme.scheme,
					...(scheme.description ? { description: scheme.description } : {}),
					...(scheme.bearerFormat ? { bearerFormat: scheme.bearerFormat } : {}),
				},
			};
		} else if (type === "apiKey") {
			result[name] = {
				apiKeySecurityScheme: {
					name: scheme.name,
					location: scheme.in ?? scheme.location,
					...(scheme.description ? { description: scheme.description } : {}),
				},
			};
		} else if (type === "oauth2") {
			result[name] = {
				oauth2SecurityScheme: {
					flows: scheme.flows ?? {},
					...(scheme.description ? { description: scheme.description } : {}),
				},
			};
		} else if (type === "openIdConnect") {
			result[name] = {
				openIdConnectSecurityScheme: {
					openIdConnectUrl: scheme.openIdConnectUrl,
					...(scheme.description ? { description: scheme.description } : {}),
				},
			};
		} else if (type === "mutualTLS") {
			result[name] = {
				mtlsSecurityScheme: {
					...(scheme.description ? { description: scheme.description } : {}),
				},
			};
		} else {
			// Unknown type — pass through as-is (may already be in spec format)
			result[name] = scheme;
		}
	}

	return result;
}

/**
 * Enrich an existing agent card with dynamically discovered tools.
 *
 * Extension tools (non-built-in) are converted to A2A skills and merged
 * with the card's existing skills. Config-defined skills take precedence.
 */
export function enrichAgentCard(card: AgentCard, tools: ToolInfo[]): AgentCard {
	const existingIds = new Set(card.skills.map((s) => s.id));

	const toolSkills: AgentSkill[] = tools
		.filter((t) => !BUILTIN_TOOL_NAMES.has(t.name) && !existingIds.has(t.name))
		.map((t) => ({
			id: t.name,
			name: formatToolName(t.name),
			description: t.description,
			tags: ["tool", "extension"],
		}));

	return {
		...card,
		skills: [...card.skills, ...toolSkills],
	};
}

/**
 * Convert tool_name to Title Case display name.
 */
function formatToolName(name: string): string {
	return name
		.split(/[_-]/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}
