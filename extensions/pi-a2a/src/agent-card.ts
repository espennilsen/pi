/**
 * pi-a2a — Agent Card builder.
 *
 * Constructs an A2A Agent Card in two formats:
 * 1. SDK format (camelCase) — used internally by @a2a-js/sdk for JSON-RPC handling
 * 2. Proto format (snake_case) — served at /.well-known/agent.json, compatible
 *    with the A2A proto spec and hub validation
 */

import type { AgentCard, AgentSkill } from "@a2a-js/sdk";
import type { A2AConfig } from "./types.ts";

/** Minimal tool info matching pi's ToolInfo type. */
export interface ToolInfo {
	name: string;
	description: string;
}

/** Proto-spec agent card (snake_case), served at /.well-known/agent.json. */
export interface ProtoAgentCard {
	name: string;
	description: string;
	version: string;
	supported_interfaces: Array<{
		url: string;
		protocol_binding: string;
		protocol_version: string;
	}>;
	provider?: {
		url: string;
		organization: string;
	};
	capabilities: {
		streaming?: boolean;
		push_notifications?: boolean;
	};
	default_input_modes: string[];
	default_output_modes: string[];
	skills: Array<{
		id: string;
		name: string;
		description: string;
		tags: string[];
		examples?: string[];
	}>;
	documentation_url?: string;
	icon_url?: string;
	security_schemes?: Record<string, unknown>;
	security_requirements?: Array<{ schemes?: Record<string, { list?: string[] }> }>;
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
 * Build an A2A Agent Card (SDK format, camelCase).
 *
 * Used internally by the SDK's DefaultRequestHandler for JSON-RPC protocol handling.
 */
export function buildAgentCard(config: A2AConfig, baseUrl: string): AgentCard {
	const configSkills: AgentSkill[] | undefined = config.skills?.map((s) => ({
		...s,
		tags: s.tags ?? [],
	}));

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
 * Convert SDK agent card (camelCase) to proto-spec format (snake_case).
 *
 * This is the format served at /.well-known/agent.json and validated by
 * the A2A Discovery Hub. Follows the A2A proto AgentCard message spec.
 */
export function toProtoCard(card: AgentCard): ProtoAgentCard {
	const url = card.url ?? card.additionalInterfaces?.[0]?.url ?? "";

	const proto: ProtoAgentCard = {
		name: card.name,
		description: card.description,
		version: card.version,
		supported_interfaces: (card.additionalInterfaces ?? []).map((iface) => ({
			url: iface.url,
			protocol_binding: iface.transport ?? "JSONRPC",
			protocol_version: card.protocolVersion ?? "0.3.0",
		})),
		provider: card.provider ? {
			url: card.provider.url ?? url,
			organization: card.provider.organization,
		} : undefined,
		capabilities: {
			streaming: card.capabilities?.streaming,
			push_notifications: card.capabilities?.pushNotifications,
		},
		default_input_modes: card.defaultInputModes ?? ["text/plain"],
		default_output_modes: card.defaultOutputModes ?? ["text/plain"],
		skills: card.skills.map((s) => ({
			id: s.id,
			name: s.name,
			description: s.description,
			tags: s.tags ?? [],
			...(s.examples?.length ? { examples: s.examples } : {}),
		})),
	};

	// Ensure at least one supported_interface exists
	if (proto.supported_interfaces.length === 0) {
		proto.supported_interfaces = [{
			url,
			protocol_binding: "JSONRPC",
			protocol_version: card.protocolVersion ?? "0.3.0",
		}];
	}

	return proto;
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
