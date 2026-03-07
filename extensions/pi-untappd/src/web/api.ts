/**
 * JSON API endpoints for pi-untappd.
 * 
 * All routes are under /api/untappd/
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { LogFn } from "../logger.ts";
import * as url from "node:url";

interface APIResponse {
	ok: boolean;
	data?: any;
	error?: string;
}

export async function handleAPIRequest(
	req: IncomingMessage,
	res: ServerResponse,
	path: string,
	log: LogFn
): Promise<void> {
	const method = req.method || "GET";
	const parsedUrl = url.parse(path, true);
	const pathname = parsedUrl.pathname || "/";
	
	log("api_request", { method, path: pathname });
	
	// Helper to send JSON response
	const sendJSON = (status: number, data: APIResponse) => {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(data));
	};
	
	// Parse JSON body for POST/PUT/PATCH
	const getBody = (): Promise<any> => {
		return new Promise((resolve, reject) => {
			if (method === "GET" || method === "HEAD") {
				resolve({});
				return;
			}
			
			let body = "";
			req.on("data", chunk => body += chunk);
			req.on("end", () => {
				try {
					resolve(body ? JSON.parse(body) : {});
				} catch (err) {
					reject(new Error("Invalid JSON"));
				}
			});
			req.on("error", reject);
		});
	};
	
	try {
		// Route: GET /venues
		if (pathname === "/venues" && method === "GET") {
			const ops = await import("../db/operations.ts");
			const db = await getDB();
			const venues = await ops.listVenues(db);
			return sendJSON(200, { ok: true, data: venues });
		}
		
		// Route: POST /venues
		if (pathname === "/venues" && method === "POST") {
			const body = await getBody();
			const { url, name } = body;
			
			if (!url) {
				return sendJSON(400, { ok: false, error: "url is required" });
			}
			
			const scraper = await import("../scraper/index.ts");
			const ops = await import("../db/operations.ts");
			const db = await getDB();
			
			const { venueId, slug } = scraper.parseVenueUrl(url);
			
			// Check if venue already exists
			if (venueId) {
				const existing = await ops.getVenueByUntappdId(db, venueId);
				if (existing) {
					return sendJSON(200, { ok: true, data: existing });
				}
			}
			
			// Create venue
			const id = await ops.createVenue(db, {
				untappdVenueId: venueId,
				slug,
				name: name || `Venue ${venueId || slug}`,
				url,
			});
			
			// Create RSS source
			const rssUrl = `https://untappd.com/rss/venue/${venueId}`;
			await ops.createRSSSource(db, {
				type: "venue",
				foreignId: id,
				rssUrl,
				pollIntervalMinutes: 15,
			});
			
			const venue = await ops.getVenueById(db, id);
			return sendJSON(201, { ok: true, data: venue });
		}
		
		// Route: POST /venues/:id/scrape
		if (pathname.match(/^\/venues\/\d+\/scrape$/) && method === "POST") {
			const id = parseInt(pathname.split("/")[2]);
			
			const ops = await import("../db/operations.ts");
			const scraper = await import("../scraper/index.ts");
			const db = await getDB();
			
			const venue = await ops.getVenueById(db, id);
			if (!venue) {
				return sendJSON(404, { ok: false, error: "Venue not found" });
			}
			
			// Scrape venue
			const scraped = await scraper.scrapeVenue(venue.url, log);
			
			// Update venue
			await ops.updateVenueLastScraped(db, id);
			
			return sendJSON(200, { ok: true, data: { scraped, message: "Scraping complete (placeholder)" } });
		}
		
		// Route: GET /venues/:id/menus
		if (pathname.match(/^\/venues\/\d+\/menus$/) && method === "GET") {
			const id = parseInt(pathname.split("/")[2]);
			
			const ops = await import("../db/operations.ts");
			const db = await getDB();
			
			const menus = await ops.getVenueMenusByVenueId(db, id);
			
			// Get items for each menu
			const menusWithItems = await Promise.all(
				menus.map(async (menu) => {
					const items = await ops.getMenuItemsByMenuId(db, menu.id);
					
					// Enrich items with beer data
					const itemsWithBeers = await Promise.all(
						items.map(async (item) => {
							let beer = null;
							if (item.beer_id) {
								beer = await ops.getBeerById(db, item.beer_id);
							}
							return { ...item, beer };
						})
					);
					
					return { ...menu, items: itemsWithBeers };
				})
			);
			
			return sendJSON(200, { ok: true, data: menusWithItems });
		}
		
		// Route: GET /beers
		if (pathname === "/beers" && method === "GET") {
			const ops = await import("../db/operations.ts");
			const db = await getDB();
			const beers = await ops.listBeers(db);
			return sendJSON(200, { ok: true, data: beers });
		}
		
		// Route: GET /beers/:id
		if (pathname.match(/^\/beers\/\d+$/) && method === "GET") {
			const id = parseInt(pathname.split("/")[2]);
			
			const ops = await import("../db/operations.ts");
			const db = await getDB();
			const beer = await ops.getBeerById(db, id);
			
			if (!beer) {
				return sendJSON(404, { ok: false, error: "Beer not found" });
			}
			
			return sendJSON(200, { ok: true, data: beer });
		}
		
		// Route: GET /users
		if (pathname === "/users" && method === "GET") {
			const ops = await import("../db/operations.ts");
			const db = await getDB();
			const users = await ops.listUsers(db);
			return sendJSON(200, { ok: true, data: users });
		}
		
		// Route: POST /users
		if (pathname === "/users" && method === "POST") {
			const body = await getBody();
			const { username, rssUrl, profileUrl, displayName } = body;
			
			if (!username || !rssUrl) {
				return sendJSON(400, { ok: false, error: "username and rssUrl are required" });
			}
			
			const ops = await import("../db/operations.ts");
			const db = await getDB();
			
			// Check if user exists
			const existing = await ops.getUserByUsername(db, username);
			if (existing) {
				return sendJSON(200, { ok: true, data: existing });
			}
			
			// Create user
			const id = await ops.createUser(db, {
				username,
				displayName: displayName || null,
				rssUrl,
				url: profileUrl || null,
			});
			
			// Create RSS source
			await ops.createRSSSource(db, {
				type: "user",
				foreignId: id,
				rssUrl,
				pollIntervalMinutes: 15,
			});
			
			const user = await ops.getUserById(db, id);
			return sendJSON(201, { ok: true, data: user });
		}
		
		// Route: GET /breweries
		if (pathname === "/breweries" && method === "GET") {
			const ops = await import("../db/operations.ts");
			const db = await getDB();
			const breweries = await ops.listBreweries(db);
			return sendJSON(200, { ok: true, data: breweries });
		}
		
		// Route: POST /breweries
		if (pathname === "/breweries" && method === "POST") {
			const body = await getBody();
			const { url } = body;
			
			if (!url) {
				return sendJSON(400, { ok: false, error: "url is required" });
			}
			
			const scraper = await import("../scraper/index.ts");
			const ops = await import("../db/operations.ts");
			const db = await getDB();
			
			const { breweryId, slug } = scraper.parseBreweryUrl(url);
			
			if (!slug) {
				return sendJSON(400, { ok: false, error: "Invalid brewery URL" });
			}
			
			// Check if brewery exists
			const existing = await ops.getBreweryBySlug(db, slug);
			if (existing) {
				return sendJSON(200, { ok: true, data: existing });
			}
			
			// Scrape brewery
			const scraped = await scraper.scrapeBrewery(url, log);
			
			// Create brewery
			const id = await ops.createBrewery(db, {
				untappdBreweryId: breweryId,
				slug: scraped.slug,
				name: scraped.name,
				url,
			});
			
			const brewery = await ops.getBreweryById(db, id);
			return sendJSON(201, { ok: true, data: brewery });
		}
		
		// Route: GET /rss-sources
		if (pathname === "/rss-sources" && method === "GET") {
			const ops = await import("../db/operations.ts");
			const db = await getDB();
			const sources = await ops.listRSSSources(db);
			return sendJSON(200, { ok: true, data: sources });
		}
		
		// Route: PATCH /rss-sources/:id
		if (pathname.match(/^\/rss-sources\/\d+$/) && method === "PATCH") {
			const id = parseInt(pathname.split("/")[2]);
			const body = await getBody();
			const { enabled } = body;
			
			const ops = await import("../db/operations.ts");
			const db = await getDB();
			
			if (enabled !== undefined) {
				await ops.toggleRSSSource(db, id, enabled);
			}
			
			const source = await ops.getRSSSourceById(db, id);
			return sendJSON(200, { ok: true, data: source });
		}
		
		// Route: POST /rss-sources/:id/poll
		if (pathname.match(/^\/rss-sources\/\d+\/poll$/) && method === "POST") {
			const id = parseInt(pathname.split("/")[2]);
			
			const ops = await import("../db/operations.ts");
			const db = await getDB();
			
			const source = await ops.getRSSSourceById(db, id);
			if (!source) {
				return sendJSON(404, { ok: false, error: "RSS source not found" });
			}
			
			// Poll immediately
			const { pollRSSSources } = await import("../rss/poller.ts");
			// Note: This would need to be modified to poll a single source
			await pollRSSSources(log);
			
			return sendJSON(200, { ok: true, data: { message: "Polling triggered" } });
		}
		
		// Route: GET /events
		if (pathname === "/events" && method === "GET") {
			const ops = await import("../db/operations.ts");
			const db = await getDB();
			const events = await ops.listActivityEvents(db, 100);
			return sendJSON(200, { ok: true, data: events });
		}
		
		// Route: POST /tools/lookup-venue
		if (pathname === "/tools/lookup-venue" && method === "POST") {
			const body = await getBody();
			const { url } = body;
			
			if (!url) {
				return sendJSON(400, { ok: false, error: "url is required" });
			}
			
			const scraper = await import("../scraper/index.ts");
			const parsed = scraper.parseVenueUrl(url);
			
			return sendJSON(200, { ok: true, data: parsed });
		}
		
		// Route: POST /tools/lookup-brewery
		if (pathname === "/tools/lookup-brewery" && method === "POST") {
			const body = await getBody();
			const { url } = body;
			
			if (!url) {
				return sendJSON(400, { ok: false, error: "url is required" });
			}
			
			const scraper = await import("../scraper/index.ts");
			const parsed = scraper.parseBreweryUrl(url);
			
			return sendJSON(200, { ok: true, data: parsed });
		}
		
		// Route: POST /tools/lookup-beer
		if (pathname === "/tools/lookup-beer" && method === "POST") {
			const body = await getBody();
			const { url } = body;
			
			if (!url) {
				return sendJSON(400, { ok: false, error: "url is required" });
			}
			
			const scraper = await import("../scraper/index.ts");
			const parsed = scraper.parseBeerUrl(url);
			
			return sendJSON(200, { ok: true, data: parsed });
		}
		
		// Route: POST /tools/lookup-user
		if (pathname === "/tools/lookup-user" && method === "POST") {
			const body = await getBody();
			const { url } = body;
			
			if (!url) {
				return sendJSON(400, { ok: false, error: "url is required" });
			}
			
			const scraper = await import("../scraper/index.ts");
			const parsed = scraper.parseUserUrl(url);
			
			return sendJSON(200, { ok: true, data: parsed });
		}
		
		// 404 Not Found
		return sendJSON(404, { ok: false, error: "Not Found" });
	} catch (err: any) {
		log("api_error", { path: pathname, error: err.message }, "error");
		return sendJSON(500, { ok: false, error: err.message });
	}
}

// Helper to get database (placeholder)
async function getDB(): Promise<any> {
	// This should be replaced with proper kysely registry access
	throw new Error("Database access not implemented");
}
