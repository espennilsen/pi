/**
 * pi-projects — LLM tool for managing projects.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { scanProjects, type ProjectInfo } from "./scanner.ts";
import { getProjectsStore } from "./store.ts";

interface ProjectsToolParams {
	action: "list" | "scan" | "hide" | "unhide" | "sources";
	path?: string;
	label?: string;
}

export function registerProjectsTool(pi: ExtensionAPI, getDevDir: () => string): void {
	pi.registerTool({
		name: "projects",
		label: "Projects",
		description:
			"Manage projects: list (all projects with git status), scan (rescan directories), " +
			"hide/unhide (toggle visibility), sources (manage scan directories).",
		parameters: Type.Object({
			action: StringEnum(
				["list", "scan", "hide", "unhide", "sources"] as const,
				{ description: "Action to perform" },
			) as any,
			path: Type.Optional(
				Type.String({ description: "Project or directory path (for hide/unhide/sources)" }),
			),
			label: Type.Optional(
				Type.String({ description: "Label for a new source directory" }),
			),
		}) as any,

		async execute(_toolCallId, _params) {
			const params = _params as ProjectsToolParams;
			let result: string;

			switch (params.action) {
				case "list":
				case "scan": {
					const projects = await scanProjects(getDevDir());
					const gitProjects = projects.filter(p => p.is_git);
					const dirty = gitProjects.filter(p => (p.dirty_count ?? 0) > 0);

					const lines = projects.map((p) => {
						if (!p.is_git) return `- 📁 ${p.name} (no git)`;
						const status = (p.dirty_count ?? 0) > 0
							? `⚠️ ${p.dirty_count} changes`
							: "✅ clean";
						const branch = p.branch ? ` [${p.branch}]` : "";
						const sync = [];
						if ((p.ahead ?? 0) > 0) sync.push(`↑${p.ahead}`);
						if ((p.behind ?? 0) > 0) sync.push(`↓${p.behind}`);
						const syncStr = sync.length > 0 ? ` (${sync.join(" ")})` : "";
						return `- ${p.name}${branch} — ${status}${syncStr}`;
					});

					result = [
						`**Projects (${projects.length} total, ${gitProjects.length} git, ${dirty.length} dirty):**`,
						"",
						...lines,
					].join("\n");
					break;
				}

				case "hide": {
					if (!params.path) { result = "Missing required field: path"; break; }
					const store = getProjectsStore();
					await store.hideProject(params.path);
					result = `✓ Hidden project: ${params.path}`;
					break;
				}

				case "unhide": {
					if (!params.path) { result = "Missing required field: path"; break; }
					const storeU = getProjectsStore();
					const ok = await storeU.unhideProject(params.path);
					result = ok ? `✓ Restored project: ${params.path}` : `Project was not hidden: ${params.path}`;
					break;
				}

				case "sources": {
					const storeS = getProjectsStore();
					if (params.path) {
						// Add a new source
						await storeS.addProjectSource(params.path, params.label);
						result = `✓ Added source directory: ${params.path}`;
					} else {
						// List sources
						const sources = await storeS.getProjectSources();
						if (sources.length === 0) {
							result = `Only scanning default directory: ${getDevDir()}\nUse \`projects sources --path /some/dir\` to add more.`;
						} else {
							const lines = sources.map(s => `- ${s.path}${s.label ? ` (${s.label})` : ""}`);
							result = `**Scan directories:**\n- ${getDevDir()} (default)\n${lines.join("\n")}`;
						}
					}
					break;
				}

				default:
					result = `Unknown action: ${(params as any).action}`;
			}

			return {
				content: [{ type: "text" as const, text: result }],
				details: {},
			};
		},
	});
}
