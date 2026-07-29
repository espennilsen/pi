/**
 * JSON API endpoints for pi-untappd.
 *
 * All routes are under /api/untappd/
 * All DB access via operations module (event bus, no direct kysely).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { LogFn } from "../logger.ts";
import * as ops from "../db/operations.ts";

/** Validate that an RSS URL points to an untappd.com /rss/ feed to prevent SSRF. */
function isAllowedRSSUrl(rssUrl: string): boolean {
	try {
		const parsed = new URL(rssUrl);
		return parsed.protocol === "https:" &&
			(parsed.hostname === "untappd.com" || parsed.hostname.endsWith(".untappd.com")) &&
			parsed.pathname.startsWith("/rss/");
	} catch {
		return false;
	}
}

/** Validate that a venue or brewery URL is a genuine Untappd HTTPS link. */
function isAllowedUntappdUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" &&
			(parsed.hostname === "untappd.com" || parsed.hostname.endsWith(".untappd.com"));
	} catch {
		return false;
	}
}

interface APIResponse {
	ok: boolean;
	data?: unknown;
	error?: string;
	warning?: string;
}

export async function handleAPIRequest(
	req: IncomingMessage,
	res: ServerResponse,
	path: string,
	log: LogFn,
): Promise<void> {
	const method = req.method || "GET";
	const parsedUrl = new URL(path, "http://localhost");
	const pathname = parsedUrl.pathname || "/";

	log("api_request", { method, path: pathname });

	// Helper to send JSON response
	const sendJSON = (status: number, data: APIResponse) => {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(data));
	};

	// Parse JSON body for POST/PUT/PATCH (max 1 MB)
	const MAX_BODY = 1_048_576;
	const getBody = (): Promise<Record<string, unknown>> => {
		return new Promise((resolve, reject) => {
			if (method === "GET" || method === "HEAD") {
				resolve({});
				return;
			}

			const chunks: Buffer[] = [];
			let totalLength = 0;
			let rejected = false;
			req.on("data", (chunk: Buffer) => {
				totalLength += chunk.length;
				if (totalLength > MAX_BODY) {
					rejected = true;
					req.resume(); // drain remaining data without buffering
					reject(new Error("Payload too large"));
					return;
				}
				chunks.push(chunk);
			});
			req.on("end", () => {
				if (rejected) return;
				try {
					const body = Buffer.concat(chunks).toString("utf8");
					resolve(body ? JSON.parse(body) : {});
				} catch {
					reject(new Error("Invalid JSON"));
				}
			});
			req.on("error", reject);
		});
	};

	try {
		// ── Venues ──────────────────────────────────────────

		// GET /venues
		if (pathname === "/venues" && method === "GET") {
			const venues = await ops.listVenues();
			return sendJSON(200, { ok: true, data: venues });
		}

		// POST /venues
		if (pathname === "/venues" && method === "POST") {
			const body = await getBody();
			const venueUrl = body.url as string;

			if (!venueUrl) {
				return sendJSON(400, { ok: false, error: "url is required" });
			}

			if (!isAllowedUntappdUrl(venueUrl)) {
				return sendJSON(400, { ok: false, error: "URL must be an https://untappd.com link" });
			}

			const scraper = await import("../scraper/index.ts");
			const { venueId, slug } = scraper.parseVenueUrl(venueUrl);

			if (!venueId && !slug) {
				return sendJSON(400, { ok: false, error: "Invalid Untappd venue URL" });
			}

			// Check if venue already exists
			if (venueId) {
				const existing = await ops.getVenueByUntappdId(venueId);
				if (existing) {
					// Ensure RSS source exists (may be missing if previous create was interrupted)
					const existingRss = await ops.getRSSSourceByTypeAndForeignId("venue", existing.id as number);
					if (!existingRss) {
						const rssUrl = `https://untappd.com/rss/venue/${venueId}`;
						await ops.createRSSSource({
							type: "venue",
							foreignId: existing.id as number,
							rssUrl,
							pollIntervalMinutes: 15,
						});
					}
					return sendJSON(200, { ok: true, data: existing });
				}
			}

			// Create venue — try/catch handles UNIQUE constraint race
			// (concurrent request may have inserted between the check above and here)
			let id: number;
			try {
				id = await ops.createVenue({
					untappdVenueId: venueId,
					slug,
					name: (body.name as string) || `Venue ${venueId || slug}`,
					url: venueUrl,
				});
			} catch {
				// UNIQUE constraint violation — return the row the other request created
				const raced = venueId
					? await ops.getVenueByUntappdId(venueId)
					: undefined;
				if (raced) return sendJSON(200, { ok: true, data: raced });
				throw new Error("Failed to create venue");
			}

			// Create RSS source (only if we have a numeric venue ID for the RSS URL)
			if (venueId) {
				const rssUrl = `https://untappd.com/rss/venue/${venueId}`;
				await ops.createRSSSource({
					type: "venue",
					foreignId: id,
					rssUrl,
					pollIntervalMinutes: 15,
				});
			}

			const venue = await ops.getVenueById(id);
			const response: APIResponse = { ok: true, data: venue };
			if (!venueId) {
				response.warning = "Venue created from slug-only URL — RSS polling requires a numeric Untappd venue ID. This venue will not be automatically monitored.";
			}
			return sendJSON(201, response);
		}

		// POST /venues/:id/scrape
		if (pathname.match(/^\/venues\/\d+\/scrape$/) && method === "POST") {
			return sendJSON(501, { ok: false, error: "Venue scraping is not yet implemented" });
		}

		// GET /venues/:id/menus
		if (pathname.match(/^\/venues\/\d+\/menus$/) && method === "GET") {
			const id = parseInt(pathname.split("/")[2]);

			const menus = await ops.getVenueMenusByVenueId(id);

			// Fetch all items for all menus, then batch-load beers
			const menuItemPairs = await Promise.all(
				menus.map(async (menu) => ({
					menu,
					items: await ops.getMenuItemsByMenuId(menu.id as number),
				})),
			);

			// Collect unique beer IDs across all menus
			const beerIds = [
				...new Set(
					menuItemPairs
						.flatMap(({ items }) => items)
						.map((item) => item.beer_id as number | null)
						.filter((id): id is number => id != null),
				),
			];

			// Single query for all beers
			const beers = beerIds.length > 0 ? await ops.getBeersByIds(beerIds) : [];
			const beerMap = new Map(beers.map((b) => [b.id as number, b]));

			const menusWithItems = menuItemPairs.map(({ menu, items }) => ({
				...menu,
				items: items.map((item) => ({
					...item,
					beer: item.beer_id ? (beerMap.get(item.beer_id as number) ?? null) : null,
				})),
			}));

			return sendJSON(200, { ok: true, data: menusWithItems });
		}

		// ── Beers ───────────────────────────────────────────

		// GET /beers?limit=N (default 200)
		if (pathname === "/beers" && method === "GET") {
			const limitParam = parsedUrl.searchParams.get("limit");
			const parsed = parseInt(limitParam ?? "");
			const limit = isNaN(parsed) ? 200 : Math.max(1, Math.min(1000, parsed));
			const beers = await ops.listBeers(limit);
			return sendJSON(200, { ok: true, data: beers });
		}

		// GET /beers/:id
		if (pathname.match(/^\/beers\/\d+$/) && method === "GET") {
			const id = parseInt(pathname.split("/")[2]);
			const beer = await ops.getBeerById(id);

			if (!beer) {
				return sendJSON(404, { ok: false, error: "Beer not found" });
			}

			return sendJSON(200, { ok: true, data: beer });
		}

		// ── Users ───────────────────────────────────────────

		// GET /users
		if (pathname === "/users" && method === "GET") {
			const users = await ops.listUsers();
			return sendJSON(200, { ok: true, data: users });
		}

		// POST /users
		if (pathname === "/users" && method === "POST") {
			const body = await getBody();
			const { username, rssUrl, profileUrl, displayName } = body as Record<string, string>;

			if (!username || !rssUrl) {
				return sendJSON(400, { ok: false, error: "username and rssUrl are required" });
			}

			if (!isAllowedRSSUrl(rssUrl)) {
				return sendJSON(400, { ok: false, error: "rssUrl must be an https://untappd.com/rss/ URL" });
			}

			const existing = await ops.getUserByUsername(username);
			if (existing) {
				// Ensure RSS source exists (may be missing if previous create was interrupted)
				const existingRss = await ops.getRSSSourceByTypeAndForeignId("user", existing.id as number);
				if (!existingRss) {
					await ops.createRSSSource({
						type: "user",
						foreignId: existing.id as number,
						rssUrl,
						pollIntervalMinutes: 15,
					});
				}
				return sendJSON(200, { ok: true, data: existing });
			}

			let id: number;
			try {
				id = await ops.createUser({
					username,
					displayName: displayName || null,
					rssUrl,
					url: profileUrl || null,
				});
			} catch {
				// UNIQUE constraint violation — return the row the other request created
				const raced = await ops.getUserByUsername(username);
				if (raced) return sendJSON(200, { ok: true, data: raced });
				throw new Error("Failed to create user");
			}

			await ops.createRSSSource({
				type: "user",
				foreignId: id,
				rssUrl,
				pollIntervalMinutes: 15,
			});

			const user = await ops.getUserById(id);
			return sendJSON(201, { ok: true, data: user });
		}

		// ── Breweries ───────────────────────────────────────

		// GET /breweries
		if (pathname === "/breweries" && method === "GET") {
			const breweries = await ops.listBreweries();
			return sendJSON(200, { ok: true, data: breweries });
		}

		// POST /breweries
		if (pathname === "/breweries" && method === "POST") {
			const body = await getBody();
			const breweryUrl = body.url as string;
			const breweryName = body.name as string;

			if (!breweryUrl) {
				return sendJSON(400, { ok: false, error: "url is required" });
			}
			if (!breweryName) {
				return sendJSON(400, { ok: false, error: "name is required" });
			}

			if (!isAllowedUntappdUrl(breweryUrl)) {
				return sendJSON(400, { ok: false, error: "URL must be an https://untappd.com link" });
			}

			const scraper = await import("../scraper/index.ts");
			const { breweryId, slug } = scraper.parseBreweryUrl(breweryUrl);

			if (!slug) {
				return sendJSON(400, { ok: false, error: "Invalid brewery URL" });
			}

			const existing = await ops.getBreweryBySlug(slug);
			if (existing) {
				return sendJSON(200, { ok: true, data: existing });
			}

			let id: number;
			try {
				id = await ops.createBrewery({
					untappdBreweryId: breweryId,
					slug,
					name: breweryName,
					url: breweryUrl,
				});
			} catch {
				// UNIQUE constraint violation — return the row the other request created
				const raced = await ops.getBreweryBySlug(slug);
				if (raced) return sendJSON(200, { ok: true, data: raced });
				throw new Error("Failed to create brewery");
			}

			const brewery = await ops.getBreweryById(id);
			return sendJSON(201, { ok: true, data: brewery });
		}

		// ── RSS Sources ─────────────────────────────────────

		// GET /rss-sources
		if (pathname === "/rss-sources" && method === "GET") {
			const sources = await ops.listRSSSources();
			return sendJSON(200, { ok: true, data: sources });
		}

		// PATCH /rss-sources/:id
		if (pathname.match(/^\/rss-sources\/\d+$/) && method === "PATCH") {
			const id = parseInt(pathname.split("/")[2]);

			const source = await ops.getRSSSourceById(id);
			if (!source) {
				return sendJSON(404, { ok: false, error: "RSS source not found" });
			}

			const body = await getBody();
			if (body.enabled !== undefined) {
				if (typeof body.enabled !== "boolean") {
					return sendJSON(400, { ok: false, error: "enabled must be a boolean" });
				}
				await ops.toggleRSSSource(id, body.enabled);
			}

			const updated = await ops.getRSSSourceById(id);
			return sendJSON(200, { ok: true, data: updated });
		}

		// POST /rss-sources/:id/poll
		if (pathname.match(/^\/rss-sources\/\d+\/poll$/) && method === "POST") {
			const id = parseInt(pathname.split("/")[2]);

			const source = await ops.getRSSSourceById(id);
			if (!source) {
				return sendJSON(404, { ok: false, error: "RSS source not found" });
			}

			const { pollRSSSource } = await import("../rss/poller.ts");
			await pollRSSSource(source, log);

			return sendJSON(200, { ok: true, data: { message: "Polling triggered" } });
		}

		// ── Activity Events ─────────────────────────────────

		// GET /events
		if (pathname === "/events" && method === "GET") {
			const events = await ops.listActivityEvents(100);
			return sendJSON(200, { ok: true, data: events });
		}

		// ── Tools ───────────────────────────────────────────

		// POST /tools/lookup-venue
		if (pathname === "/tools/lookup-venue" && method === "POST") {
			const body = await getBody();
			if (!body.url) {
				return sendJSON(400, { ok: false, error: "url is required" });
			}
			const scraper = await import("../scraper/index.ts");
			return sendJSON(200, { ok: true, data: scraper.parseVenueUrl(body.url as string) });
		}

		// POST /tools/lookup-brewery
		if (pathname === "/tools/lookup-brewery" && method === "POST") {
			const body = await getBody();
			if (!body.url) {
				return sendJSON(400, { ok: false, error: "url is required" });
			}
			const scraper = await import("../scraper/index.ts");
			return sendJSON(200, { ok: true, data: scraper.parseBreweryUrl(body.url as string) });
		}

		// POST /tools/lookup-beer
		if (pathname === "/tools/lookup-beer" && method === "POST") {
			const body = await getBody();
			if (!body.url) {
				return sendJSON(400, { ok: false, error: "url is required" });
			}
			const scraper = await import("../scraper/index.ts");
			return sendJSON(200, { ok: true, data: scraper.parseBeerUrl(body.url as string) });
		}

		// POST /tools/lookup-user
		if (pathname === "/tools/lookup-user" && method === "POST") {
			const body = await getBody();
			if (!body.url) {
				return sendJSON(400, { ok: false, error: "url is required" });
			}
			const scraper = await import("../scraper/index.ts");
			return sendJSON(200, { ok: true, data: scraper.parseUserUrl(body.url as string) });
		}

		// 404 Not Found
		return sendJSON(404, { ok: false, error: "Not Found" });
	} catch (err: any) {
		if (err.message === "Payload too large") {
			return sendJSON(413, { ok: false, error: "Payload too large" });
		}
		log("api_error", { path: pathname, error: err.message }, "error");
		return sendJSON(500, { ok: false, error: "Internal server error" });
	}
}
