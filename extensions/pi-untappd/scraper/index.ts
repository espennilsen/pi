/**
 * HTML scraper for Untappd pages.
 *
 * Scrapes venues, breweries, and users (manual only, no automated scraping).
 * Conservative approach to respect Untappd's ToS.
 */

import type { LogFn } from "../logger.ts";

export interface VenueScrapedData {
	venueId: string | null;
	slug: string | null;
	name: string;
	city: string | null;
	country: string | null;
	menus: Array<{
		name: string;
		sourceTag: string | null;
		items: Array<{
			displayName: string;
			beerUrl: string | null;
			untappdBeerId: string | null;
			style: string | null;
			abv: number | null;
			priceText: string | null;
			sectionOrder: number;
		}>;
	}>;
}

export interface BreweryScrapedData {
	breweryId: string | null;
	slug: string;
	name: string;
	url: string;
	beers?: Array<{
		untappdBeerId: string | null;
		name: string;
		style: string | null;
		abv: number | null;
		ibu: number | null;
	}>;
}

export interface BeerScrapedData {
	untappdBeerId: string | null;
	name: string;
	style: string | null;
	abv: number | null;
	ibu: number | null;
	brewerySlug: string | null;
	breweryName: string | null;
}

export interface UserScrapedData {
	username: string;
	displayName: string | null;
}

/**
 * Parse venue ID and slug from URL.
 * Example: https://untappd.com/v/hopyard/3377680
 */
export function parseVenueUrl(url: string): { venueId: string | null; slug: string | null } {
	const match = url.match(/untappd\.com\/v\/([^\/]+)\/(\d+)/);
	if (match) {
		return { slug: match[1], venueId: match[2] };
	}
	return { venueId: null, slug: null };
}

/**
 * Parse brewery slug from URL.
 * Example: https://untappd.com/w/hopyard/123456
 */
export function parseBreweryUrl(url: string): { breweryId: string | null; slug: string | null } {
	const match = url.match(/untappd\.com\/w\/([^\/]+)\/(\d+)/);
	if (match) {
		return { slug: match[1], breweryId: match[2] };
	}
	return { breweryId: null, slug: null };
}

/**
 * Parse beer ID from URL.
 * Example: https://untappd.com/b/beer-name/123456
 */
export function parseBeerUrl(url: string): { beerId: string | null } {
	const match = url.match(/untappd\.com\/b\/[^\/]+\/(\d+)/);
	if (match) {
		return { beerId: match[1] };
	}
	return { beerId: null };
}

/**
 * Parse username from URL.
 * Example: https://untappd.com/user/espennilsen
 */
export function parseUserUrl(url: string): { username: string | null } {
	const match = url.match(/untappd\.com\/user\/([^\/\?]+)/);
	if (match) {
		return { username: match[1] };
	}
	return { username: null };
}

/**
 * Scrape venue HTML page.
 *
 * ⚠️ STUB: Returns synthetic placeholder data — no HTTP request is made.
 * Venues created via the API will have generated names (e.g. "Venue 123")
 * and empty menus until real scraping is implemented.
 *
 * TODO: Implement actual scraping:
 * 1. Fetch HTML with proper User-Agent
 * 2. Parse with cheerio or similar
 * 3. Extract venue metadata and menu sections
 * 4. Handle errors gracefully
 */
export async function scrapeVenue(url: string, log: LogFn): Promise<VenueScrapedData> {
	const { venueId, slug } = parseVenueUrl(url);

	log("scrape_venue", { url, venueId, slug });

	// Placeholder: In real implementation, fetch and parse HTML
	// For now, return minimal data structure

	return {
		venueId,
		slug,
		name: `Venue ${venueId || slug || "Unknown"}`,
		city: null,
		country: null,
		menus: [],
	};
}

/**
 * Scrape brewery HTML page.
 */
export async function scrapeBrewery(url: string, log: LogFn): Promise<BreweryScrapedData> {
	const { breweryId, slug } = parseBreweryUrl(url);

	log("scrape_brewery", { url, breweryId, slug });

	// Placeholder implementation
	return {
		breweryId,
		slug: slug || "unknown",
		name: `Brewery ${breweryId || slug || "Unknown"}`,
		url,
		beers: [],
	};
}

/**
 * Scrape beer HTML page.
 */
export async function scrapeBeer(url: string, log: LogFn): Promise<BeerScrapedData> {
	const { beerId } = parseBeerUrl(url);

	log("scrape_beer", { url, beerId });

	// Placeholder implementation
	return {
		untappdBeerId: beerId,
		name: `Beer ${beerId || "Unknown"}`,
		style: null,
		abv: null,
		ibu: null,
		brewerySlug: null,
		breweryName: null,
	};
}

/**
 * Scrape user HTML page.
 */
export async function scrapeUser(url: string, log: LogFn): Promise<UserScrapedData> {
	const { username } = parseUserUrl(url);

	log("scrape_user", { url, username });

	// Placeholder implementation
	return {
		username: username || "unknown",
		displayName: null,
	};
}
