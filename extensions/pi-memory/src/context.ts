/**
 * pi-memory — System prompt injection.
 *
 * On `before_agent_start`, injects recent memory into the system prompt:
 *   - MEMORY.md (long-term, curated facts)
 *   - Yesterday's daily log
 *   - Today's daily log
 *
 * Also injects behavioral instructions for when to write/search memory.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as files from "./files.ts";

const MEMORY_INSTRUCTIONS = `
## Memory System

You have a persistent memory system. At the start of each session, your long-term memory (MEMORY.md) and recent daily logs are loaded automatically.

**Rules:**
- When you learn something important (preferences, decisions, facts), use \`memory_write\` with target \`long_term\` to store it.
- When the user says "remember this" or similar, always write it to memory.
- Use \`memory_write\` with target \`daily\` for session notes and running context.
- Use \`memory_search\` when you need to recall something from past sessions.
- Proactively save important context at the end of significant work sessions.
- Keep daily entries concise: what was done, key decisions, blockers, next steps.
- For long-term memory, organize into sections and keep them up to date.
`.trim();

export function registerMemoryContext(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async (event) => {
		const parts: string[] = [];

		const ltm = files.readFileOr(files.longTermPath());
		if (ltm.trim()) {
			parts.push("## Long-Term Memory (MEMORY.md)\n\n" + ltm.trim());
		}

		const yd = files.yesterdayStr();
		const yesterday = files.readFileOr(files.dailyPath(yd));
		if (yesterday.trim()) {
			parts.push(`## Yesterday (${yd})\n\n` + yesterday.trim());
		}

		const td = files.todayStr();
		const today = files.readFileOr(files.dailyPath(td));
		if (today.trim()) {
			parts.push(`## Today (${td})\n\n` + today.trim());
		}

		const memoryBlock = parts.length > 0
			? "\n\nCurrent memory:\n\n# 🧠 Memory\n\n" + parts.join("\n\n---\n\n")
			: "";

		return {
			systemPrompt:
				event.systemPrompt +
				"\n\n---\n\n" +
				MEMORY_INSTRUCTIONS +
				memoryBlock,
		};
	});
}
