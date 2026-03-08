/**
 * RSS polling logic.
 *
 * All DB access via operations module (event bus, no direct kysely).
 */

import { createHash } from "node:crypto";
import type { LogFn } from "../logger.ts";
import { fetchRSS, parseCheckinFromRSS } from "./client.ts";
import * as ops from "../db/operations.ts";

/**
 * Poll all enabled RSS sources that are due for polling.
 */
export async function pollRSSSources(log: LogFn): Promise<void> {
	try {
		const sources = await ops.getEnabledRSSSources();
		const now = new Date();

		for (const source of sources) {
			// Check if poll is due
			if (source.last_polled_at) {
				const lastPoll = new Date(source.last_polled_at as string);
				const minutesSince = (now.getTime() - lastPoll.getTime()) / (1000 * 60);

				if (minutesSince < (source.poll_interval_minutes as number)) {
					continue; // Not due yet
				}
			}

			try {
				await pollRSSSource(source, log);
			} catch (err: any) {
				log("poll_rss_source_error", {
					sourceId: source.id,
					type: source.type,
					error: err.message,
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
export async function pollRSSSource(
	source: Record<string, unknown>,
	log: LogFn,
): Promise<void> {
	log("poll_rss_source", {
		sourceId: source.id,
		type: source.type,
		url: source.rss_url,
	});

	try {
		// Fetch RSS feed
		const feed = await fetchRSS(source.rss_url as string, log);

		// Process each item
		let newEvents = 0;
		for (const item of feed.items) {
			try {
				const parsed = parseCheckinFromRSS(item);

				// Deduplicate: use checkin ID from link, or fall back to a hash.
				// Skip items that produce no stable identity at all.
				const checkinId = item.link ? extractCheckinId(item.link) : null;
				const dedupKey = checkinId
					?? hashDedupKey(item.link, item.pubDate, item.title);

				if (!dedupKey) {
					log("skip_unidentifiable_item", { link: item.link }, "warn");
					continue;
				}

				const existing = await ops.getActivityEventByCheckinId(dedupKey);
				if (existing) {
					continue;
				}

				// Normalize beer if we have a beer ID.
				// Uses try/catch to handle UNIQUE constraint violations from
				// concurrent polls racing on the same new beer (TOCTOU).
				let beerId: number | null = null;
				if (parsed.beerId) {
					const beer = await ops.getBeerByUntappdId(parsed.beerId);
					if (!beer && parsed.beerName) {
						try {
							beerId = await ops.createBeer({
								untappdBeerId: parsed.beerId,
								name: parsed.beerName,
							});
						} catch {
							// UNIQUE constraint violation — another poller inserted first.
							// Look up the row they created.
							const existing = await ops.getBeerByUntappdId(parsed.beerId);
							beerId = existing ? (existing.id as number) : null;
						}
					} else if (beer) {
						beerId = beer.id as number;
					}
				}

				// Get venue ID if available
				let venueId: number | null = null;
				if (parsed.venueId) {
					const venue = await ops.getVenueByUntappdId(parsed.venueId);
					if (venue) {
						venueId = venue.id as number;
					}
				}

				// Get user ID if available
				let userId: number | null = null;
				if (parsed.username) {
					const user = await ops.getUserByUsername(parsed.username);
					if (user) {
						userId = user.id as number;
					}
				}

				// Create activity event.
				// Uses try/catch to handle UNIQUE constraint violations from
				// concurrent polls racing on the same checkin (TOCTOU).
				try {
					await ops.createActivityEvent({
						rssSourceId: source.id as number,
						eventType: "checkin",
						untappdCheckinId: dedupKey,
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
				} catch {
					// UNIQUE constraint violation — another poller inserted first.
					// Safe to ignore; the event already exists.
				}

				// Update menu item last_seen_at if beer is at venue
				if (beerId && venueId) {
					await updateMenuItemsForBeer(venueId, beerId);
				}
			} catch (err: any) {
				log("process_rss_item_error", {
					sourceId: source.id,
					itemLink: item.link,
					error: err.message,
				}, "error");
			}
		}

		log("poll_rss_source_complete", {
			sourceId: source.id,
			itemsProcessed: feed.items.length,
			newEvents,
		});
	} catch (err: any) {
		log("poll_rss_source_error", {
			sourceId: source.id,
			error: err.message,
		}, "error");
		throw err;
	} finally {
		// Always update last polled time — even on failure — so broken feeds
		// respect their poll interval instead of retrying in a tight loop.
		await ops.updateRSSSourcePolled(source.id as number);
	}
}

/**
 * Update menu items when a beer is seen at a venue.
 */
async function updateMenuItemsForBeer(
	venueId: number,
	beerId: number,
): Promise<void> {
	const menus = await ops.getVenueMenusByVenueId(venueId);

	for (const menu of menus) {
		const items = await ops.getMenuItemsByMenuId(menu.id as number);

		for (const item of items) {
			if (item.beer_id === beerId) {
				await ops.updateMenuItemLastSeen(item.id as number);
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

/**
 * Generate a stable dedup key from RSS item fields when no checkin ID is available.
 * Returns null only if all inputs are falsy (shouldn't happen in practice).
 */
function hashDedupKey(
	link: string | null | undefined,
	pubDate: string | null | undefined,
	title: string | null | undefined,
): string | null {
	const input = `${link ?? ""}|${pubDate ?? ""}|${title ?? ""}`;
	if (input === "||") return null;
	return `hash:${createHash("sha256").update(input).digest("hex").slice(0, 16)}`;
}
