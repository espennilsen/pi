/**
 * pi-memory — Tool registrations.
 *
 * Three tools:
 *   memory_read   — Read MEMORY.md, daily logs, or list files
 *   memory_write  — Append to daily log or update long-term memory
 *   memory_search — Full-text search across all memory files
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import * as files from "./files.ts";

function text(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: {} };
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function registerMemoryTools(pi: ExtensionAPI): void {
	// ── memory_read ─────────────────────────────────────────

	pi.registerTool({
		name: "memory_read",
		label: "Memory Read",
		description:
			"Read persistent memory. Targets: " +
			"'long_term' reads MEMORY.md, " +
			"'daily' reads a specific date's log (default: today), " +
			"'list' shows all available daily log files.",
		parameters: Type.Object({
			target: StringEnum(["long_term", "daily", "list"] as const, {
				description: "What to read",
			}),
			date: Type.Optional(
				Type.String({ description: "Date in YYYY-MM-DD format (for daily target, defaults to today)" }),
			),
		}),

		async execute(_toolCallId, params) {
			if (params.target === "list") {
				const dailyFiles = files.listDailyFiles();
				if (dailyFiles.length === 0) return text("No daily memory files yet.");
				const list = dailyFiles.map(f => `- ${f.replace(".md", "")}`).join("\n");
				return text(`Daily memory files (${dailyFiles.length}):\n${list}`);
			}

			if (params.target === "long_term") {
				return text(files.readFileOr(files.longTermPath(), "(No long-term memory file found)"));
			}

			const date = params.date ?? files.todayStr();
			return text(files.readFileOr(files.dailyPath(date), `(No daily memory for ${date})`));
		},
	});

	// ── memory_write ────────────────────────────────────────

	pi.registerTool({
		name: "memory_write",
		label: "Memory Write",
		description:
			"Write to persistent memory. " +
			"'daily' appends a timestamped entry to today's log. " +
			"'long_term' updates MEMORY.md — provide a section name to replace that section, " +
			"or omit to append to the end.",
		parameters: Type.Object({
			target: StringEnum(["daily", "long_term"] as const, {
				description: "Where to write: daily (append) or long_term (edit MEMORY.md)",
			}),
			content: Type.String({ description: "The content to write" }),
			section: Type.Optional(
				Type.String({
					description:
						"For long_term: section header to find and replace (e.g. 'Preferences'). " +
						"If omitted, content is appended to end of MEMORY.md.",
				}),
			),
		}),

		async execute(_toolCallId, params) {
			if (params.target === "daily") {
				const now = new Date();
				const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
				const entry = `### ${time}\n\n${params.content}`;
				const fp = files.dailyPath();

				if (!files.readFileOr(fp)) {
					files.writeFile(fp, `# Daily Memory — ${files.todayStr()}\n\n${entry}\n`);
				} else {
					files.appendToFile(fp, "\n" + entry);
				}

				return text(`✓ Appended to daily memory (${files.todayStr()} ${time})`);
			}

			// Long-term
			const fp = files.longTermPath();
			const existing = files.readFileOr(fp);

			if (params.section) {
				const pattern = new RegExp(
					`(## ${escapeRegex(params.section)}\\n)([\\s\\S]*?)(?=\\n## |$)`,
					"m",
				);
				const match = existing.match(pattern);

				if (match) {
					const updated = existing.replace(pattern, (_, header) => `${header}\n${params.content}\n`);
					files.writeFile(fp, updated);
					return text(`✓ Updated section "${params.section}" in MEMORY.md`);
				} else {
					files.appendToFile(fp, `\n## ${params.section}\n\n${params.content}`);
					return text(`✓ Added new section "${params.section}" to MEMORY.md`);
				}
			}

			files.appendToFile(fp, "\n" + params.content);
			return text("✓ Appended to MEMORY.md");
		},
	});

	// ── memory_search ───────────────────────────────────────

	pi.registerTool({
		name: "memory_search",
		label: "Memory Search",
		description:
			"Search across all memory files (MEMORY.md + daily logs) for a keyword or phrase. " +
			"Returns matching lines with surrounding context.",
		parameters: Type.Object({
			query: Type.String({ description: "Search term (case-insensitive)" }),
			limit: Type.Optional(
				Type.Number({ description: "Max results (default: 20)" }),
			),
		}),

		async execute(_toolCallId, params) {
			const query = params.query.toLowerCase();
			const limit = params.limit ?? 20;
			const results: Array<{ file: string; lineNum: number; context: string }> = [];

			for (const file of files.allMemoryFiles()) {
				const content = files.readFileOr(file.path);
				const lines = content.split("\n");

				for (let i = 0; i < lines.length; i++) {
					if (!lines[i].toLowerCase().includes(query)) continue;
					const ctx = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 2));
					results.push({ file: file.label, lineNum: i + 1, context: ctx.join("\n") });
					if (results.length >= limit) break;
				}
				if (results.length >= limit) break;
			}

			if (results.length === 0) return text(`No results found for "${params.query}"`);

			const output = results
				.map(r => `**${r.file}:${r.lineNum}**\n${r.context}`)
				.join("\n\n---\n\n");

			return text(`Found ${results.length} result(s) for "${params.query}":\n\n${output}`);
		},
	});
}
