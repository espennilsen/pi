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
	// Strategy: protect code blocks and links first, then process emphasis.
	// We use placeholders to preserve protected spans, then restore them.
	const protectedSpans: string[] = [];

	// 1. Protect fenced code blocks: ```...``` — escape content first
	text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
		const idx = protectedSpans.length;
		const escapedCode = escapeTelegram(code.trim());
		protectedSpans.push(`<pre>${escapedCode}</pre>`);
		return `__PROTECTED_${idx}__`;
	});

	// 2. Protect inline code: `...` — escape content first
	text = text.replace(/`([^`]+)`/g, (_, code) => {
		const idx = protectedSpans.length;
		const escapedCode = escapeTelegram(code);
		protectedSpans.push(`<code>${escapedCode}</code>`);
		return `__PROTECTED_${idx}__`;
	});

	// 3. Protect links: [text](url) — escape both link text and URL for HTML safety
	text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) => {
		const idx = protectedSpans.length;
		const escapedText = escapeTelegram(linkText);
		const escapedUrl = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
		protectedSpans.push(`<a href="${escapedUrl}">${escapedText}</a>`);
		return `__PROTECTED_${idx}__`;
	});

	// Now escape remaining text and process emphasis
	let result = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

	// 4. Bold: **...**
	result = result.replace(/\*\*([^*]+)\*\*/g, (_, txt) => `<b>${txt}</b>`);

	// 5. Italic: *text*
	result = result.replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, (_, before, txt, after) => {
		return `${before}<i>${txt}</i>${after}`;
	});

	// 6. Strikethrough: ~~...~~
	result = result.replace(/~~([^~]+)~~/g, (_, txt) => `<s>${txt}</s>`);

	// 7. Headings (# ## ###) → bold
	result = result.replace(/^#{1,3}\s+(.+)$/gm, (_, txt) => `<b>${txt}</b>`);

	// Restore protected spans
	for (let i = 0; i < protectedSpans.length; i++) {
		result = result.replace(new RegExp(`__PROTECTED_${i}__`, 'g'), () => protectedSpans[i]);
	}

	return result;
}

// ── Slack mrkdwn formatter ──────────────────────────────────────

function toSlackMrkdwn(text: string): string {
	// Protect code blocks and links first to avoid corrupting their contents
	const protectedSpans: string[] = [];

	// 1. Protect fenced code blocks — use triple backticks for Slack
	text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
		const idx = protectedSpans.length;
		const langPart = lang ? lang : "";
		protectedSpans.push(`\`\`\`${langPart}\n${code}\`\`\``);
		return `__PROTECTED_${idx}__`;
	});

	// 2. Protect inline code
	text = text.replace(/`([^`]+)`/g, (_, code) => {
		const idx = protectedSpans.length;
		protectedSpans.push(`\`${code}\``);
		return `__PROTECTED_${idx}__`;
	});

	// 3. Protect links
	text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) => {
		const idx = protectedSpans.length;
		protectedSpans.push(`<${url}|${linkText}>`);
		return `__PROTECTED_${idx}__`;
	});

	let result = text;

	// 4. Bold: **text** → *_text_* (use underscore to avoid italic pattern)
	result = result.replace(/\*\*([^*]+)\*\*/g, "_*$1*_");

	// 5. Italic: *text* → _text_ (do this BEFORE headings to avoid converting *Heading*)
	result = result.replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, "$1_$2_$3");

	// 6. Headings → *bold* (won't match italic anymore since * are now _)
	result = result.replace(/^#{1,3}\s+(.+)$/gm, "*$1*");

	// 6. Strikethrough: ~~text~~ → ~text~
	result = result.replace(/~~([^~]+)~~/g, "~$1~");

	// Restore protected spans
	for (let i = 0; i < protectedSpans.length; i++) {
		result = result.replace(`__PROTECTED_${i}__`, protectedSpans[i]);
	}

	return result;
}
