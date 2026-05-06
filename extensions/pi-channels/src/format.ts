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

/** Escape HTML special chars for Telegram HTML parse_mode. */
function escapeTelegram(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toTelegramHtml(text: string): string {
	// Strategy: escape once up-front, then convert Markdown markers to Telegram HTML tags.
	// Order matters: fenced code before inline code, links before bold/italic.
	let result = escapeTelegram(text);

	// 1. Fenced code blocks: ```...``` — content is already escaped, wrap in <pre>
	result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
		return `<pre>${code.trim()}</pre>`;
	});

	// 2. Inline code: `...` — content already escaped, wrap in <code>
	result = result.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);

	// 3. Links: [text](url) — href is raw URL, text already escaped
	result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
		return `<a href="${url}">${text}</a>`;
	});

	// 4. Bold: **...** — content already escaped
	result = result.replace(/\*\*([^*]+)\*\*/g, (_, text) => `<b>${text}</b>`);

	// 5. Italic: *text* (not preceded by *, not followed by *) — content already escaped
	result = result.replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, (_, before, text, after) => {
		return `${before}<i>${text}</i>${after}`;
	});

	// 6. Strikethrough: ~~...~~ — content already escaped
	result = result.replace(/~~([^~]+)~~/g, (_, text) => `<s>${text}</s>`);

	// 7. Headings (# ## ###) → bold, content already escaped
	result = result.replace(/^#{1,3}\s+(.+)$/gm, (_, text) => `<b>${text}</b>`);

	// Note: all text was escaped before replacements, so bare <, >, & are already encoded.
	// The Markdown markers (```, *, ~~, #, etc.) were also escaped but are un-escaped
	// by the replacements above, producing valid HTML.

	return result;
}

// ── Slack mrkdwn formatter ──────────────────────────────────────

function toSlackMrkdwn(text: string): string {
	// Slack mrkdwn is very similar to basic Markdown.
	// Key differences:
	//   - Links: <url|text> instead of [text](url)
	//   - Lists use • or 1. 2. 3. (no - auto-formatting)
	//   - No heading support → bold + newline
	//   - Bold is the same (*)
	//   - Italic: *text* → _text_
	//   - Strikethrough: ~~text~~ → ~text~

	let result = text;

	// 1. Links: [text](url) → <url|text>
	result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

	// 2. Headings (# ## ###) → bold text
	result = result.replace(/^#{1,3}\s+(.+)$/gm, "*$1*");

	// 3. Italic: *text* → _text_ (Slack uses _ for italic, * for bold)
	result = result.replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, "$1_$2_$3");

	// 4. Strikethrough: ~~text~~ → ~text~ (Slack uses single tilde)
	result = result.replace(/~~([^~]+)~~/g, "~$1~");

	return result;
}
