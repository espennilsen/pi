import type { GmailSettings } from "./types.ts";

const SENDING_ACTIONS = new Set(["send", "send_draft"]);

/** Returns whether an action must be blocked by the configured send policy. */
export function isSendActionBlocked(settings: GmailSettings, action: string): boolean {
	return settings.readOnly === true && SENDING_ACTIONS.has(action);
}

/** User-facing explanation for a send action blocked by read-only mode. */
export function sendingDisabledMessage(): string {
	return "❌ Sending email is disabled because pi-gmail is in read-only mode.";
}
