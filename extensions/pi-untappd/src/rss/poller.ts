/**
 * RSS polling logic.
 */

import type { LogFn } from "../logger.ts";
import { fetchRSS, parseCheckinFromRSS } from "./client.ts";
import type { Kysely } from "kysely";
import type { UntappdDatabase } from "../schema.ts";

// Dynamic import to get database access
async function getDatabase(): Promise<Kysely<UntappdDatabase>> {
	// Access the database through pi-kysely registry
	// This is a placeholder - in real implementation, import from registry
	throw new Error("Database access not implemented");
}

/**
 * Poll all enabled RSS sources that are due for polling.
 */
export async function pollRSSSources(log: LogFn): Promise<void> {
	try {
		const db = await getDatabase();
		
		// Import database operations
		const ops = await import("../db/operations.ts");
		
		// Get all enabled RSS sources
		const sources = await ops.getEnabledRSSSources(db);
		
		const now = new Date();
		
		for (const source of sources) {
			// Check if poll is due
			if (source.last_polled_at) {
				const lastPoll = new Date(source.last_polled_at);
				const minutesSince = (now.getTime() - lastPoll.getTime()) / (1000 * 60);
				
				if (minutesSince < source.poll_interval_minutes) {
					continue; // Not due yet
				}
			}
			
			try {
				await pollRSSSource(db, source, log);
			} catch (err: any) {
				log("poll_rss_source_error", { 
					sourceId: source.id, 
					type: source.type, 
					error: err.message 
				}, "error");
			}
		}
	} catch (err: any) {
		log("poll_rss_sources_error", { error: err.message }, "error");
		throw err;
	}
}

/**
 * Poll a single RSS source.
 */
async function pollRSSSource(
	db: Kysely<UntappdDatabase>, 
	source: any, 
	log: LogFn
): Promise<void> {
	log("poll_rss_source", { sourceId: source.id, type: source.type, url: source.rss_url });
	
	const ops = await import("../db/operations.ts");
	
	try {
		// Fetch RSS feed
		const feed = await fetchRSS(source.rss_url, log);
		
		// Process each item
		let newEvents = 0;
		for (const item of feed.items) {
			try {
				const parsed = parseCheckinFromRSS(item);
				
				// Skip if we already have this check-in
				if (item.link) {
					const checkinId = extractCheckinId(item.link);
					if (checkinId) {
						const existing = await ops.getActivityEventByCheckinId(db, checkinId);
						if (existing) {
							continue;
						}
					}
				}
				
				// Normalize beer if we have a beer ID
				let beerId: number | null = null;
				if (parsed.beerId) {
					const beer = await ops.getBeerByUntappdId(db, parsed.beerId);
					if (!beer && parsed.beerName) {
						// Create new beer
						beerId = await ops.createBeer(db, {
							untappdBeerId: parsed.beerId,
							name: parsed.beerName,
						});
					} else if (beer) {
						beerId = beer.id;
					}
				}
				
				// Get venue ID if available
				let venueId: number | null = null;
				if (parsed.venueId) {
					const venue = await ops.getVenueByUntappdId(db, parsed.venueId);
					if (venue) {
						venueId = venue.id;
					}
				}
				
				// Get user ID if available
				let userId: number | null = null;
				if (parsed.username) {
					const user = await ops.getUserByUsername(db, parsed.username);
					if (user) {
						userId = user.id;
					}
				}
				
				// Create activity event
				await ops.createActivityEvent(db, {
					rssSourceId: source.id,
					eventType: "checkin",
					untappdCheckinId: extractCheckinId(item.link),
					untappdBeerId: parsed.beerId,
					beerId,
					venueId,
					userId,
					userUsername: parsed.username,
					beerName: parsed.beerName || item.title || "Unknown Beer",
					venueUntappdId: parsed.venueId,
					payloadRaw: JSON.stringify(item),
					occurredAt: parsed.occurredAt || new Date().toISOString(),
				});
				
				newEvents++;
				
				// Update menu item last_seen_at if beer is at venue
				if (beerId && venueId) {
					await updateMenuItemsForBeer(db, venueId, beerId, log);
				}
			} catch (err: any) {
				log("process_rss_item_error", { 
					sourceId: source.id, 
					itemLink: item.link,
					error: err.message 
				}, "error");
			}
		}
		
		// Update last polled time
		await ops.updateRSSSourcePolled(db, source.id);
		
		log("poll_rss_source_complete", { 
			sourceId: source.id, 
			itemsProcessed: feed.items.length,
			newEvents 
		});
	} catch (err: any) {
		log("poll_rss_source_error", { 
			sourceId: source.id, 
			error: err.message 
		}, "error");
		throw err;
	}
}

/**
 * Update menu items when a beer is seen at a venue.
 */
async function updateMenuItemsForBeer(
	db: Kysely<UntappdDatabase>,
	venueId: number,
	beerId: number,
	log: LogFn
): Promise<void> {
	const ops = await import("../db/operations.ts");
	
	// Get all menus for this venue
	const menus = await ops.getVenueMenusByVenueId(db, venueId);
	
	for (const menu of menus) {
		// Get menu items for this beer
		const items = await ops.getMenuItemsByMenuId(db, menu.id);
		
		for (const item of items) {
			if (item.beer_id === beerId) {
				// Update last seen and boost confidence
				await ops.updateMenuItemLastSeen(db, item.id);
			}
		}
	}
}

/**
 * Extract check-in ID from Untappd URL.
 */
function extractCheckinId(url: string | null): string | null {
	if (!url) return null;
	const match = url.match(/\/checkin\/(\d+)/);
	return match ? match[1] : null;
}
