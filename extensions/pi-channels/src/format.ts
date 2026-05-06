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
	// Strategy: replace Markdown constructs with HTML tags, escaping text portions.
	// Order matters: fenced code before inline code, links before bold/italic.
	let result = text;

	// 1. Fenced code blocks: ```...``` — escape content, wrap in <pre>
	result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
		return `<pre>${escapeTelegram(code.trim())}</pre>`;
	});

	// 2. Inline code: `...` — escape content, wrap in <code>
	result = result.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeTelegram(code)}</code>`);

	// 3. Links: [text](url) — escape both text and url
	result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
		return `<a href="${escapeTelegram(url)}">${escapeTelegram(text)}</a>`;
	});

	// 4. Bold: **...** — escape inner text
	result = result.replace(/\*\*([^*]+)\*\*/g, (_, text) => `<b>${escapeTelegram(text)}</b>`);

	// 5. Italic: *text* (not preceded by *, not followed by *) — escape inner text
	result = result.replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, (_, before, text, after) => {
		return `${before}<i>${escapeTelegram(text)}</i>${after}`;
	});

	// 6. Strikethrough: ~~...~~ — escape inner text
	result = result.replace(/~~([^~]+)~~/g, (_, text) => `<s>${escapeTelegram(text)}</s>`);

	// 7. Headings (# ## ###) → bold, escaping the heading text
	result = result.replace(/^#{1,3}\s+(.+)$/gm, (_, text) => `<b>${escapeTelegram(text)}</b>`);

	// 8. Escape any remaining bare HTML special chars not already inside tags
	result = result.replace(/(>)([^<]+)(<)/g, (_, gt, text_part, lt) => `${gt}${escapeTelegram(text_part)}${lt}`);

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
