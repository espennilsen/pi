/**
 * pi-a2a — Agent Card builder.
 *
 * Constructs the A2A Agent Card from extension config.
 * Supports dynamic enrichment from registered tools.
 */

import type { A2AConfig, AgentCard, AgentSkill } from "./types.ts";

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
 *
 * @param config Extension config from settings.json
 * @param baseUrl The public-facing URL of the A2A server
 */
export function buildAgentCard(config: A2AConfig, baseUrl: string): AgentCard {
	return {
		name: config.name ?? "Pi Agent",
		description: config.description ?? "Personal AI coding agent powered by Pi",
		url: baseUrl,
		version: config.version ?? "1.0.0",
		provider: {
			organization: config.organization ?? "Pi",
			contactEmail: config.contactEmail,
			website: config.website,
		},
		capabilities: {
			streaming: true,
			pushNotifications: false,
			multiTurn: true,
		},
		skills: config.skills ?? DEFAULT_SKILLS,
		defaultInputModes: ["text/plain"],
		defaultOutputModes: ["text/plain"],
	};
}

/**
 * Enrich an existing agent card with dynamically discovered tools.
 *
 * Extension tools (non-built-in) are converted to A2A skills and merged
 * with the card's existing skills. Config-defined skills take precedence
 * (not overwritten). Built-in tools (bash, read, edit, etc.) are skipped
 * since they're covered by the default skills.
 *
 * @param card Existing agent card to enrich
 * @param tools All registered tools from pi.getAllTools()
 * @returns New agent card with merged skills
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
 * e.g. "web_fetch" → "Web Fetch", "npm" → "Npm"
 */
function formatToolName(name: string): string {
	return name
		.split(/[_-]/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}
