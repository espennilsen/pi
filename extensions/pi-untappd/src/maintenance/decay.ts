/**
 * Confidence decay for menu items.
 *
 * Gradually decreases active_confidence for items that haven't been seen recently.
 * All DB access via operations module (event bus, no direct kysely).
 *
 * Uses target confidence levels per age bucket rather than fixed deltas,
 * so running daily (or more/less often) converges to the same values.
 */

import type { LogFn } from "../logger.ts";
import * as ops from "../db/operations.ts";

/**
 * Target confidence by age bucket.
 *
 * Instead of subtracting a fixed amount each run (which drains to 0 in days),
 * we define the target confidence ceiling for each age bucket. Items that are
 * currently above the target get clamped down once.
 *
 *   < 7 days unseen  → no decay (target: 1.0)
 *   7–13 days unseen → target: 0.7
 *   14–29 days unseen → target: 0.4
 *   30+ days unseen  → target: 0.1
 */
const AGE_BUCKETS: Array<{ minDays: number; targetConfidence: number }> = [
	{ minDays: 30, targetConfidence: 0.1 },
	{ minDays: 14, targetConfidence: 0.4 },
	{ minDays: 7, targetConfidence: 0.7 },
];

/**
 * Decay confidence for all menu items based on time since last_seen_at.
 *
 * Items are clamped to the target confidence for their age bucket.
 * Running this multiple times is idempotent — confidence only decreases
 * and never below the bucket target.
 */
export async function decayConfidences(log: LogFn): Promise<void> {
	try {
		const now = new Date();
		const items = await ops.getAllMenuItems();

		let decayed = 0;

		for (const item of items) {
			if (!item.last_seen_at) {
				continue;
			}

			const lastSeen = new Date(item.last_seen_at as string);
			const daysSince = (now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);

			// Find the matching age bucket (sorted largest first)
			let targetConfidence = 1.0;
			for (const bucket of AGE_BUCKETS) {
				if (daysSince >= bucket.minDays) {
					targetConfidence = bucket.targetConfidence;
					break;
				}
			}

			const currentConfidence = item.active_confidence as number;
			if (currentConfidence > targetConfidence) {
				await ops.updateMenuItemConfidence(item.id as number, targetConfidence);
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
