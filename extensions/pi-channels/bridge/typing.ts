/**
 * pi-channels — Typing indicator manager.
 *
 * Sends periodic typing chat actions via the adapter's sendTyping method.
 * Telegram typing indicators expire after ~5s, so we refresh every 4s.
 * For adapters without sendTyping, this is a no-op.
 */

import type { ChannelAdapter } from "../types.ts";

const TYPING_INTERVAL_MS = 4_000;

/**
 * Start sending typing indicators. Returns a stop() handle.
 * No-op if the adapter doesn't support sendTyping.
 */
export function startTyping(
	adapter: ChannelAdapter | undefined,
	recipient: string,
): { stop: () => void } {
	if (!adapter?.sendTyping) return { stop() {} };

	// Fire immediately
	adapter.sendTyping(recipient).catch(() => {});

	const timer = setInterval(() => {
		adapter.sendTyping!(recipient).catch(() => {});
	}, TYPING_INTERVAL_MS);

	return {
		stop() {
			clearInterval(timer);
		},
	};
}
