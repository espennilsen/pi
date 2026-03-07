/**
 * Confidence decay for menu items.
 * 
 * Gradually decreases active_confidence for items that haven't been seen recently.
 */

import type { LogFn } from "../logger.ts";
import type { Kysely } from "kysely";
import type { UntappdDatabase } from "../schema.ts";

// Dynamic import to get database access
async function getDatabase(): Promise<Kysely<UntappdDatabase>> {
	throw new Error("Database access not implemented");
}

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
		const db = await getDatabase();
		
		const now = new Date();
		const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
		const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
		const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
		
		// Get all menu items
		const items = await db
			.selectFrom("menu_items")
			.selectAll()
			.execute();
		
		let decayed = 0;
		
		for (const item of items) {
			if (!item.last_seen_at) {
				continue;
			}
			
			const lastSeen = new Date(item.last_seen_at);
			let decayAmount = 0;
			
			if (lastSeen < thirtyDaysAgo) {
				decayAmount = 0.3;
			} else if (lastSeen < fourteenDaysAgo) {
				decayAmount = 0.2;
			} else if (lastSeen < sevenDaysAgo) {
				decayAmount = 0.1;
			}
			
			if (decayAmount > 0 && item.active_confidence > 0) {
				const newConfidence = Math.max(0, item.active_confidence - decayAmount);
				
				await db
					.updateTable("menu_items")
					.set({ 
						active_confidence: newConfidence,
						updated_at: now.toISOString(),
					})
					.where("id", "=", item.id)
					.execute();
				
				decayed++;
			}
		}
		
		log("decay_confidences_complete", { 
			totalItems: items.length,
			decayed 
		});
	} catch (err: any) {
		log("decay_confidences_error", { error: err.message }, "error");
		throw err;
	}
}
