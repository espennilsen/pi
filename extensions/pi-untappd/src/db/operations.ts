/**
 * Database operations for pi-untappd.
 */

import type { Kysely } from "kysely";
import type { UntappdDatabase } from "../schema.ts";

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

/**
 * Get database instance from pi-kysely.
 */
export function getDb(): Kysely<UntappdDatabase> {
	// This will be replaced with proper kysely registry access
	throw new Error("Database not initialized. Ensure pi-kysely is loaded.");
}

// ── Venues ─────────────────────────────────────────────────────

export async function createVenue(db: Kysely<UntappdDatabase>, params: CreateVenueParams) {
	const now = new Date().toISOString();
	const result = await db
		.insertInto("venues")
		.values({
			untappd_venue_id: params.untappdVenueId,
			slug: params.slug,
			name: params.name,
			url: params.url,
			city: params.city || null,
			country: params.country || null,
			created_at: now,
			updated_at: now,
			last_menu_scraped_at: null,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	
	return result.id;
}

export async function getVenueById(db: Kysely<UntappdDatabase>, id: number) {
	return db.selectFrom("venues").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function getVenueByUntappdId(db: Kysely<UntappdDatabase>, untappdVenueId: string) {
	return db.selectFrom("venues").selectAll().where("untappd_venue_id", "=", untappdVenueId).executeTakeFirst();
}

export async function listVenues(db: Kysely<UntappdDatabase>) {
	return db.selectFrom("venues").selectAll().orderBy("name").execute();
}

export async function updateVenueLastScraped(db: Kysely<UntappdDatabase>, id: number) {
	const now = new Date().toISOString();
	await db
		.updateTable("venues")
		.set({ last_menu_scraped_at: now, updated_at: now })
		.where("id", "=", id)
		.execute();
}

// ── Breweries ──────────────────────────────────────────────────

export async function createBrewery(db: Kysely<UntappdDatabase>, params: CreateBreweryParams) {
	const now = new Date().toISOString();
	const result = await db
		.insertInto("breweries")
		.values({
			untappd_brewery_id: params.untappdBreweryId,
			slug: params.slug,
			name: params.name,
			url: params.url,
			created_at: now,
			updated_at: now,
			last_scraped_at: null,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	
	return result.id;
}

export async function getBreweryById(db: Kysely<UntappdDatabase>, id: number) {
	return db.selectFrom("breweries").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function getBreweryBySlug(db: Kysely<UntappdDatabase>, slug: string) {
	return db.selectFrom("breweries").selectAll().where("slug", "=", slug).executeTakeFirst();
}

export async function listBreweries(db: Kysely<UntappdDatabase>) {
	return db.selectFrom("breweries").selectAll().orderBy("name").execute();
}

// ── Beers ──────────────────────────────────────────────────────

export async function createBeer(db: Kysely<UntappdDatabase>, params: CreateBeerParams) {
	const now = new Date().toISOString();
	const result = await db
		.insertInto("beers")
		.values({
			untappd_beer_id: params.untappdBeerId,
			name: params.name,
			style: params.style || null,
			abv: params.abv || null,
			ibu: params.ibu || null,
			brewery_id: params.breweryId || null,
			url: params.url || null,
			created_at: now,
			updated_at: now,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	
	return result.id;
}

export async function getBeerById(db: Kysely<UntappdDatabase>, id: number) {
	return db.selectFrom("beers").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function getBeerByUntappdId(db: Kysely<UntappdDatabase>, untappdBeerId: string) {
	return db.selectFrom("beers").selectAll().where("untappd_beer_id", "=", untappdBeerId).executeTakeFirst();
}

export async function listBeers(db: Kysely<UntappdDatabase>, limit = 100) {
	return db.selectFrom("beers").selectAll().orderBy("name").limit(limit).execute();
}

// ── Users ──────────────────────────────────────────────────────

export async function createUser(db: Kysely<UntappdDatabase>, params: CreateUserParams) {
	const now = new Date().toISOString();
	const result = await db
		.insertInto("users")
		.values({
			username: params.username,
			display_name: params.displayName || null,
			rss_url: params.rssUrl,
			url: params.url || null,
			created_at: now,
			updated_at: now,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	
	return result.id;
}

export async function getUserById(db: Kysely<UntappdDatabase>, id: number) {
	return db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function getUserByUsername(db: Kysely<UntappdDatabase>, username: string) {
	return db.selectFrom("users").selectAll().where("username", "=", username).executeTakeFirst();
}

export async function listUsers(db: Kysely<UntappdDatabase>) {
	return db.selectFrom("users").selectAll().orderBy("username").execute();
}

// ── RSS Sources ────────────────────────────────────────────────

export async function createRSSSource(db: Kysely<UntappdDatabase>, params: CreateRSSSourceParams) {
	const now = new Date().toISOString();
	const result = await db
		.insertInto("rss_sources")
		.values({
			type: params.type,
			foreign_id: params.foreignId,
			rss_url: params.rssUrl,
			poll_interval_minutes: params.pollIntervalMinutes || 15,
			last_polled_at: null,
			enabled: params.enabled === false ? 0 : 1,
			created_at: now,
			updated_at: now,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	
	return result.id;
}

export async function getRSSSourceById(db: Kysely<UntappdDatabase>, id: number) {
	return db.selectFrom("rss_sources").selectAll().where("id", "=", id).executeTakeFirst();
}

export async function listRSSSources(db: Kysely<UntappdDatabase>) {
	return db.selectFrom("rss_sources").selectAll().orderBy("id").execute();
}

export async function getEnabledRSSSources(db: Kysely<UntappdDatabase>) {
	return db.selectFrom("rss_sources").selectAll().where("enabled", "=", 1).execute();
}

export async function updateRSSSourcePolled(db: Kysely<UntappdDatabase>, id: number) {
	const now = new Date().toISOString();
	await db
		.updateTable("rss_sources")
		.set({ last_polled_at: now, updated_at: now })
		.where("id", "=", id)
		.execute();
}

export async function toggleRSSSource(db: Kysely<UntappdDatabase>, id: number, enabled: boolean) {
	const now = new Date().toISOString();
	await db
		.updateTable("rss_sources")
		.set({ enabled: enabled ? 1 : 0, updated_at: now })
		.where("id", "=", id)
		.execute();
}

// ── Activity Events ────────────────────────────────────────────

export async function createActivityEvent(db: Kysely<UntappdDatabase>, params: CreateActivityEventParams) {
	const now = new Date().toISOString();
	const result = await db
		.insertInto("activity_events")
		.values({
			rss_source_id: params.rssSourceId,
			event_type: params.eventType,
			untappd_checkin_id: params.untappdCheckinId || null,
			untappd_beer_id: params.untappdBeerId || null,
			beer_id: params.beerId || null,
			venue_id: params.venueId || null,
			user_id: params.userId || null,
			user_username: params.userUsername || null,
			beer_name: params.beerName,
			venue_untappd_id: params.venueUntappdId || null,
			payload_raw: params.payloadRaw,
			occurred_at: params.occurredAt,
			created_at: now,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	
	return result.id;
}

export async function getActivityEventByCheckinId(db: Kysely<UntappdDatabase>, checkinId: string) {
	return db.selectFrom("activity_events").selectAll().where("untappd_checkin_id", "=", checkinId).executeTakeFirst();
}

export async function listActivityEvents(db: Kysely<UntappdDatabase>, limit = 50) {
	return db.selectFrom("activity_events").selectAll().orderBy("occurred_at", "desc").limit(limit).execute();
}

export async function listActivityEventsBySource(db: Kysely<UntappdDatabase>, rssSourceId: number, limit = 50) {
	return db
		.selectFrom("activity_events")
		.selectAll()
		.where("rss_source_id", "=", rssSourceId)
		.orderBy("occurred_at", "desc")
		.limit(limit)
		.execute();
}

// ── Venue Menus ────────────────────────────────────────────────

export async function createVenueMenu(db: Kysely<UntappdDatabase>, venueId: number, name: string, sourceTag: string | null) {
	const now = new Date().toISOString();
	const result = await db
		.insertInto("venue_menus")
		.values({
			venue_id: venueId,
			name,
			source_tag: sourceTag,
			created_at: now,
			updated_at: now,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	
	return result.id;
}

export async function getVenueMenusByVenueId(db: Kysely<UntappdDatabase>, venueId: number) {
	return db.selectFrom("venue_menus").selectAll().where("venue_id", "=", venueId).execute();
}

// ── Menu Items ─────────────────────────────────────────────────

export async function createMenuItem(db: Kysely<UntappdDatabase>, params: CreateMenuItemParams) {
	const now = new Date().toISOString();
	const result = await db
		.insertInto("menu_items")
		.values({
			venue_menu_id: params.venueMenuId,
			beer_id: params.beerId,
			display_name: params.displayName,
			price_text: params.priceText || null,
			section_order: params.sectionOrder,
			active_confidence: params.activeConfidence || 1.0,
			last_seen_at: now,
			created_at: now,
			updated_at: now,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	
	return result.id;
}

export async function getMenuItemsByMenuId(db: Kysely<UntappdDatabase>, venueMenuId: number) {
	return db
		.selectFrom("menu_items")
		.selectAll()
		.where("venue_menu_id", "=", venueMenuId)
		.orderBy("section_order")
		.execute();
}

export async function updateMenuItemLastSeen(db: Kysely<UntappdDatabase>, id: number) {
	const now = new Date().toISOString();
	await db
		.updateTable("menu_items")
		.set({ last_seen_at: now, active_confidence: 1.0, updated_at: now })
		.where("id", "=", id)
		.execute();
}

export async function decayMenuItemConfidence(db: Kysely<UntappdDatabase>, id: number, decayAmount: number) {
	const now = new Date().toISOString();
	await db
		.updateTable("menu_items")
		.set((eb) => ({
			active_confidence: eb("active_confidence", "-", decayAmount),
			updated_at: now,
		}))
		.where("id", "=", id)
		.execute();
}
