/**
 * pi-context — /context command.
 *
 * Visual breakdown of context window usage by category,
 * inspired by Claude Code's /context command.
 *
 * Shows:
 *   - Token usage bar with colored hexagons
 *   - Category breakdown (system prompt, tools, agents, skills, messages)
 *   - Per-item token counts for tools, agents, and skills
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { getAgentDir, estimateTokens, SettingsManager } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";

// ── ANSI colors ─────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const BLUE = "\x1b[34m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const GRAY = "\x1b[90m";
const RED = "\x1b[91m";
const WHITE = "\x1b[37m";

function color(c: string, text: string): string {
	return `${c}${text}${RESET}`;
}

// ── Token estimation ────────────────────────────────────────────

/** Estimate tokens from a string using chars/4 heuristic. */
function estimateStringTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

// ── Data collection ─────────────────────────────────────────────

interface CategoryBreakdown {
	systemPrompt: number;
	tools: { name: string; tokens: number }[];
	agents: { name: string; tokens: number }[];
	skills: { name: string; tokens: number }[];
	messages: number;
}

interface CategoryInfo {
	label: string;
	tokens: number;
	hex: string;
	colorCode: string;
}

function collectToolTokens(pi: ExtensionAPI): { name: string; tokens: number }[] {
	const tools = pi.getAllTools();
	return tools.map((t) => {
		const schemaText = t.parameters ? JSON.stringify(t.parameters) : "";
		const text = `${t.name}\n${t.description ?? ""}\n${schemaText}`;
		return { name: t.name, tokens: estimateStringTokens(text) };
	});
}

function collectAgentTokens(): { name: string; tokens: number }[] {
	const agentDir = getAgentDir();
	const agentsPath = join(agentDir, "agents");
	const results: { name: string; tokens: number }[] = [];

	try {
		const files = readdirSync(agentsPath).filter((f) => f.endsWith(".md"));
		for (const file of files) {
			try {
				const content = readFileSync(join(agentsPath, file), "utf-8");
				const name = file.replace(/\.md$/, "");
				results.push({ name, tokens: estimateStringTokens(content) });
			} catch {
				// skip unreadable files
			}
		}
	} catch {
		// agents dir doesn't exist
	}

	return results;
}

function collectSkillTokens(pi: ExtensionAPI): { name: string; tokens: number }[] {
	const commands = pi.getCommands();
	const skills = commands.filter((c) => c.source === "skill");
	return skills.map((s) => {
		const text = `${s.name}: ${s.description ?? ""}`;
		return { name: s.name, tokens: estimateStringTokens(text) };
	});
}

function collectMessageTokens(ctx: ExtensionCommandContext): number {
	const branch = ctx.sessionManager.getBranch();
	let total = 0;
	for (const entry of branch) {
		if (entry.type === "message") {
			total += estimateTokens(entry.message);
		} else if (entry.type === "custom_message") {
			const content = entry.content;
			if (typeof content === "string") {
				total += estimateStringTokens(content);
			} else if (Array.isArray(content)) {
				for (const part of content) {
					if (part.type === "text") {
						total += estimateStringTokens(part.text);
					}
				}
			}
		} else if (entry.type === "compaction") {
			total += estimateStringTokens(entry.summary);
		} else if (entry.type === "branch_summary") {
			total += estimateStringTokens(entry.summary);
		}
	}
	return total;
}

function collectBreakdown(pi: ExtensionAPI, ctx: ExtensionCommandContext): CategoryBreakdown {
	const fullSystemPrompt = estimateStringTokens(ctx.getSystemPrompt());
	const tools = collectToolTokens(pi);
	const agents = collectAgentTokens();
	const skills = collectSkillTokens(pi);
	const messages = collectMessageTokens(ctx);

	// The system prompt includes injected tool/skill/agent blocks.
	// Subtract those to get the core system prompt tokens and avoid double-counting.
	const toolsTotal = tools.reduce((s, t) => s + t.tokens, 0);
	const agentsTotal = agents.reduce((s, a) => s + a.tokens, 0);
	const skillsTotal = skills.reduce((s, sk) => s + sk.tokens, 0);
	const systemPrompt = Math.max(fullSystemPrompt - toolsTotal - agentsTotal - skillsTotal, 0);

	return { systemPrompt, tools, agents, skills, messages };
}

// ── Bar rendering ───────────────────────────────────────────────

const HEX_FILLED = "⛁";
const HEX_HALF = "⛀";
const HEX_EMPTY = "⛶";
const HEX_COMPACT = "⛝";

const BAR_WIDTH = 10;
const BAR_ROWS = 10;
const TOTAL_CELLS = BAR_WIDTH * BAR_ROWS; // 100 cells = 1% each

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return String(tokens);
}

function formatPercent(fraction: number): string {
	return `${(fraction * 100).toFixed(1)}%`;
}

/** Split a flat array of styled chars into 10×10 grid rows. */
function gridRows(chars: string[]): string[] {
	const rows: string[] = [];
	for (let r = 0; r < BAR_ROWS; r++) {
		rows.push(chars.slice(r * BAR_WIDTH, (r + 1) * BAR_WIDTH).join(" "));
	}
	return rows;
}

/** Build the category breakdown bar — each category gets a color. */
function buildCategoryBar(
	contextWindow: number,
	categories: CategoryInfo[],
	autocompactTokens: number,
): string[] {
	const chars: string[] = [];

	for (const cat of categories) {
		const cells = Math.max(
			Math.round((cat.tokens / contextWindow) * TOTAL_CELLS),
			cat.tokens > 0 ? 1 : 0,
		);
		for (let i = 0; i < cells; i++) chars.push(color(cat.colorCode, cat.hex));
	}

	// Free space in the middle, autocompact at the end
	const compactCells = Math.round((autocompactTokens / contextWindow) * TOTAL_CELLS);
	const freeCells = Math.max(TOTAL_CELLS - chars.length - compactCells, 0);
	for (let i = 0; i < freeCells; i++) chars.push(color(GRAY, HEX_EMPTY));
	for (let i = 0; i < compactCells; i++) chars.push(color(RED, HEX_COMPACT));

	while (chars.length < TOTAL_CELLS) chars.push(color(GRAY, HEX_EMPTY));
	chars.length = TOTAL_CELLS;

	return gridRows(chars);
}

// ── Main formatter ──────────────────────────────────────────────

function formatOutput(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	breakdown: CategoryBreakdown,
	usedTokens: number,
	contextWindow: number,
): string {
	const model = ctx.model;
	const modelName = model ? model.id : "unknown";

	// Autocompact buffer — reserveTokens from settings (default 16384)
	const settings = SettingsManager.create(ctx.cwd, getAgentDir());
	const autocompactTokens = settings.getCompactionReserveTokens();
	const freeTokens = Math.max(contextWindow - usedTokens - autocompactTokens, 0);

	const toolsTotal = breakdown.tools.reduce((s, t) => s + t.tokens, 0);
	const agentsTotal = breakdown.agents.reduce((s, a) => s + a.tokens, 0);
	const skillsTotal = breakdown.skills.reduce((s, s2) => s + s2.tokens, 0);

	// Compute system prompt tokens as the remainder so all categories
	// sum exactly to usedTokens. The heuristic estimates for individual
	// categories (tools, agents, skills, messages) are reliable since we
	// have their actual content, but the system prompt is hard to estimate
	// independently — it contains injected blocks that overlap with other
	// categories. Using the remainder avoids double-counting mismatches
	// and guarantees the numbers always add up.
	const systemPromptTokens = Math.max(
		usedTokens - toolsTotal - agentsTotal - skillsTotal - breakdown.messages,
		0,
	);

	// Build category list with colors
	const categories: CategoryInfo[] = [
		{ label: "System prompt", tokens: systemPromptTokens, hex: HEX_FILLED, colorCode: BLUE },
		{ label: "Tools", tokens: toolsTotal, hex: HEX_FILLED, colorCode: CYAN },
	];
	if (agentsTotal > 0) {
		categories.push({ label: "Custom agents", tokens: agentsTotal, hex: HEX_FILLED, colorCode: MAGENTA });
	}
	if (skillsTotal > 0) {
		categories.push({ label: "Skills", tokens: skillsTotal, hex: HEX_FILLED, colorCode: YELLOW });
	}
	categories.push({ label: "Messages", tokens: breakdown.messages, hex: HEX_HALF, colorCode: GREEN });

	// ── Bar ─────────────────────────────────────────────────
	const categoryBar = buildCategoryBar(contextWindow, categories, autocompactTokens);

	const lines: string[] = [];
	lines.push(`${BOLD}Context Usage${RESET}`);
	lines.push("");

	// Build right-side annotations for category bar rows
	const legendItems: string[] = [];
	for (const cat of categories) {
		legendItems.push(
			`${color(cat.colorCode, cat.hex)} ${cat.label}: ${formatTokens(cat.tokens)} tokens (${formatPercent(cat.tokens / contextWindow)})`,
		);
	}
	legendItems.push(
		`${color(GRAY, HEX_EMPTY)} Free space: ${formatTokens(freeTokens)} (${formatPercent(freeTokens / contextWindow)})`,
	);

	const categoryAnnotations: string[] = Array(BAR_ROWS).fill("");
	categoryAnnotations[0] = `   ${color(WHITE, modelName)} · ${formatTokens(usedTokens)}/${formatTokens(contextWindow)} tokens`;
	categoryAnnotations[1] = `   Estimated usage: ${formatPercent(usedTokens / contextWindow)}`;
	for (let i = 0; i < legendItems.length; i++) {
		categoryAnnotations[i + 2] = `   ${legendItems[i]}`;
	}
	categoryAnnotations[BAR_ROWS - 1] = `   ${color(RED, HEX_COMPACT)} Autocompact buffer: ${formatTokens(autocompactTokens)} tokens`;

	for (let r = 0; r < BAR_ROWS; r++) {
		lines.push(`${categoryBar[r]}${categoryAnnotations[r]}`);
	}

	// ── Tool detail list ────────────────────────────────────
	if (breakdown.tools.length > 0) {
		lines.push("");
		lines.push(`${BOLD}Tools${RESET} (${breakdown.tools.length})`);
		const sorted = [...breakdown.tools].sort((a, b) => b.tokens - a.tokens);
		for (const t of sorted) {
			lines.push(`${DIM}└${RESET} ${t.name}: ${color(CYAN, formatTokens(t.tokens))} tokens`);
		}
	}

	// ── Agent detail list ───────────────────────────────────
	if (breakdown.agents.length > 0) {
		lines.push("");
		lines.push(`${BOLD}Custom agents${RESET}`);
		const sorted = [...breakdown.agents].sort((a, b) => b.tokens - a.tokens);
		for (const a of sorted) {
			lines.push(`${DIM}└${RESET} ${a.name}: ${color(MAGENTA, formatTokens(a.tokens))} tokens`);
		}
	}

	// ── Skill detail list ───────────────────────────────────
	if (breakdown.skills.length > 0) {
		lines.push("");
		lines.push(`${BOLD}Skills${RESET}`);
		const sorted = [...breakdown.skills].sort((a, b) => b.tokens - a.tokens);
		for (const s of sorted) {
			lines.push(`${DIM}└${RESET} ${s.name}: ${color(YELLOW, formatTokens(s.tokens))} tokens`);
		}
	}

	return lines.join("\n");
}

// ── Extension entry point ───────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.registerCommand("context", {
		description: "Show context window usage breakdown",
		handler: async (_args, ctx) => {
			const usage = ctx.getContextUsage();
			if (!usage) {
				ctx.ui.notify("Context usage not available yet — send a message first.", "info");
				return;
			}

			if (usage.tokens == null) {
				ctx.ui.notify("Context usage is being recalculated (e.g. after compaction) — try again after the next response.", "info");
				return;
			}

			const contextWindow = usage.contextWindow;
			const breakdown = collectBreakdown(pi, ctx);

			// The API-reported token count may be 0 before the first response.
			// Fall back to the sum of estimated category tokens so the header
			// stays consistent with the per-category percentages shown below.
			const apiTokens = usage.tokens;
			const estimatedTotal =
				breakdown.systemPrompt +
				breakdown.tools.reduce((s, t) => s + t.tokens, 0) +
				breakdown.agents.reduce((s, a) => s + a.tokens, 0) +
				breakdown.skills.reduce((s, sk) => s + sk.tokens, 0) +
				breakdown.messages;
			const usedTokens = apiTokens > 0 ? apiTokens : estimatedTotal;

			const output = formatOutput(pi, ctx, breakdown, usedTokens, contextWindow);

			ctx.ui.notify(output, "info");
		},
	});
}
