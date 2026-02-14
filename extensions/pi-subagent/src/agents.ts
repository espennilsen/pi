/**
 * pi-subagent — Agent discovery.
 *
 * Loads agent definitions from markdown files with YAML frontmatter:
 *   ~/.pi/agent/agents/*.md   — User-level (always loaded)
 *   .pi/agents/*.md           — Project-level (only with scope "project" or "both")
 *
 * Agent file format:
 *   ---
 *   name: scout
 *   description: Fast codebase recon
 *   tools: read, grep, find, ls, bash
 *   model: claude-haiku-4-5
 *   ---
 *   System prompt content...
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import type { AgentConfig, AgentScope } from "./types.ts";

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

function loadAgentsFromDir(
	dir: string,
	source: "user" | "project",
): AgentConfig[] {
	if (!fs.existsSync(dir)) return [];

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const agents: AgentConfig[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<
			Record<string, string>
		>(content);
		if (!frontmatter.name || !frontmatter.description) continue;

		const tools = frontmatter.tools
			?.split(",")
			.map((t: string) => t.trim())
			.filter(Boolean);

		const extensions = frontmatter.extensions
			?.split(",")
			.map((e: string) => e.trim())
			.filter(Boolean);

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			extensions: extensions && extensions.length > 0 ? extensions : undefined,
			model: frontmatter.model,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function findProjectAgentsDir(cwd: string): string | null {
	let dir = cwd;
	while (true) {
		const candidate = path.join(dir, ".pi", "agents");
		try {
			if (fs.statSync(candidate).isDirectory()) return candidate;
		} catch {
			/* not found */
		}
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

export function discoverAgents(
	cwd: string,
	scope: AgentScope,
): AgentDiscoveryResult {
	const userDir = path.join(os.homedir(), ".pi", "agent", "agents");
	const projectAgentsDir = findProjectAgentsDir(cwd);

	const userAgents =
		scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents =
		scope === "user" || !projectAgentsDir
			? []
			: loadAgentsFromDir(projectAgentsDir, "project");

	// Project agents override user agents with same name
	const agentMap = new Map<string, AgentConfig>();
	if (scope === "both") {
		for (const a of userAgents) agentMap.set(a.name, a);
		for (const a of projectAgents) agentMap.set(a.name, a);
	} else if (scope === "user") {
		for (const a of userAgents) agentMap.set(a.name, a);
	} else {
		for (const a of projectAgents) agentMap.set(a.name, a);
	}

	return {
		agents: Array.from(agentMap.values()),
		projectAgentsDir,
	};
}
