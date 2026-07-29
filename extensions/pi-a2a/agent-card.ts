/**
 * pi-a2a — Agent Card builder.
 *
 * Produces agent cards in the @a2a-js/sdk format, which is the de facto standard
 * used by all A2A SDK consumers. The SDK's AgentCard type follows the draft/0.2.x
 * spec shape (top-level `url`, `protocolVersion`, `additionalInterfaces` with
 * `transport`, OpenAPI 3.0 security schemes).
 *
 * The official A2A spec v1.0 introduced breaking changes (renamed fields, per-interface
 * protocol versions, discriminated union security schemes) but no SDK has adopted them.
 * Since other agents use the same SDK, we serve the SDK-native format for interoperability.
 */

import type { AgentCard, AgentSkill } from "@a2a-js/sdk";
import type { A2AConfig } from "./types.ts";
import type { AuthMode } from "./auth-types.ts";
import { getInboundSupportedModes } from "./inbound-auth.ts";

/** Minimal tool info matching pi's ToolInfo type. */
export interface ToolInfo {
	name: string;
	description: string;
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

const PROTOCOL_VERSION = "0.3.0";

/**
 * Build an A2A Agent Card (SDK format).
 *
 * Used internally by the SDK's DefaultRequestHandler for JSON-RPC protocol handling.
 * The SDK has its own field names (e.g. `additionalInterfaces`, `transport`) that
 * differ from the spec — the SDK maps these internally when processing requests.
 */
export function buildAgentCard(config: A2AConfig, baseUrl: string, runtimeSupportedModes?: AuthMode[]): AgentCard {
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

	if (config.owner) {
		(card as any).owner = config.owner;
	}

	if (config.iconUrl) {
		card.iconUrl = config.iconUrl;
	}
	if (config.documentationUrl) {
		card.documentationUrl = config.documentationUrl;
	}

	// Advertise only mechanisms the started server can enforce, never credential material.
	const modes = runtimeSupportedModes ?? getInboundSupportedModes(config.local);
	const schemes: Record<string, unknown> = {};
	const requirements: Array<Record<string, string[]>> = [];
	if (modes.includes("legacy-api-key")) {
		schemes.bearerAuth = { type: "http", scheme: "bearer", description: "API key passed as Bearer token in the Authorization header" };
		requirements.push({ bearerAuth: [] });
	}
	if (modes.includes("oauth2") || modes.includes("oauth2+mtls")) {
		schemes.oauth2 = { type: "oauth2", flows: { clientCredentials: { tokenUrl: "", scopes: {} } }, description: "OAuth 2.0 bearer access token" };
	}
	if (modes.includes("oauth2")) requirements.push({ oauth2: [] });
	if (modes.includes("oauth2+mtls")) {
		schemes.mutualTLS = { type: "mutualTLS", description: "TLS client certificate bound to the OAuth access token" };
		requirements.push({ oauth2: [], mutualTLS: [] });
	}
	if (requirements.length) {
		// SDK's current AgentCard types only model a subset of OpenAPI schemes.
		(card as any).securitySchemes = schemes;
		(card as any).security = requirements;
	}

	return card;
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
