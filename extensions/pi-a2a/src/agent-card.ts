/**
 * pi-a2a — Agent Card builder.
 *
 * Constructs an A2A Agent Card (per @a2a-js/sdk types) from extension config.
 * Supports dynamic enrichment from registered tools.
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
	},
	{
		id: "file_operations",
		name: "File Operations",
		description: "Read, create, and modify files in the project",
		tags: ["files", "editing"],
	},
	{
		id: "shell_commands",
		name: "Shell Commands",
		description: "Execute bash commands for builds, tests, and system operations",
		tags: ["bash", "shell", "cli"],
	},
];

/**
 * Build an A2A Agent Card with static config.
 */
export function buildAgentCard(config: A2AConfig, baseUrl: string): AgentCard {
	const configSkills: AgentSkill[] | undefined = config.skills?.map((s) => ({
		...s,
		tags: s.tags ?? [],
	}));

	return {
		name: config.name ?? "Pi Agent",
		description: config.description ?? "Personal AI coding agent powered by Pi",
		url: baseUrl,
		version: config.version ?? "1.0.0",
		protocolVersion: "0.2.2",
		provider: {
			organization: config.organization ?? "Pi",
			url: config.providerUrl ?? baseUrl,
		},
		capabilities: {
			streaming: false,
			pushNotifications: false,
			stateTransitionHistory: false,
		},
		skills: configSkills ?? DEFAULT_SKILLS,
		defaultInputModes: ["text/plain"],
		defaultOutputModes: ["text/plain"],
	};
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
