/**
 * pi-channels — Platform-specific message formatting.
 *
 * Converts Markdown-like text to each platform's native format:
 *   - Telegram: HTML (parse_mode: HTML)
 *   - Slack: mrkdwn (with mrkdwn: true in postMessage)
 *   - Webhook/other: pass through as-is
 *
 * Supported Markdown constructs:
 *   **bold**  → <b>bold</b> (Telegram) / *bold* (Slack)
 *   *italic*  → <i>italic</i> (Telegram) / _italic_ (Slack)
 *   `code`    → <code>code</code> (Telegram) / `code` (Slack)
 *   ```block``` → <pre>block</pre> (Telegram) / ```block``` (Slack)
 *   [text](url) → <a href="url">text</a> (Telegram) / <url|text> (Slack)
 *   ~~strike~~ → <s>strike</s> (Telegram) / ~strike~ (Slack)
 *
 * Headings (#, ##, ###) → Slack: *bold text* | Telegram: <b>text</b>
 * Unordered lists (- item) → kept as-is (both platforms support them natively)
 */

export interface FormattedMessage {
	/** Formatted text for the target platform. */
	text: string;
	/** Parser mode for Telegram (set parse_mode to this value). */
	telegramParseMode?: string;
}

/**
 * Format a message for a specific adapter platform.
 * Returns the formatted text and any platform-specific hints.
 */
export function formatForPlatform(text: string, adapter: string): FormattedMessage {
	switch (adapter) {
		case "telegram":
			return { text: toTelegramHtml(text), telegramParseMode: "HTML" };
		case "slack":
			return { text: toSlackMrkdwn(text) };
		default:
			return { text };
	}
}

// ── Telegram HTML formatter ─────────────────────────────────────

const TELEGRAM_ESCAPE = /[<>&]/g;
const telegramEscapeMap: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;" };

function escapeTelegram(text: string): string {
	return text.replace(TELEGRAM_ESCAPE, (ch) => telegramEscapeMap[ch]);
}

function toTelegramHtml(text: string): string {
	// Order matters: fenced code before inline code, links before bold/italic
	let result = text;

	// 1. Fenced code blocks: ```...```
	result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
		return `<pre>${escapeTelegram(code.trim())}</pre>`;
	});

	// 2. Inline code: `...`
	result = result.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeTelegram(code)}</code>`);

	// 3. Links: [text](url)
	result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
		return `<a href="${escapeTelegram(url)}">${escapeTelegram(text)}</a>`;
	});

	// 4. Bold: **...**
	result = result.replace(/\*\*([^*]+)\*\*/g, (_, text) => `<b>${escapeTelegram(text)}</b>`);

	// 5. Italic: *text* (not preceded by *, to avoid matching **)
	result = result.replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, (_, before, text, after) => {
		return `${before}<i>${escapeTelegram(text)}</i>${after}`;
	});

	// 6. Strikethrough: ~~...~~
	result = result.replace(/~~([^~]+)~~/g, (_, text) => `<s>${escapeTelegram(text)}</s>`);

	// 7. Headings (# ## ###) → bold
	result = result.replace(/^#{1,3}\s+(.+)$/gm, (_, text) => `<b>${text}</b>`);

	return result;
}

// ── Slack mrkdwn formatter ──────────────────────────────────────

function toSlackMrkdwn(text: string): string {
	// Slack mrkdwn is very similar to basic Markdown.
	// Key differences:
	//   - Links: <url|text> instead of [text](url)
	//   - Lists use • or 1. 2. 3. (no - auto-formatting)
	//   - No heading support → bold + newline
	//   - Bold/italic/code are the same (*, _, `)

	let result = text;

	// 1. Links: [text](url) → <url|text>
	result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

	// 2. Headings (# ## ###) → bold text
	result = result.replace(/^#{1,3}\s+(.+)$/gm, "*$1*");

	// Everything else (bold, italic, code, strikethrough, lists) is already standard
	// Slack-compatible Markdown and doesn't need transformation.

	return result;
}
