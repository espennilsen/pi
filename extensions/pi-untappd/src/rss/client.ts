/**
 * RSS client for fetching and parsing Untappd RSS feeds.
 */

import Parser from "rss-parser";
import type { LogFn } from "../logger.ts";

export interface RSSItem {
	title: string | null;
	link: string | null;
	pubDate: string | null;
	description: string | null;
	content: string | null;
}

export interface RSSFeed {
	title: string | null;
	link: string | null;
	description: string | null;
	items: RSSItem[];
}

const parser = new Parser({
	timeout: 10000,
	headers: {
		"User-Agent": "pi-untappd/0.1.0",
	},
});

/**
 * Fetch and parse an RSS feed.
 */
export async function fetchRSS(url: string, log: LogFn): Promise<RSSFeed> {
	try {
		log("fetch_rss", { url });
		
		const feed = await parser.parseURL(url);
		
		return {
			title: feed.title || null,
			link: feed.link || null,
			description: feed.description || null,
			items: (feed.items || []).map(item => ({
				title: item.title || null,
				link: item.link || null,
				pubDate: item.pubDate || item.isoDate || null,
				description: item.contentSnippet || item.description || null,
				content: item.content || item.description || null,
			})),
		};
	} catch (err: any) {
		log("fetch_rss_error", { url, error: err.message }, "error");
		throw new Error(`Failed to fetch RSS: ${err.message}`);
	}
}

/**
 * Extract beer information from RSS item.
 * Parses title and link to extract beer name, beer ID, venue ID.
 */
export function parseCheckinFromRSS(item: RSSItem): {
	username: string | null;
	beerName: string | null;
	beerId: string | null;
	venueId: string | null;
	occurredAt: string | null;
} {
	// Example title: "John Doe is drinking a Pale Ale by Brewery Name"
	// Example link: https://untappd.com/user/johndoe/checkin/123456
	
	const username = extractUsernameFromLink(item.link);
	const beerName = extractBeerNameFromTitle(item.title);
	const beerId = extractBeerIdFromDescription(item.description || item.content);
	const venueId = extractVenueIdFromDescription(item.description || item.content);
	
	return {
		username,
		beerName,
		beerId,
		venueId,
		occurredAt: item.pubDate,
	};
}

function extractUsernameFromLink(link: string | null): string | null {
	if (!link) return null;
	const match = link.match(/untappd\.com\/user\/([^\/]+)/);
	return match ? match[1] : null;
}

function extractBeerNameFromTitle(title: string | null): string | null {
	if (!title) return null;
	// Example: "John Doe is drinking a Pale Ale by Brewery"
	const match = title.match(/is drinking (?:a |an )?(.+?)(?: by | at |$)/i);
	return match ? match[1].trim() : null;
}

function extractBeerIdFromDescription(content: string | null): string | null {
	if (!content) return null;
	const match = content.match(/untappd\.com\/b\/[^\/]+\/(\d+)/);
	return match ? match[1] : null;
}

function extractVenueIdFromDescription(content: string | null): string | null {
	if (!content) return null;
	const match = content.match(/untappd\.com\/v\/[^\/]+\/(\d+)/);
	return match ? match[1] : null;
}
