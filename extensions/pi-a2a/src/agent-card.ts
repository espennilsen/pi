/**
 * pi-a2a — Agent Card builder.
 *
 * Constructs the A2A Agent Card from extension config.
 */

import type { A2AConfig, AgentCard } from "./types.ts";

/**
 * Build an A2A Agent Card.
 *
 * @param config Extension config from settings.json
 * @param baseUrl The public-facing URL of the A2A server
 */
export function buildAgentCard(config: A2AConfig, baseUrl: string): AgentCard {
	const defaultSkills = [
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
		skills: config.skills ?? defaultSkills,
		defaultInputModes: ["text/plain"],
		defaultOutputModes: ["text/plain"],
	};
}
