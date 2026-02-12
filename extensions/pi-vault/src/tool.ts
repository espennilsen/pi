/**
 * Obsidian vault tool for pi.
 *
 * Structured read/write/search/list/create operations on an Obsidian vault.
 * Uses the Local REST API plugin when available, filesystem fallback otherwise.
 *
 * Operations:
 *   - read               — Read a note by path (API → fs fallback)
 *   - write              — Create or update a note (API → fs fallback)
 *   - append             — Append content to a note (API → fs fallback)
 *   - patch              — Insert relative to heading/block/frontmatter (API → fs fallback for headings)
 *   - delete             — Delete a note (API → fs fallback)
 *   - search             — Full-text search (API → fs fallback via grep)
 *   - dataview           — Run a Dataview DQL query (API-only)
 *   - search_jsonlogic   — JsonLogic structured query (API-only)
 *   - list               — List files in a directory (API → fs fallback)
 *   - create_from_template — Create note from template (API → fs fallback)
 *   - frontmatter        — Read/update YAML frontmatter (API → fs fallback)
 *   - recent             — List recently modified notes (filesystem)
 *   - daily              — Read or create daily note (API → fs fallback)
 *   - open               — Open a file in the Obsidian UI (API-only)
 *   - commands           — List or execute Obsidian commands (API-only)
 *   - document_map       — Get headings/blocks/frontmatter fields for PATCH targeting (API → fs fallback)
 *
 * Config via settings.json under "pi-vault" (vaultPath, apiUrl, apiKey)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";
import type { VaultConfig } from "./api-client.ts";
import { apiRequest, isApiAvailable, encodePath } from "./api-client.ts";

// ── Constants ───────────────────────────────────────────────────

const DAILY_NOTES_DIR = "Notes/Daily";
const TEMPLATES_DIR = "Templates";
const VALID_TASK_STATUSES = ["open", "in-progress", "blocked", "done", "someday"] as const;

// ── Filesystem helpers ──────────────────────────────────────────

function vaultPath(root: string, ...segments: string[]): string {
	const resolved = path.resolve(root, ...segments);
	if (!resolved.startsWith(root)) {
		throw new Error(`Path escapes vault root: ${segments.join("/")}`);
	}
	return resolved;
}

function text(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: {} };
}

function ensureDir(dir: string): void {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function localDateStr(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayStr(): string {
	return localDateStr(new Date());
}

function formatDailyDate(date: Date): string {
	const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	const months = [
		"January", "February", "March", "April", "May", "June",
		"July", "August", "September", "October", "November", "December",
	];
	return `${days[date.getDay()]}, ${months[date.getMonth()]} ${String(date.getDate()).padStart(2, "0")}, ${date.getFullYear()}`;
}

function adjacentDates(dateStr: string): { yesterday: string; tomorrow: string } {
	const d = new Date(dateStr + "T12:00:00");
	const yesterday = new Date(d);
	yesterday.setDate(d.getDate() - 1);
	const tomorrow = new Date(d);
	tomorrow.setDate(d.getDate() + 1);
	return { yesterday: localDateStr(yesterday), tomorrow: localDateStr(tomorrow) };
}

// ── Tool registration ───────────────────────────────────────────

const ALL_ACTIONS = [
	"read", "write", "append", "patch", "delete",
	"search", "dataview", "search_jsonlogic",
	"list", "create_from_template", "frontmatter",
	"recent", "daily",
	"open", "commands", "document_map",
] as const;

export function registerObsidianTool(pi: ExtensionAPI, config: VaultConfig): void {
	const VAULT_ROOT = config.vaultPath;

	if (!VAULT_ROOT || !fs.existsSync(VAULT_ROOT)) {
		// Tool registered but will error on use — allows pi to load without vault present
	}

	pi.registerTool({
		name: "obsidian",
		label: "Obsidian Vault",
		description:
			"Read, write, search, and manage notes in an Obsidian vault. " +
			"Uses the Local REST API when Obsidian is running, filesystem fallback otherwise. " +
			"Actions: read, write, append, patch (insert at heading/block/frontmatter), delete, " +
			"search (full-text with grep fallback), dataview (DQL query), search_jsonlogic (structured query), " +
			"list (directory listing), create_from_template, frontmatter (read/update YAML), " +
			"recent (recently modified), daily (daily note), " +
			"open (open file in Obsidian UI), commands (list/execute Obsidian commands), " +
			"document_map (list headings/blocks/frontmatter for PATCH targeting).",
		parameters: Type.Object({
			action: StringEnum(ALL_ACTIONS, { description: "Operation to perform" }),
			path: Type.Optional(Type.String({
				description: "Path relative to vault root (e.g. '1. Projects/AI Projects/Pi (Hannah).md')",
			})),
			content: Type.Optional(Type.String({
				description: "Content for write/append/patch/daily, DQL query for dataview, JsonLogic JSON for search_jsonlogic",
			})),
			updates: Type.Optional(Type.String({
				description: "JSON object of frontmatter fields to update (for frontmatter action)",
			})),
			query: Type.Optional(Type.String({
				description: "Search term (for search action)",
			})),
			template: Type.Optional(Type.String({
				description: "Template filename in Templates/ (for create_from_template)",
			})),
			variables: Type.Optional(Type.String({
				description: "JSON object of template variables to replace (for create_from_template)",
			})),
			target: Type.Optional(Type.String({
				description: "Target path for create_from_template, patch target (heading::subheading, block ref, or frontmatter field), or command ID for commands",
			})),
			target_type: Type.Optional(Type.String({
				description: "For patch: 'heading', 'block', or 'frontmatter'",
			})),
			operation: Type.Optional(Type.String({
				description: "For patch: 'append', 'prepend', or 'replace'",
			})),
			limit: Type.Optional(Type.Number({
				description: "Max results (default: 20)",
			})),
			date: Type.Optional(Type.String({
				description: "Date in YYYY-MM-DD format (for daily action)",
			})),
			recursive: Type.Optional(Type.Boolean({
				description: "List files recursively (for list)",
			})),
			context_length: Type.Optional(Type.Number({
				description: "Characters of context around search matches (default: 100)",
			})),
			new_leaf: Type.Optional(Type.Boolean({
				description: "For open: open in a new leaf/tab (default: false)",
			})),
		}),

		async execute(_toolCallId, params, _signal) {
			if (!VAULT_ROOT || !fs.existsSync(VAULT_ROOT)) {
				return text(`Error: Vault not found at ${VAULT_ROOT || "(not configured)"}. Set pi-vault.vaultPath in settings.json.`);
			}

			const api = await isApiAvailable(config);

			switch (params.action) {

				// ── read ──────────────────────────────────────
				case "read": {
					if (!params.path) return text("Missing required field: path");

					if (api) {
						const res = await apiRequest(config, "GET", `/vault/${encodePath(params.path)}`, {
							accept: "application/vnd.olrapi.note+json",
						});
						if (res.ok && res.data) {
							const note = res.data;
							const fmKeys = Object.keys(note.frontmatter || {});
							const tags = (note.tags || []).join(", ");
							let header = "";
							if (fmKeys.length > 0 || tags) {
								const fmSummary = fmKeys.map((k: string) => `${k}: ${JSON.stringify(note.frontmatter[k])}`).join("\n");
								header = `**Frontmatter:**\n${fmSummary}\n**Tags:** ${tags}\n**Size:** ${note.stat?.size ?? "?"} bytes\n\n---\n\n`;
							}
							return text(header + (note.content ?? ""));
						}
						if (res.status === 404) return text(`File not found: ${params.path}`);
					}

					const fp = vaultPath(VAULT_ROOT, params.path);
					if (!fs.existsSync(fp)) return text(`File not found: ${params.path}`);
					return text(fs.readFileSync(fp, "utf-8"));
				}

				// ── write ─────────────────────────────────────
				case "write": {
					if (!params.path) return text("Missing required field: path");
					if (!params.content) return text("Missing required field: content");

					if (api) {
						const res = await apiRequest(config, "PUT", `/vault/${encodePath(params.path)}`, {
							body: params.content,
							contentType: "text/markdown",
						});
						if (res.ok || res.status === 204) return text(`✓ Written via API: ${params.path}`);
						if (res.error) return text(`API error: ${res.error}`);
					}

					const fp = vaultPath(VAULT_ROOT, params.path);
					ensureDir(path.dirname(fp));
					const existed = fs.existsSync(fp);
					fs.writeFileSync(fp, params.content, "utf-8");
					return text(`✓ ${existed ? "Updated" : "Created"} (filesystem): ${params.path}`);
				}

				// ── append ────────────────────────────────────
				case "append": {
					if (!params.path) return text("Missing required field: path");
					if (!params.content) return text("Missing required field: content");

					if (api) {
						const res = await apiRequest(config, "POST", `/vault/${encodePath(params.path)}`, {
							body: params.content,
							contentType: "text/markdown",
						});
						if (res.ok || res.status === 204) return text(`✓ Appended via API: ${params.path}`);
						if (res.error) return text(`API error: ${res.error}`);
					}

					const fp = vaultPath(VAULT_ROOT, params.path);
					if (!fs.existsSync(fp)) return text(`File not found: ${params.path}`);
					const existing = fs.readFileSync(fp, "utf-8");
					fs.writeFileSync(fp, existing + "\n" + params.content + "\n", "utf-8");
					return text(`✓ Appended (filesystem): ${params.path}`);
				}

				// ── patch ─────────────────────────────────────
				case "patch": {
					if (!params.path) return text("Missing required field: path");
					if (!params.content) return text("Missing required field: content");
					if (!params.target) return text("Missing required field: target (heading name with :: delimiter, block ref, or frontmatter field)");
					if (!params.target_type) return text("Missing required field: target_type (heading, block, or frontmatter)");
					if (!params.operation) return text("Missing required field: operation (append, prepend, or replace)");

					if (api) {
						const contentType = params.target_type === "frontmatter" ? "application/json" : "text/markdown";
						const res = await apiRequest(config, "PATCH", `/vault/${encodePath(params.path)}`, {
							body: params.content,
							contentType,
							headers: {
								"Operation": params.operation,
								"Target-Type": params.target_type,
								"Target": encodeURIComponent(params.target),
								"Create-Target-If-Missing": "true",
							},
						});
						if (res.ok || res.status === 200) return text(`✓ Patched ${params.target_type} "${params.target}" in ${params.path}`);
						return text(`Patch error: ${res.error ?? `status ${res.status}`}`);
					}

					if (params.target_type === "block") {
						return text("Error: block-based patch requires Obsidian REST API (not running). Use heading-based patch or append instead.");
					}

					const fp = vaultPath(VAULT_ROOT, params.path);
					if (!fs.existsSync(fp)) return text(`File not found: ${params.path}`);
					const fileContent = fs.readFileSync(fp, "utf-8");

					if (params.target_type === "frontmatter") {
						const fmMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
						if (!fmMatch) return text(`No frontmatter found in: ${params.path}`);
						const rawFm = fmMatch[1];
						const body = fmMatch[2];
						const fmLines = rawFm.split("\n");
						const targetLine = fmLines.findIndex(l => l.startsWith(`${params.target}:`));

						if (params.operation === "replace") {
							if (targetLine >= 0) {
								fmLines[targetLine] = `${params.target}: ${params.content}`;
							} else {
								fmLines.push(`${params.target}: ${params.content}`);
							}
						} else if (params.operation === "append") {
							if (targetLine >= 0) {
								const current = fmLines[targetLine].split(":").slice(1).join(":").trim();
								fmLines[targetLine] = `${params.target}: ${current}${params.content}`;
							} else {
								fmLines.push(`${params.target}: ${params.content}`);
							}
						} else if (params.operation === "prepend") {
							if (targetLine >= 0) {
								const current = fmLines[targetLine].split(":").slice(1).join(":").trim();
								fmLines[targetLine] = `${params.target}: ${params.content}${current}`;
							} else {
								fmLines.push(`${params.target}: ${params.content}`);
							}
						}

						fs.writeFileSync(fp, `---\n${fmLines.join("\n")}\n---\n${body}`, "utf-8");
						return text(`✓ Patched frontmatter "${params.target}" (filesystem) in ${params.path}`);
					}

					// Heading-based patch
					const headingParts = params.target.split("::");
					const lines = fileContent.split("\n");
					let targetIdx = -1;
					let targetLevel = 0;
					let endIdx = lines.length;

					let searchFrom = 0;
					for (const part of headingParts) {
						let found = false;
						for (let i = searchFrom; i < lines.length; i++) {
							const hMatch = lines[i].match(/^(#{1,6})\s+(.*)$/);
							if (hMatch) {
								const headingText = hMatch[2].trim();
								if (headingText === part.trim()) {
									targetIdx = i;
									targetLevel = hMatch[1].length;
									searchFrom = i + 1;
									found = true;
									break;
								}
							}
						}
						if (!found) return text(`Heading not found: "${part}" in ${params.path}`);
					}

					for (let i = targetIdx + 1; i < lines.length; i++) {
						const hMatch = lines[i].match(/^(#{1,6})\s/);
						if (hMatch && hMatch[1].length <= targetLevel) {
							endIdx = i;
							break;
						}
					}

					if (params.operation === "replace") {
						const before = lines.slice(0, targetIdx + 1);
						const after = lines.slice(endIdx);
						fs.writeFileSync(fp, [...before, params.content, ...after].join("\n"), "utf-8");
					} else if (params.operation === "append") {
						lines.splice(endIdx, 0, params.content);
						fs.writeFileSync(fp, lines.join("\n"), "utf-8");
					} else if (params.operation === "prepend") {
						lines.splice(targetIdx + 1, 0, params.content);
						fs.writeFileSync(fp, lines.join("\n"), "utf-8");
					}

					return text(`✓ Patched heading "${params.target}" (filesystem) in ${params.path}`);
				}

				// ── delete ────────────────────────────────────
				case "delete": {
					if (!params.path) return text("Missing required field: path");

					if (api) {
						const res = await apiRequest(config, "DELETE", `/vault/${encodePath(params.path)}`);
						if (res.ok || res.status === 204) return text(`✓ Deleted via API: ${params.path}`);
						if (res.status === 404) return text(`File not found: ${params.path}`);
						if (res.error) return text(`API error: ${res.error}`);
					}

					const fp = vaultPath(VAULT_ROOT, params.path);
					if (!fs.existsSync(fp)) return text(`File not found: ${params.path}`);
					fs.unlinkSync(fp);
					return text(`✓ Deleted (filesystem): ${params.path}`);
				}

				// ── search ────────────────────────────────────
				case "search": {
					if (!params.query) return text("Missing required field: query");
					const limit = params.limit ?? 20;

					if (api) {
						const contextLength = params.context_length ?? 100;
						const res = await apiRequest(config, "POST", `/search/simple/?query=${encodeURIComponent(params.query)}&contextLength=${contextLength}`);

						if (res.ok) {
							const results = res.data ?? [];
							const limited = results.slice(0, limit);

							if (limited.length === 0) return text(`No results for "${params.query}"`);

							const output = limited.map((r: any) => {
								const matches = (r.matches ?? []).slice(0, 3).map((m: any) => `  ...${m.context}...`).join("\n");
								return `**${r.filename}** (score: ${r.score?.toFixed(1) ?? "?"})\n${matches}`;
							}).join("\n\n");

							const truncMsg = results.length > limit ? `\n\n(showing ${limit} of ${results.length} results)` : "";
							return text(`Found ${results.length} result(s) for "${params.query}":\n\n${output}${truncMsg}`);
						}
					}

					// Filesystem fallback — grep-based search
					const query = params.query.toLowerCase();
					const contextLines = Math.max(1, Math.round((params.context_length ?? 100) / 80));
					const results: Array<{ file: string; matches: string[] }> = [];

					function searchDir(dir: string): void {
						if (results.length >= limit) return;
						let entries: fs.Dirent[];
						try {
							entries = fs.readdirSync(dir, { withFileTypes: true });
						} catch { return; }
						for (const entry of entries) {
							if (results.length >= limit) break;
							if (entry.name.startsWith(".") || entry.name === "_Attachments" || entry.name === "node_modules") continue;
							const full = path.join(dir, entry.name);
							if (entry.isDirectory()) {
								searchDir(full);
							} else if (entry.name.endsWith(".md")) {
								let content: string;
								try { content = fs.readFileSync(full, "utf-8"); } catch { continue; }
								const lines = content.split("\n");
								const matchingContexts: string[] = [];
								for (let i = 0; i < lines.length && matchingContexts.length < 3; i++) {
									if (lines[i].toLowerCase().includes(query)) {
										const start = Math.max(0, i - contextLines);
										const end = Math.min(lines.length, i + contextLines + 1);
										matchingContexts.push(lines.slice(start, end).join("\n"));
									}
								}
								if (matchingContexts.length > 0) {
									results.push({
										file: path.relative(VAULT_ROOT, full),
										matches: matchingContexts,
									});
								}
							}
						}
					}

					searchDir(VAULT_ROOT);

					if (results.length === 0) return text(`No results for "${params.query}"`);

					const output = results.map(r => {
						const contexts = r.matches.map(m => `  ...${m}...`).join("\n");
						return `**${r.file}**\n${contexts}`;
					}).join("\n\n");

					return text(`Found ${results.length} result(s) for "${params.query}" (filesystem):\n\n${output}`);
				}

				// ── dataview (API-only) ───────────────────────
				case "dataview": {
					if (!params.content) return text("Missing required field: content (DQL query)");
					if (!api) return text("Error: dataview requires Obsidian REST API (Obsidian not running or no API key)");

					const res = await apiRequest(config, "POST", "/search/", {
						body: params.content,
						contentType: "application/vnd.olrapi.dataview.dql+txt",
					});

					if (!res.ok) return text(`Dataview error: ${res.error ?? `status ${res.status}`}`);

					const results = res.data ?? [];
					if (results.length === 0) return text("Dataview query returned no results.");

					const output = JSON.stringify(results, null, 2);
					return text(`Dataview results (${results.length} rows):\n\n\`\`\`json\n${output}\n\`\`\``);
				}

				// ── search_jsonlogic (API-only) ───────────────
				case "search_jsonlogic": {
					if (!params.content) return text("Missing required field: content (JsonLogic query as JSON string)");
					if (!api) return text("Error: JsonLogic search requires Obsidian REST API (Obsidian not running or no API key)");

					try { JSON.parse(params.content); } catch (e: any) {
						return text(`Invalid JSON: ${e.message}`);
					}

					const res = await apiRequest(config, "POST", "/search/", {
						body: params.content,
						contentType: "application/vnd.olrapi.jsonlogic+json",
					});

					if (!res.ok) return text(`JsonLogic error: ${res.error ?? `status ${res.status}`}`);

					const results = res.data ?? [];
					if (results.length === 0) return text("JsonLogic query returned no results.");

					const limit = params.limit ?? 20;
					const limited = results.slice(0, limit);
					const output = JSON.stringify(limited, null, 2);
					const truncMsg = results.length > limit ? `\n\n(showing ${limit} of ${results.length} results)` : "";
					return text(`JsonLogic results (${results.length} matches):\n\n\`\`\`json\n${output}\n\`\`\`${truncMsg}`);
				}

				// ── list ──────────────────────────────────────
				case "list": {
					const dir = params.path ?? "";

					if (api) {
						const ep = dir ? `/vault/${encodePath(dir)}/` : "/vault/";
						const res = await apiRequest(config, "GET", ep);
						if (res.ok && res.data?.files) {
							const files: string[] = res.data.files;
							const limit = params.limit ?? 100;
							const limited = files.slice(0, limit);
							const truncMsg = files.length > limit ? `\n\n(showing ${limit} of ${files.length})` : "";
							return text(`${dir || "Vault root"} (${files.length} items):\n\n${limited.join("\n")}${truncMsg}`);
						}
						if (res.status === 404) return text(`Directory not found: ${dir || "(vault root)"}`);
					}

					const fp = vaultPath(VAULT_ROOT, dir);
					if (!fs.existsSync(fp) || !fs.statSync(fp).isDirectory()) {
						return text(`Not a directory: ${dir || "(vault root)"}`);
					}

					const limit = params.limit ?? 100;
					const items: string[] = [];

					function listDir(dirPath: string, prefix: string): void {
						if (items.length >= limit) return;
						const entries = fs.readdirSync(dirPath, { withFileTypes: true })
							.filter(e => !e.name.startsWith(".") && e.name !== "_Attachments" && e.name !== "node_modules")
							.sort((a, b) => {
								if (a.isDirectory() && !b.isDirectory()) return -1;
								if (!a.isDirectory() && b.isDirectory()) return 1;
								return a.name.localeCompare(b.name);
							});
						for (const entry of entries) {
							if (items.length >= limit) break;
							const isDir = entry.isDirectory();
							items.push(`${prefix}${isDir ? "📁 " : "📄 "}${entry.name}`);
							if (isDir && params.recursive) {
								listDir(path.join(dirPath, entry.name), prefix + "  ");
							}
						}
					}

					listDir(fp, "");
					if (items.length === 0) return text(`Empty directory: ${dir || "(vault root)"}`);
					const truncated = items.length >= limit ? `\n\n(truncated at ${limit} items)` : "";
					return text(`${dir || "Vault root"} (${items.length} items):\n\n${items.join("\n")}${truncated}`);
				}

				// ── create_from_template ──────────────────────
				case "create_from_template": {
					if (!params.template) return text("Missing required field: template");
					if (!params.target) return text("Missing required field: target");

					const templateFile = params.template.endsWith(".md") ? params.template : params.template + ".md";
					const templatePath = vaultPath(VAULT_ROOT, TEMPLATES_DIR, templateFile);
					if (!fs.existsSync(templatePath)) {
						const templatesDir = vaultPath(VAULT_ROOT, TEMPLATES_DIR);
						const available = fs.existsSync(templatesDir)
							? fs.readdirSync(templatesDir).filter(f => f.endsWith(".md")).join(", ")
							: "(templates dir not found)";
						return text(`Template not found: ${params.template}\nAvailable: ${available}`);
					}

					let content = fs.readFileSync(templatePath, "utf-8");

					if (params.variables) {
						try {
							const vars = JSON.parse(params.variables);
							for (const [key, value] of Object.entries(vars)) {
								const pattern = new RegExp(`\\{\\{${key}(?::[^}]*)?\\}\\}`, "g");
								content = content.replace(pattern, String(value));
							}
						} catch (e: any) {
							return text(`Invalid variables JSON: ${e.message}`);
						}
					}

					const targetFile = params.target.endsWith(".md") ? params.target : params.target + ".md";

					if (api) {
						const ep = encodePath(targetFile);
						const check = await apiRequest(config, "GET", `/vault/${ep}`);
						if (check.ok) return text(`File already exists: ${params.target}. Use 'write' to overwrite.`);
						const res = await apiRequest(config, "PUT", `/vault/${ep}`, {
							body: content,
							contentType: "text/markdown",
						});
						if (res.ok || res.status === 204) return text(`✓ Created from template "${params.template}": ${params.target}`);
						if (res.error) return text(`API error: ${res.error}`);
					}

					const targetPath = vaultPath(VAULT_ROOT, targetFile);
					if (fs.existsSync(targetPath)) {
						return text(`File already exists: ${params.target}. Use 'write' to overwrite.`);
					}
					ensureDir(path.dirname(targetPath));
					fs.writeFileSync(targetPath, content, "utf-8");
					return text(`✓ Created from template "${params.template}" (filesystem): ${params.target}`);
				}

				// ── frontmatter ───────────────────────────────
				case "frontmatter": {
					if (!params.path) return text("Missing required field: path");

					if (api) {
						const ep = encodePath(params.path);

						const res = await apiRequest(config, "GET", `/vault/${ep}`, {
							accept: "application/vnd.olrapi.note+json",
						});
						if (!res.ok) return text(res.status === 404 ? `File not found: ${params.path}` : `API error: ${res.error}`);

						const fm = res.data?.frontmatter ?? {};

						if (!params.updates) {
							if (Object.keys(fm).length === 0) return text(`No frontmatter found in: ${params.path}`);
							const output = Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n");
							return text(`Frontmatter for ${params.path}:\n\n${output}`);
						}

						try {
							const updates = JSON.parse(params.updates);

							if (updates.status && typeof updates.status === "string") {
								const normalized = updates.status.toLowerCase();
								if (fm.type === "tasknote" && !VALID_TASK_STATUSES.includes(normalized as any)) {
									return text(`Invalid task status: "${updates.status}". Valid: ${VALID_TASK_STATUSES.join(", ")}`);
								}
							}

							const errors: string[] = [];
							for (const [key, value] of Object.entries(updates)) {
								const patchRes = await apiRequest(config, "PATCH", `/vault/${ep}`, {
									body: JSON.stringify(value),
									contentType: "application/json",
									headers: {
										"Operation": "replace",
										"Target-Type": "frontmatter",
										"Target": key,
										"Create-Target-If-Missing": "true",
									},
								});
								if (!patchRes.ok) errors.push(`${key}: ${patchRes.error ?? `status ${patchRes.status}`}`);
							}

							await apiRequest(config, "PATCH", `/vault/${ep}`, {
								body: JSON.stringify(todayStr()),
								contentType: "application/json",
								headers: {
									"Operation": "replace",
									"Target-Type": "frontmatter",
									"Target": "modified",
									"Create-Target-If-Missing": "true",
								},
							});

							if (errors.length > 0) return text(`Partial update — errors:\n${errors.join("\n")}`);
							return text(`✓ Updated frontmatter in ${params.path}: ${Object.keys(updates).join(", ")}`);
						} catch (e: any) {
							return text(`Invalid updates JSON: ${e.message}`);
						}
					}

					// Filesystem fallback
					const fp = vaultPath(VAULT_ROOT, params.path);
					if (!fs.existsSync(fp)) return text(`File not found: ${params.path}`);

					const fileContent = fs.readFileSync(fp, "utf-8");
					const fmMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

					if (!params.updates) {
						if (!fmMatch) return text(`No frontmatter found in: ${params.path}`);
						return text(`Frontmatter for ${params.path}:\n\n\`\`\`yaml\n${fmMatch[1]}\n\`\`\``);
					}

					const rawFm = fmMatch ? fmMatch[1] : "";
					const body = fmMatch ? fmMatch[2] : fileContent;

					try {
						const updates = JSON.parse(params.updates);

						const fmLines = rawFm.split("\n");
						const updatedKeys = new Set<string>();
						const newLines = fmLines.map(line => {
							const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
							if (kvMatch && kvMatch[1] in updates) {
								updatedKeys.add(kvMatch[1]);
								const val = updates[kvMatch[1]];
								return `${kvMatch[1]}: ${typeof val === "object" ? JSON.stringify(val) : val}`;
							}
							return line;
						});

						for (const [key, value] of Object.entries(updates)) {
							if (!updatedKeys.has(key)) {
								newLines.push(`${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
							}
						}

						const modLine = newLines.findIndex(l => l.startsWith("modified:"));
						if (modLine >= 0) newLines[modLine] = `modified: ${todayStr()}`;
						else newLines.push(`modified: ${todayStr()}`);

						const updated = `---\n${newLines.join("\n")}\n---\n${body}`;
						fs.writeFileSync(fp, updated, "utf-8");
						return text(`✓ Updated frontmatter (filesystem) in ${params.path}: ${Object.keys(updates).join(", ")}`);
					} catch (e: any) {
						return text(`Invalid updates JSON: ${e.message}`);
					}
				}

				// ── recent ────────────────────────────────────
				case "recent": {
					const limit = params.limit ?? 20;
					const files: Array<{ path: string; mtime: Date }> = [];

					function collectFiles(dir: string): void {
						const entries = fs.readdirSync(dir, { withFileTypes: true });
						for (const entry of entries) {
							const full = path.join(dir, entry.name);
							if (entry.isDirectory()) {
								if (entry.name.startsWith(".") || entry.name === "_Attachments" || entry.name === "node_modules") continue;
								collectFiles(full);
							} else if (entry.name.endsWith(".md")) {
								const stat = fs.statSync(full);
								files.push({ path: path.relative(VAULT_ROOT, full), mtime: stat.mtime });
							}
						}
					}

					collectFiles(VAULT_ROOT);
					files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
					const top = files.slice(0, limit);

					if (top.length === 0) return text("No notes found in vault.");

					const output = top.map(f => {
						const ago = Math.floor((Date.now() - f.mtime.getTime()) / 1000);
						let agoStr: string;
						if (ago < 60) agoStr = `${ago}s ago`;
						else if (ago < 3600) agoStr = `${Math.floor(ago / 60)}m ago`;
						else if (ago < 86400) agoStr = `${Math.floor(ago / 3600)}h ago`;
						else agoStr = `${Math.floor(ago / 86400)}d ago`;
						return `- ${f.path} (${agoStr})`;
					}).join("\n");

					return text(`Recently modified notes (${top.length}):\n\n${output}`);
				}

				// ── daily ─────────────────────────────────────
				case "daily": {
					const dateStr = params.date ?? todayStr();

					if (api) {
						const date = new Date(dateStr + "T12:00:00");
						const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();

						const res = await apiRequest(config, "GET", `/periodic/daily/${y}/${m}/${d}/`, {
							accept: "application/vnd.olrapi.note+json",
						});

						if (res.ok && res.data) {
							if (!params.content) {
								return text(res.data.content ?? "(empty daily note)");
							}
							const appendRes = await apiRequest(config, "POST", `/periodic/daily/${y}/${m}/${d}/`, {
								body: params.content,
								contentType: "text/markdown",
							});
							if (appendRes.ok || appendRes.status === 204) return text(`✓ Appended to daily note: ${dateStr}`);
							return text(`API error: ${appendRes.error}`);
						}

						if (res.status === 404) {
							const createRes = await apiRequest(config, "POST", `/periodic/daily/${y}/${m}/${d}/`, {
								body: params.content ?? "",
								contentType: "text/markdown",
							});
							if (createRes.ok || createRes.status === 204) return text(`✓ Created daily note via API: ${dateStr}`);
						}
					}

					// Filesystem fallback
					const notePath = vaultPath(VAULT_ROOT, DAILY_NOTES_DIR, `${dateStr}.md`);

					if (fs.existsSync(notePath)) {
						if (!params.content) return text(fs.readFileSync(notePath, "utf-8"));
						const existing = fs.readFileSync(notePath, "utf-8");
						fs.writeFileSync(notePath, existing + "\n" + params.content + "\n", "utf-8");
						return text(`✓ Appended to daily note (filesystem): ${dateStr}`);
					}

					const date = new Date(dateStr + "T12:00:00");
					const { yesterday, tomorrow } = adjacentDates(dateStr);
					const dailyContent = `---
created: ${dateStr}
modified: ${dateStr}
type: daily-note
tags:
  - daily
---

# 📅 ${formatDailyDate(date)}

## 🎯 Habits Tracker
- [ ] Morning meditation
- [ ] Exercise 
- [ ] Language study (Thai/Spanish/Russian)
- [ ] Reading (30 min)
- [ ] No phone first 30 min
- [ ] Evening reflection
- [ ] Gratitude practice

## 📍 Top 3 Priorities
1. ${params.content ? params.content.split("\n")[0] || "" : ""}
2. 
3. 

## 📚 Learning
**Thai:** ___ minutes
**Spanish:** ___ minutes  
**Course Progress:**

## 💭 End of Day
**Best Thing Today:** 
**Tomorrow's #1 Priority:** 
**Grateful For:** 

---
## 🔄 Links
← [[${yesterday}|Yesterday]] | [[${tomorrow}|Tomorrow]] →
[[Weekly Review|Week Review]]
`;
					ensureDir(path.dirname(notePath));
					fs.writeFileSync(notePath, dailyContent, "utf-8");
					return text(`✓ Created daily note (filesystem): ${dateStr}`);
				}

				// ── open (API-only) ───────────────────────────
				case "open": {
					if (!params.path) return text("Missing required field: path");
					if (!api) return text("Error: open requires Obsidian REST API (Obsidian not running)");

					const queryStr = params.new_leaf ? "?newLeaf=true" : "";
					const res = await apiRequest(config, "POST", `/open/${encodePath(params.path)}${queryStr}`);
					if (res.ok || res.status === 200) return text(`✓ Opened in Obsidian: ${params.path}`);
					if (res.status === 404) return text(`File not found: ${params.path} (note: Obsidian may create it)`);
					return text(`Open error: ${res.error ?? `status ${res.status}`}`);
				}

				// ── commands (API-only) ───────────────────────
				case "commands": {
					if (!api) return text("Error: commands requires Obsidian REST API (Obsidian not running)");

					if (params.target) {
						const res = await apiRequest(config, "POST", `/commands/${encodeURIComponent(params.target)}/`);
						if (res.ok || res.status === 204) return text(`✓ Executed command: ${params.target}`);
						if (res.status === 404) return text(`Command not found: ${params.target}`);
						return text(`Command error: ${res.error ?? `status ${res.status}`}`);
					}

					const res = await apiRequest(config, "GET", "/commands/");
					if (!res.ok) return text(`Commands error: ${res.error ?? `status ${res.status}`}`);

					const commands = res.data?.commands ?? [];
					if (commands.length === 0) return text("No commands available.");

					let filtered = commands;
					if (params.query) {
						const q = params.query.toLowerCase();
						filtered = commands.filter((c: any) =>
							c.name?.toLowerCase().includes(q) || c.id?.toLowerCase().includes(q)
						);
					}

					const limit = params.limit ?? 50;
					const limited = filtered.slice(0, limit);
					const output = limited.map((c: any) => `- \`${c.id}\` — ${c.name}`).join("\n");
					const truncMsg = filtered.length > limit ? `\n\n(showing ${limit} of ${filtered.length})` : "";
					return text(`Available commands (${filtered.length}):\n\n${output}${truncMsg}`);
				}

				// ── document_map ──────────────────────────────
				case "document_map": {
					if (!params.path) return text("Missing required field: path");

					if (api) {
						const res = await apiRequest(config, "GET", `/vault/${encodePath(params.path)}`, {
							accept: "application/vnd.olrapi.document-map+json",
						});
						if (res.ok && res.data) {
							const map = res.data;
							const parts: string[] = [`Document map for ${params.path}:\n`];

							if (map.headings?.length > 0) {
								parts.push("**Headings:**");
								parts.push(...map.headings.map((h: string) => `  ${h}`));
							}
							if (map.blocks?.length > 0) {
								parts.push("\n**Block references:**");
								parts.push(...map.blocks.map((b: string) => `  ${b}`));
							}
							if (map.frontmatterFields?.length > 0) {
								parts.push("\n**Frontmatter fields:**");
								parts.push(...map.frontmatterFields.map((f: string) => `  ${f}`));
							}

							return text(parts.join("\n"));
						}
						if (res.status === 404) return text(`File not found: ${params.path}`);
					}

					const fp = vaultPath(VAULT_ROOT, params.path);
					if (!fs.existsSync(fp)) return text(`File not found: ${params.path}`);

					const content = fs.readFileSync(fp, "utf-8");
					const parts: string[] = [`Document map for ${params.path} (filesystem):\n`];

					const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
					if (fmMatch) {
						const fields = fmMatch[1].split("\n")
							.map(l => l.match(/^(\w[\w-]*)\s*:/))
							.filter(Boolean)
							.map(m => m![1]);
						if (fields.length > 0) {
							parts.push("**Frontmatter fields:**");
							parts.push(...fields.map(f => `  ${f}`));
						}
					}

					const headings = content.split("\n")
						.filter(l => /^#{1,6}\s/.test(l))
						.map(l => l.trim());
					if (headings.length > 0) {
						parts.push("\n**Headings:**");
						parts.push(...headings.map(h => `  ${h}`));
					}

					const blocks = content.split("\n")
						.map(l => l.match(/\^([a-zA-Z0-9]+)\s*$/))
						.filter(Boolean)
						.map(m => `^${m![1]}`);
					if (blocks.length > 0) {
						parts.push("\n**Block references:**");
						parts.push(...blocks.map(b => `  ${b}`));
					}

					return text(parts.join("\n"));
				}

				default:
					return text(`Unknown action: ${(params as any).action}`);
			}
		},
	});
}
