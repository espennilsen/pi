/**
 * Confidence decay for menu items.
 *
 * Gradually decreases active_confidence for items that haven't been seen recently.
 * All DB access via operations module (event bus, no direct kysely).
 */

import type { LogFn } from "../logger.ts";
import * as ops from "../db/operations.ts";

/**
 * Decay confidence for all menu items based on time since last_seen_at.
 *
 * Decay strategy:
 * - Items not seen in 7+ days: -0.1 confidence
 * - Items not seen in 14+ days: -0.2 confidence
 * - Items not seen in 30+ days: -0.3 confidence
 * - Min confidence: 0.0
 */
export async function decayConfidences(log: LogFn): Promise<void> {
	try {
		const now = new Date();
		const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
		const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
		const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

		const items = await ops.getAllMenuItems();

		let decayed = 0;

		for (const item of items) {
			if (!item.last_seen_at) {
				continue;
			}

			const lastSeen = new Date(item.last_seen_at as string);
			let decayAmount = 0;

			if (lastSeen < thirtyDaysAgo) {
				decayAmount = 0.3;
			} else if (lastSeen < fourteenDaysAgo) {
				decayAmount = 0.2;
			} else if (lastSeen < sevenDaysAgo) {
				decayAmount = 0.1;
			}

			const currentConfidence = item.active_confidence as number;
			if (decayAmount > 0 && currentConfidence > 0) {
				const newConfidence = Math.max(0, currentConfidence - decayAmount);
				await ops.updateMenuItemConfidence(item.id as number, newConfidence);
				decayed++;
			}
		}

		log("decay_confidences_complete", {
			totalItems: items.length,
			decayed,
		});
	} catch (err: any) {
		log("decay_confidences_error", { error: err.message }, "error");
		throw err;
	}
}
