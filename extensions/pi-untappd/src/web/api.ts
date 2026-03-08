/**
 * JSON API endpoints for pi-untappd.
 *
 * All routes are under /api/untappd/
 * All DB access via operations module (event bus, no direct kysely).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { LogFn } from "../logger.ts";
import * as ops from "../db/operations.ts";

/** Validate that an RSS URL points to untappd.com to prevent SSRF. */
function isAllowedRSSUrl(rssUrl: string): boolean {
	try {
		const parsed = new URL(rssUrl);
		return parsed.protocol === "https:" &&
			(parsed.hostname === "untappd.com" || parsed.hostname.endsWith(".untappd.com"));
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

			let body = "";
			let rejected = false;
			req.on("data", (chunk: Buffer) => {
				body += chunk;
				if (body.length > MAX_BODY) {
					rejected = true;
					req.destroy();
					reject(new Error("Payload too large"));
				}
			});
			req.on("end", () => {
				if (rejected) return;
				try {
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
					return sendJSON(200, { ok: true, data: existing });
				}
			}

			// Create venue
			const id = await ops.createVenue({
				untappdVenueId: venueId,
				slug,
				name: (body.name as string) || `Venue ${venueId || slug}`,
				url: venueUrl,
			});

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
			return sendJSON(201, { ok: true, data: venue });
		}

		// POST /venues/:id/scrape
		if (pathname.match(/^\/venues\/\d+\/scrape$/) && method === "POST") {
			return sendJSON(501, { ok: false, error: "Venue scraping is not yet implemented" });
		}

		// GET /venues/:id/menus
		if (pathname.match(/^\/venues\/\d+\/menus$/) && method === "GET") {
			const id = parseInt(pathname.split("/")[2]);

			const menus = await ops.getVenueMenusByVenueId(id);

			const menusWithItems = await Promise.all(
				menus.map(async (menu) => {
					const items = await ops.getMenuItemsByMenuId(menu.id as number);

					const itemsWithBeers = await Promise.all(
						items.map(async (item) => {
							let beer = null;
							if (item.beer_id) {
								beer = await ops.getBeerById(item.beer_id as number);
							}
							return { ...item, beer };
						}),
					);

					return { ...menu, items: itemsWithBeers };
				}),
			);

			return sendJSON(200, { ok: true, data: menusWithItems });
		}

		// ── Beers ───────────────────────────────────────────

		// GET /beers
		if (pathname === "/beers" && method === "GET") {
			const beers = await ops.listBeers();
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
				return sendJSON(200, { ok: true, data: existing });
			}

			const id = await ops.createUser({
				username,
				displayName: displayName || null,
				rssUrl,
				url: profileUrl || null,
			});

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

			const id = await ops.createBrewery({
				untappdBreweryId: breweryId,
				slug,
				name: breweryName,
				url: breweryUrl,
			});

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
				await ops.toggleRSSSource(id, body.enabled as boolean);
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
		log("api_error", { path: pathname, error: err.message }, "error");
		return sendJSON(500, { ok: false, error: "Internal server error" });
	}
}
