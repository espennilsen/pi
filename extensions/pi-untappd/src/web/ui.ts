/**
 * Web UI for pi-untappd.
 *
 * All DB access via operations module (event bus, no direct kysely).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { LogFn } from "../logger.ts";
import * as ops from "../db/operations.ts";

/** Escape HTML special characters in DB-derived values. */
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** Sanitize a URL for use in href attributes — only allow https: scheme. */
const safeUrl = (u: unknown) => String(u ?? "").startsWith("https://") ? String(u) : "#";

export async function handleUIRequest(
	req: IncomingMessage,
	res: ServerResponse,
	path: string,
	log: LogFn,
): Promise<void> {
	const parsedUrl = new URL(path, "http://localhost");
	const pathname = parsedUrl.pathname || "/";

	log("ui_request", { path: pathname });

	// Helper to render HTML
	const renderHTML = (title: string, content: string) => {
		return `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${esc(title)} - Untappd Monitor</title>
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
		.container { max-width: 1200px; margin: 0 auto; padding: 20px; }
		nav { background: #fff; border-bottom: 1px solid #e0e0e0; margin-bottom: 20px; }
		nav ul { list-style: none; display: flex; gap: 20px; padding: 15px 20px; }
		nav a { text-decoration: none; color: #333; font-weight: 500; }
		nav a:hover { color: #FFCD00; }
		.card { background: #fff; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
		h1, h2, h3 { margin-bottom: 15px; color: #333; }
		table { width: 100%; border-collapse: collapse; }
		th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e0e0e0; }
		th { background: #f9f9f9; font-weight: 600; }
		.btn { display: inline-block; padding: 8px 16px; background: #FFCD00; color: #333; text-decoration: none; border-radius: 4px; border: none; cursor: pointer; font-size: 14px; }
		.btn:hover { background: #f4c400; }
		.btn-secondary { background: #e0e0e0; }
		.btn-secondary:hover { background: #d0d0d0; }
		form { margin-top: 20px; }
		label { display: block; margin-bottom: 5px; font-weight: 500; }
		input, textarea { width: 100%; padding: 8px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 4px; }
		.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
		.stat { background: #fff; padding: 20px; border-radius: 8px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
		.stat-value { font-size: 32px; font-weight: bold; color: #FFCD00; }
		.stat-label { color: #666; margin-top: 5px; }
	</style>
</head>
<body>
	<nav>
		<ul>
			<li><a href="/untappd">Dashboard</a></li>
			<li><a href="/untappd/venues">Venues</a></li>
			<li><a href="/untappd/users">Users</a></li>
			<li><a href="/untappd/breweries">Breweries</a></li>
			<li><a href="/untappd/beers">Beers</a></li>
			<li><a href="/untappd/rss-sources">RSS Sources</a></li>
			<li><a href="/untappd/tools">Tools</a></li>
		</ul>
	</nav>
	<div class="container">
		${content}
	</div>
</body>
</html>
		`;
	};

	try {
		// Dashboard
		if (pathname === "/" || pathname === "") {
			const venues = await ops.listVenues();
			const users = await ops.listUsers();
			const breweries = await ops.listBreweries();
			const beers = await ops.listBeers(10);
			const sources = await ops.listRSSSources();
			const events = await ops.listActivityEvents(10);

			const activeSources = sources.filter((s) => s.enabled);

			const content = `
				<h1>Untappd Monitor Dashboard</h1>
				<div class="stats">
					<div class="stat">
						<div class="stat-value">${venues.length}</div>
						<div class="stat-label">Venues</div>
					</div>
					<div class="stat">
						<div class="stat-value">${users.length}</div>
						<div class="stat-label">Users</div>
					</div>
					<div class="stat">
						<div class="stat-value">${breweries.length}</div>
						<div class="stat-label">Breweries</div>
					</div>
					<div class="stat">
						<div class="stat-value">${beers.length}</div>
						<div class="stat-label">Beers</div>
					</div>
					<div class="stat">
						<div class="stat-value">${activeSources.length}</div>
						<div class="stat-label">Active RSS Sources</div>
					</div>
				</div>

				<div class="card">
					<h2>Recent Activity</h2>
					${events.length > 0 ? `
						<table>
							<thead>
								<tr>
									<th>Time</th>
									<th>User</th>
									<th>Beer</th>
									<th>Type</th>
								</tr>
							</thead>
							<tbody>
								${events.map((e) => `
									<tr>
										<td>${esc(new Date(e.occurred_at as string).toLocaleString())}</td>
										<td>${esc(e.user_username || "-")}</td>
										<td>${esc(e.beer_name)}</td>
										<td>${esc(e.event_type)}</td>
									</tr>
								`).join("")}
							</tbody>
						</table>
					` : "<p>No recent activity</p>"}
				</div>

				<div class="card">
					<h2>Quick Actions</h2>
					<a href="/untappd/venues/add" class="btn">Add Venue</a>
					<a href="/untappd/users/add" class="btn">Add User</a>
					<a href="/untappd/breweries/add" class="btn">Add Brewery</a>
				</div>
			`;

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(renderHTML("Dashboard", content));
			return;
		}

		// Venues list
		if (pathname === "/venues") {
			const venues = await ops.listVenues();

			const content = `
				<h1>Venues</h1>
				<div class="card">
					<a href="/untappd/venues/add" class="btn">Add Venue</a>
				</div>
				<div class="card">
					${venues.length > 0 ? `
						<table>
							<thead>
								<tr>
									<th>Name</th>
									<th>City</th>
									<th>Country</th>
									<th>Last Scraped</th>
									<th>Actions</th>
								</tr>
							</thead>
							<tbody>
								${venues.map((v) => `
									<tr>
										<td><a href="/untappd/venues/${v.id}">${esc(v.name)}</a></td>
										<td>${esc(v.city || "-")}</td>
										<td>${esc(v.country || "-")}</td>
										<td>${v.last_menu_scraped_at ? esc(new Date(v.last_menu_scraped_at as string).toLocaleString()) : "Never"}</td>
										<td>
											<a href="/untappd/venues/${v.id}" class="btn btn-secondary">View</a>
										</td>
									</tr>
								`).join("")}
							</tbody>
						</table>
					` : "<p>No venues yet. <a href='/untappd/venues/add'>Add your first venue</a></p>"}
				</div>
			`;

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(renderHTML("Venues", content));
			return;
		}

		// Add venue form
		if (pathname === "/venues/add") {
			const content = `
				<h1>Add Venue</h1>
				<div class="card">
					<form action="/api/untappd/venues" method="POST" onsubmit="handleSubmit(event, this)">
						<label for="url">Untappd Venue URL *</label>
						<input type="url" id="url" name="url" placeholder="https://untappd.com/v/venue-name/123456" required>

						<label for="name">Custom Name (optional)</label>
						<input type="text" id="name" name="name" placeholder="Leave empty to auto-detect">

						<button type="submit" class="btn">Add Venue</button>
						<a href="/untappd/venues" class="btn btn-secondary">Cancel</a>
					</form>
				</div>

				<script>
					async function handleSubmit(e, form) {
						e.preventDefault();
						const formData = new FormData(form);
						const data = Object.fromEntries(formData);

						const res = await fetch('/api/untappd/venues', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(data)
						});

						if (res.ok) {
							window.location.href = '/untappd/venues';
						} else {
							const err = await res.json();
							alert('Error: ' + err.error);
						}
					}
				</script>
			`;

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(renderHTML("Add Venue", content));
			return;
		}

		// Venue detail
		if (pathname.match(/^\/venues\/\d+$/)) {
			const id = parseInt(pathname.split("/")[2]);
			const venue = await ops.getVenueById(id);

			if (!venue) {
				res.writeHead(404, { "Content-Type": "text/html" });
				res.end(renderHTML("Not Found", "<h1>404 — Venue not found</h1>"));
				return;
			}

			const menus = await ops.getVenueMenusByVenueId(id);
			const events = await ops.listActivityEventsByVenue(id, 20);

			const content = `
				<h1>${esc(venue.name)}</h1>
				<div class="card">
					<table>
						<tr><th>Untappd ID</th><td>${esc(venue.untappd_venue_id || "—")}</td></tr>
						<tr><th>Slug</th><td>${esc(venue.slug || "—")}</td></tr>
						<tr><th>City</th><td>${esc(venue.city || "—")}</td></tr>
						<tr><th>Country</th><td>${esc(venue.country || "—")}</td></tr>
						<tr><th>URL</th><td><a href="${esc(safeUrl(venue.url))}" target="_blank">${esc(venue.url)}</a></td></tr>
						<tr><th>Last Scraped</th><td>${venue.last_menu_scraped_at ? esc(new Date(venue.last_menu_scraped_at as string).toLocaleString()) : "Never"}</td></tr>
					</table>
				</div>

				<div class="card">
					<h2>Menus (${menus.length})</h2>
					${menus.length > 0 ? menus.map((m) => `<p>${esc(m.name)} <small>(${esc(m.source_tag || "manual")})</small></p>`).join("") : "<p>No menus yet.</p>"}
				</div>

				<div class="card">
					<h2>Recent Activity</h2>
					${events.length > 0 ? `
						<table>
							<thead><tr><th>Time</th><th>User</th><th>Beer</th></tr></thead>
							<tbody>
								${events.map((e) => `
									<tr>
										<td>${esc(new Date(e.occurred_at as string).toLocaleString())}</td>
										<td>${esc(e.user_username || "—")}</td>
										<td>${esc(e.beer_name)}</td>
									</tr>
								`).join("")}
							</tbody>
						</table>
					` : "<p>No activity yet.</p>"}
				</div>
			`;

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(renderHTML(venue.name as string, content));
			return;
		}

		// Users list
		if (pathname === "/users") {
			const users = await ops.listUsers();

			const content = `
				<h1>Users</h1>
				<div class="card">
					<a href="/untappd/users/add" class="btn">Add User</a>
				</div>
				<div class="card">
					${users.length > 0 ? `
						<table>
							<thead><tr><th>Username</th><th>Display Name</th><th>RSS URL</th></tr></thead>
							<tbody>
								${users.map((u) => `
									<tr>
										<td>${esc(u.username)}</td>
										<td>${esc(u.display_name || "—")}</td>
										<td><small>${esc(u.rss_url)}</small></td>
									</tr>
								`).join("")}
							</tbody>
						</table>
					` : "<p>No users yet. <a href='/untappd/users/add'>Add your first user</a></p>"}
				</div>
			`;

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(renderHTML("Users", content));
			return;
		}

		// Add user form
		if (pathname === "/users/add") {
			const content = `
				<h1>Add User</h1>
				<div class="card">
					<form action="/api/untappd/users" method="POST" onsubmit="handleSubmit(event, this)">
						<label for="username">Username *</label>
						<input type="text" id="username" name="username" placeholder="espennilsen" required>

						<label for="rssUrl">RSS URL *</label>
						<input type="url" id="rssUrl" name="rssUrl" placeholder="https://untappd.com/rss/user/espennilsen" required>

						<label for="profileUrl">Profile URL (optional)</label>
						<input type="url" id="profileUrl" name="profileUrl" placeholder="https://untappd.com/user/espennilsen">

						<label for="displayName">Display Name (optional)</label>
						<input type="text" id="displayName" name="displayName">

						<button type="submit" class="btn">Add User</button>
						<a href="/untappd/users" class="btn btn-secondary">Cancel</a>
					</form>
				</div>

				<script>
					async function handleSubmit(e, form) {
						e.preventDefault();
						const formData = new FormData(form);
						const data = Object.fromEntries(formData);

						const res = await fetch('/api/untappd/users', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(data)
						});

						if (res.ok) {
							window.location.href = '/untappd/users';
						} else {
							const err = await res.json();
							alert('Error: ' + err.error);
						}
					}
				</script>
			`;

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(renderHTML("Add User", content));
			return;
		}

		// Breweries list
		if (pathname === "/breweries") {
			const breweries = await ops.listBreweries();

			const content = `
				<h1>Breweries</h1>
				<div class="card">
					<a href="/untappd/breweries/add" class="btn">Add Brewery</a>
				</div>
				<div class="card">
					${breweries.length > 0 ? `
						<table>
							<thead><tr><th>Name</th><th>Slug</th><th>URL</th></tr></thead>
							<tbody>
								${breweries.map((b) => `
									<tr>
										<td>${esc(b.name)}</td>
										<td>${esc(b.slug)}</td>
										<td><a href="${esc(safeUrl(b.url))}" target="_blank">View on Untappd</a></td>
									</tr>
								`).join("")}
							</tbody>
						</table>
					` : "<p>No breweries yet. <a href='/untappd/breweries/add'>Add your first brewery</a></p>"}
				</div>
			`;

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(renderHTML("Breweries", content));
			return;
		}

		// Add brewery form
		if (pathname === "/breweries/add") {
			const content = `
				<h1>Add Brewery</h1>
				<div class="card">
					<form action="/api/untappd/breweries" method="POST" onsubmit="handleSubmit(event, this)">
						<label for="url">Untappd Brewery URL *</label>
						<input type="url" id="url" name="url" placeholder="https://untappd.com/w/brewery-name/123456" required>

						<label for="name">Name *</label>
						<input type="text" id="name" name="name" placeholder="Brewery name" required>

						<button type="submit" class="btn">Add Brewery</button>
						<a href="/untappd/breweries" class="btn btn-secondary">Cancel</a>
					</form>
				</div>

				<script>
					async function handleSubmit(e, form) {
						e.preventDefault();
						const formData = new FormData(form);
						const data = Object.fromEntries(formData);

						const res = await fetch('/api/untappd/breweries', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(data)
						});

						if (res.ok) {
							window.location.href = '/untappd/breweries';
						} else {
							const err = await res.json();
							alert('Error: ' + err.error);
						}
					}
				</script>
			`;

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(renderHTML("Add Brewery", content));
			return;
		}

		// Beers list
		if (pathname === "/beers") {
			const beers = await ops.listBeers(200);

			const content = `
				<h1>Beers</h1>
				<div class="card">
					${beers.length > 0 ? `
						<table>
							<thead><tr><th>Name</th><th>Style</th><th>ABV</th><th>IBU</th></tr></thead>
							<tbody>
								${beers.map((b) => `
									<tr>
										<td>${esc(b.name)}</td>
										<td>${esc(b.style || "—")}</td>
										<td>${b.abv != null ? esc(b.abv) + "%" : "—"}</td>
										<td>${esc(b.ibu ?? "—")}</td>
									</tr>
								`).join("")}
							</tbody>
						</table>
					` : "<p>No beers tracked yet. Beers are added automatically from RSS activity.</p>"}
				</div>
			`;

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(renderHTML("Beers", content));
			return;
		}

		// RSS Sources list
		if (pathname === "/rss-sources") {
			const sources = await ops.listRSSSources();

			const content = `
				<h1>RSS Sources</h1>
				<div class="card">
					${sources.length > 0 ? `
						<table>
							<thead><tr><th>Type</th><th>RSS URL</th><th>Interval</th><th>Enabled</th><th>Last Polled</th></tr></thead>
							<tbody>
								${sources.map((s) => `
									<tr>
										<td>${esc(s.type)}</td>
										<td><small>${esc(s.rss_url)}</small></td>
										<td>${esc(s.poll_interval_minutes)}m</td>
										<td>${s.enabled ? "✅" : "❌"}</td>
										<td>${s.last_polled_at ? esc(new Date(s.last_polled_at as string).toLocaleString()) : "Never"}</td>
									</tr>
								`).join("")}
							</tbody>
						</table>
					` : "<p>No RSS sources configured. Add a venue or user to create one automatically.</p>"}
				</div>
			`;

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(renderHTML("RSS Sources", content));
			return;
		}

		// Tools page
		if (pathname === "/tools") {
			const content = `
				<h1>Lookup Tools</h1>

				<div class="card">
					<h2>Lookup Venue</h2>
					<form onsubmit="lookupVenue(event, this)">
						<label for="venue-url">Untappd Venue URL</label>
						<input type="url" id="venue-url" name="url" placeholder="https://untappd.com/v/venue-name/123456">
						<button type="submit" class="btn">Lookup</button>
					</form>
					<div id="venue-result"></div>
				</div>

				<div class="card">
					<h2>Lookup User</h2>
					<form onsubmit="lookupUser(event, this)">
						<label for="user-url">Untappd User URL</label>
						<input type="url" id="user-url" name="url" placeholder="https://untappd.com/user/username">
						<button type="submit" class="btn">Lookup</button>
					</form>
					<div id="user-result"></div>
				</div>

				<script>
					function showError(container, message) {
						const p = document.createElement('p');
						p.style.color = 'red';
						p.textContent = 'Error: ' + message;
						container.replaceChildren(p);
					}

					async function lookupVenue(e, form) {
						e.preventDefault();
						const formData = new FormData(form);
						const data = Object.fromEntries(formData);

						const res = await fetch('/api/untappd/tools/lookup-venue', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(data)
						});

						const result = await res.json();
						const div = document.getElementById('venue-result');

						if (result.ok) {
							const pre = document.createElement('pre');
							pre.textContent = JSON.stringify(result.data, null, 2);
							div.replaceChildren(pre);
						} else {
							showError(div, result.error);
						}
					}

					async function lookupUser(e, form) {
						e.preventDefault();
						const formData = new FormData(form);
						const data = Object.fromEntries(formData);

						const res = await fetch('/api/untappd/tools/lookup-user', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(data)
						});

						const result = await res.json();
						const div = document.getElementById('user-result');

						if (result.ok) {
							const pre = document.createElement('pre');
							pre.textContent = JSON.stringify(result.data, null, 2);
							div.replaceChildren(pre);
						} else {
							showError(div, result.error);
						}
					}
				</script>
			`;

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(renderHTML("Tools", content));
			return;
		}

		// 404
		res.writeHead(404, { "Content-Type": "text/html" });
		res.end(renderHTML("Not Found", "<h1>404 - Page Not Found</h1>"));
	} catch (err: any) {
		log("ui_error", { path: pathname, error: err.message }, "error");
		res.writeHead(500, { "Content-Type": "text/html" });
		res.end(renderHTML("Error", `<h1>Error</h1><p>${esc(err.message)}</p>`));
	}
}
