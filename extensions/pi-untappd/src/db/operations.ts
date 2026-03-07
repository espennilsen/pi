/**
 * Database operations for pi-untappd.
 *
 * All queries use raw SQL via the event bus query() helper.
 * No direct kysely imports — all DB access through pi-kysely events.
 */

import { query, now } from "./init.ts";

// ── Parameter types ─────────────────────────────────────────────

export interface CreateVenueParams {
	untappdVenueId: string | null;
	slug: string | null;
	name: string;
	url: string;
	city?: string | null;
	country?: string | null;
}

export interface CreateBreweryParams {
	untappdBreweryId: string | null;
	slug: string;
	name: string;
	url: string;
}

export interface CreateBeerParams {
	untappdBeerId: string | null;
	name: string;
	style?: string | null;
	abv?: number | null;
	ibu?: number | null;
	breweryId?: number | null;
	url?: string | null;
}

export interface CreateUserParams {
	username: string;
	displayName?: string | null;
	rssUrl: string;
	url?: string | null;
}

export interface CreateRSSSourceParams {
	type: "venue" | "user" | "brewery";
	foreignId: number;
	rssUrl: string;
	pollIntervalMinutes?: number;
	enabled?: boolean;
}

export interface CreateMenuItemParams {
	venueMenuId: number;
	beerId: number | null;
	displayName: string;
	priceText?: string | null;
	sectionOrder: number;
	activeConfidence?: number;
}

export interface CreateActivityEventParams {
	rssSourceId: number;
	eventType: string;
	untappdCheckinId?: string | null;
	untappdBeerId?: string | null;
	beerId?: number | null;
	venueId?: number | null;
	userId?: number | null;
	userUsername?: string | null;
	beerName: string;
	venueUntappdId?: string | null;
	payloadRaw: string;
	occurredAt: string;
}

// ── Venues ─────────────────────────────────────────────────────

export async function createVenue(params: CreateVenueParams): Promise<number> {
	const ts = now();
	const { insertId } = await query(
		`INSERT INTO untappd_venues
		 (untappd_venue_id, slug, name, url, city, country, created_at, updated_at, last_menu_scraped_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			params.untappdVenueId,
			params.slug,
			params.name,
			params.url,
			params.city || null,
			params.country || null,
			ts,
			ts,
			null,
		],
	);
	return Number(insertId);
}

export async function getVenueById(id: number): Promise<Record<string, unknown> | undefined> {
	const { rows } = await query(
		"SELECT * FROM untappd_venues WHERE id = ?",
		[id],
	);
	return rows[0];
}

export async function getVenueByUntappdId(untappdVenueId: string): Promise<Record<string, unknown> | undefined> {
	const { rows } = await query(
		"SELECT * FROM untappd_venues WHERE untappd_venue_id = ?",
		[untappdVenueId],
	);
	return rows[0];
}

export async function listVenues(): Promise<Record<string, unknown>[]> {
	const { rows } = await query(
		"SELECT * FROM untappd_venues ORDER BY name",
	);
	return rows;
}

export async function updateVenueLastScraped(id: number): Promise<void> {
	const ts = now();
	await query(
		"UPDATE untappd_venues SET last_menu_scraped_at = ?, updated_at = ? WHERE id = ?",
		[ts, ts, id],
	);
}

// ── Breweries ──────────────────────────────────────────────────

export async function createBrewery(params: CreateBreweryParams): Promise<number> {
	const ts = now();
	const { insertId } = await query(
		`INSERT INTO untappd_breweries
		 (untappd_brewery_id, slug, name, url, created_at, updated_at, last_scraped_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			params.untappdBreweryId,
			params.slug,
			params.name,
			params.url,
			ts,
			ts,
			null,
		],
	);
	return Number(insertId);
}

export async function getBreweryById(id: number): Promise<Record<string, unknown> | undefined> {
	const { rows } = await query(
		"SELECT * FROM untappd_breweries WHERE id = ?",
		[id],
	);
	return rows[0];
}

export async function getBreweryBySlug(slug: string): Promise<Record<string, unknown> | undefined> {
	const { rows } = await query(
		"SELECT * FROM untappd_breweries WHERE slug = ?",
		[slug],
	);
	return rows[0];
}

export async function listBreweries(): Promise<Record<string, unknown>[]> {
	const { rows } = await query(
		"SELECT * FROM untappd_breweries ORDER BY name",
	);
	return rows;
}

// ── Beers ──────────────────────────────────────────────────────

export async function createBeer(params: CreateBeerParams): Promise<number> {
	const ts = now();
	const { insertId } = await query(
		`INSERT INTO untappd_beers
		 (untappd_beer_id, name, style, abv, ibu, brewery_id, url, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			params.untappdBeerId,
			params.name,
			params.style || null,
			params.abv ?? null,
			params.ibu ?? null,
			params.breweryId ?? null,
			params.url || null,
			ts,
			ts,
		],
	);
	return Number(insertId);
}

export async function getBeerById(id: number): Promise<Record<string, unknown> | undefined> {
	const { rows } = await query(
		"SELECT * FROM untappd_beers WHERE id = ?",
		[id],
	);
	return rows[0];
}

export async function getBeerByUntappdId(untappdBeerId: string): Promise<Record<string, unknown> | undefined> {
	const { rows } = await query(
		"SELECT * FROM untappd_beers WHERE untappd_beer_id = ?",
		[untappdBeerId],
	);
	return rows[0];
}

export async function listBeers(limit = 100): Promise<Record<string, unknown>[]> {
	const { rows } = await query(
		"SELECT * FROM untappd_beers ORDER BY name LIMIT ?",
		[limit],
	);
	return rows;
}

// ── Users ──────────────────────────────────────────────────────

export async function createUser(params: CreateUserParams): Promise<number> {
	const ts = now();
	const { insertId } = await query(
		`INSERT INTO untappd_users
		 (username, display_name, rss_url, url, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		[
			params.username,
			params.displayName || null,
			params.rssUrl,
			params.url || null,
			ts,
			ts,
		],
	);
	return Number(insertId);
}

export async function getUserById(id: number): Promise<Record<string, unknown> | undefined> {
	const { rows } = await query(
		"SELECT * FROM untappd_users WHERE id = ?",
		[id],
	);
	return rows[0];
}

export async function getUserByUsername(username: string): Promise<Record<string, unknown> | undefined> {
	const { rows } = await query(
		"SELECT * FROM untappd_users WHERE username = ?",
		[username],
	);
	return rows[0];
}

export async function listUsers(): Promise<Record<string, unknown>[]> {
	const { rows } = await query(
		"SELECT * FROM untappd_users ORDER BY username",
	);
	return rows;
}

// ── RSS Sources ────────────────────────────────────────────────

export async function createRSSSource(params: CreateRSSSourceParams): Promise<number> {
	const ts = now();
	const { insertId } = await query(
		`INSERT INTO untappd_rss_sources
		 (type, foreign_id, rss_url, poll_interval_minutes, last_polled_at, enabled, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			params.type,
			params.foreignId,
			params.rssUrl,
			params.pollIntervalMinutes || 15,
			null,
			params.enabled === false ? 0 : 1,
			ts,
			ts,
		],
	);
	return Number(insertId);
}

export async function getRSSSourceById(id: number): Promise<Record<string, unknown> | undefined> {
	const { rows } = await query(
		"SELECT * FROM untappd_rss_sources WHERE id = ?",
		[id],
	);
	return rows[0];
}

export async function listRSSSources(): Promise<Record<string, unknown>[]> {
	const { rows } = await query(
		"SELECT * FROM untappd_rss_sources ORDER BY id",
	);
	return rows;
}

export async function getEnabledRSSSources(): Promise<Record<string, unknown>[]> {
	const { rows } = await query(
		"SELECT * FROM untappd_rss_sources WHERE enabled = 1",
	);
	return rows;
}

export async function updateRSSSourcePolled(id: number): Promise<void> {
	const ts = now();
	await query(
		"UPDATE untappd_rss_sources SET last_polled_at = ?, updated_at = ? WHERE id = ?",
		[ts, ts, id],
	);
}

export async function toggleRSSSource(id: number, enabled: boolean): Promise<void> {
	const ts = now();
	await query(
		"UPDATE untappd_rss_sources SET enabled = ?, updated_at = ? WHERE id = ?",
		[enabled ? 1 : 0, ts, id],
	);
}

// ── Activity Events ────────────────────────────────────────────

export async function createActivityEvent(params: CreateActivityEventParams): Promise<number> {
	const ts = now();
	const { insertId } = await query(
		`INSERT INTO untappd_activity_events
		 (rss_source_id, event_type, untappd_checkin_id, untappd_beer_id, beer_id,
		  venue_id, user_id, user_username, beer_name, venue_untappd_id,
		  payload_raw, occurred_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			params.rssSourceId,
			params.eventType,
			params.untappdCheckinId || null,
			params.untappdBeerId || null,
			params.beerId ?? null,
			params.venueId ?? null,
			params.userId ?? null,
			params.userUsername || null,
			params.beerName,
			params.venueUntappdId || null,
			params.payloadRaw,
			params.occurredAt,
			ts,
		],
	);
	return Number(insertId);
}

export async function getActivityEventByCheckinId(checkinId: string): Promise<Record<string, unknown> | undefined> {
	const { rows } = await query(
		"SELECT * FROM untappd_activity_events WHERE untappd_checkin_id = ?",
		[checkinId],
	);
	return rows[0];
}

export async function listActivityEvents(limit = 50): Promise<Record<string, unknown>[]> {
	const { rows } = await query(
		"SELECT * FROM untappd_activity_events ORDER BY occurred_at DESC LIMIT ?",
		[limit],
	);
	return rows;
}

export async function listActivityEventsByVenue(venueId: number, limit = 50): Promise<Record<string, unknown>[]> {
	const { rows } = await query(
		"SELECT * FROM untappd_activity_events WHERE venue_id = ? ORDER BY occurred_at DESC LIMIT ?",
		[venueId, limit],
	);
	return rows;
}

export async function listActivityEventsBySource(rssSourceId: number, limit = 50): Promise<Record<string, unknown>[]> {
	const { rows } = await query(
		"SELECT * FROM untappd_activity_events WHERE rss_source_id = ? ORDER BY occurred_at DESC LIMIT ?",
		[rssSourceId, limit],
	);
	return rows;
}

// ── Venue Menus ────────────────────────────────────────────────

export async function createVenueMenu(venueId: number, name: string, sourceTag: string | null): Promise<number> {
	const ts = now();
	const { insertId } = await query(
		`INSERT INTO untappd_venue_menus
		 (venue_id, name, source_tag, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)`,
		[venueId, name, sourceTag, ts, ts],
	);
	return Number(insertId);
}

export async function getVenueMenusByVenueId(venueId: number): Promise<Record<string, unknown>[]> {
	const { rows } = await query(
		"SELECT * FROM untappd_venue_menus WHERE venue_id = ?",
		[venueId],
	);
	return rows;
}

// ── Menu Items ─────────────────────────────────────────────────

export async function createMenuItem(params: CreateMenuItemParams): Promise<number> {
	const ts = now();
	const { insertId } = await query(
		`INSERT INTO untappd_menu_items
		 (venue_menu_id, beer_id, display_name, price_text, section_order,
		  active_confidence, last_seen_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			params.venueMenuId,
			params.beerId,
			params.displayName,
			params.priceText || null,
			params.sectionOrder,
			params.activeConfidence ?? 1.0,
			ts,
			ts,
			ts,
		],
	);
	return Number(insertId);
}

export async function getMenuItemsByMenuId(venueMenuId: number): Promise<Record<string, unknown>[]> {
	const { rows } = await query(
		"SELECT * FROM untappd_menu_items WHERE venue_menu_id = ? ORDER BY section_order",
		[venueMenuId],
	);
	return rows;
}

export async function updateMenuItemLastSeen(id: number): Promise<void> {
	const ts = now();
	await query(
		"UPDATE untappd_menu_items SET last_seen_at = ?, active_confidence = 1.0, updated_at = ? WHERE id = ?",
		[ts, ts, id],
	);
}

/**
 * Fetch all menu items for decay processing.
 * Expected scale: hundreds to low thousands (personal venue tracking).
 */
export async function getAllMenuItems(): Promise<Record<string, unknown>[]> {
	const { rows } = await query(
		"SELECT * FROM untappd_menu_items",
	);
	return rows;
}

export async function updateMenuItemConfidence(id: number, newConfidence: number): Promise<void> {
	const ts = now();
	await query(
		"UPDATE untappd_menu_items SET active_confidence = ?, updated_at = ? WHERE id = ?",
		[newConfidence, ts, id],
	);
}
