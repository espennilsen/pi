/**
 * pi-a2a — Agent Card builder.
 *
 * Constructs an A2A Agent Card (per @a2a-js/sdk types) from extension config.
 * Supports dynamic enrichment from registered tools.
 *
 * Targets A2A Protocol v0.3.0 (the version implemented by @a2a-js/sdk v0.3.x).
 */

import type { AgentCard, AgentSkill } from "@a2a-js/sdk";
import type { A2AConfig } from "./types.ts";

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

/**
 * Build an A2A Agent Card with static config.
 *
 * The card declares the agent's identity, capabilities, skills, and
 * transport interfaces per the A2A v0.3.0 protocol spec.
 */
export function buildAgentCard(config: A2AConfig, baseUrl: string): AgentCard {
	const configSkills: AgentSkill[] | undefined = config.skills?.map((s) => ({
		...s,
		tags: s.tags ?? [],
	}));

	// Build the JSON-RPC endpoint URL (POST to root)
	const jsonRpcUrl = baseUrl;

	const card: AgentCard = {
		name: config.name ?? "Pi Agent",
		description: config.description ?? "Personal AI coding agent powered by Pi",
		url: jsonRpcUrl,
		version: config.version ?? "1.0.0",
		protocolVersion: "0.3.0",
		provider: {
			organization: config.organization ?? "Pi",
			url: config.providerUrl ?? baseUrl,
		},
		capabilities: {
			streaming: true,
			pushNotifications: true,
			stateTransitionHistory: true,
		},
		skills: configSkills ?? DEFAULT_SKILLS,
		defaultInputModes: ["text/plain", "application/json"],
		defaultOutputModes: ["text/plain", "application/json"],
		additionalInterfaces: [
			{ url: jsonRpcUrl, transport: "JSONRPC" },
		],
	};

	// Declare security scheme when API key is configured
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
