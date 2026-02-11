/**
 * CRM Web UI — serves HTML + REST API for contacts management.
 *
 * Can run standalone (/crm-web) or mount on pi-webserver (automatic if available).
 * When pi-webserver is installed, the CRM auto-mounts at /crm on session start.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { crmApi } from "./db.ts";
import { VALID_EXTENSION_FIELD_TYPES } from "./types.ts";

// ── Validation ──────────────────────────────────────────────────

/**
 * Sanitize a URL: only allow http(s) protocols. Returns the cleaned
 * URL or null if the value is empty/missing. Throws on bad protocols.
 */
function sanitizeUrl(value: unknown): string | null {
	if (value == null || value === "") return null;
	const s = String(value).trim();
	if (!s) return null;
	if (/^https?:\/\//i.test(s)) return s;
	// Bare domain — assume https
	if (!s.includes("://")) return `https://${s}`;
	throw new Error(`Invalid URL protocol — only http and https are allowed`);
}

// ── State ───────────────────────────────────────────────────────

let standaloneServer: http.Server | null = null;
let standalonePort: number | null = null;
let webServerMounted = false;

// ── HTML Loader ─────────────────────────────────────────────────

function loadCrmHtml(): string {
	const shellHtml = fs.readFileSync(
		path.resolve(import.meta.dirname, "../crm.html"),
		"utf-8",
	);
	const pageDir = path.resolve(import.meta.dirname, "../pages");
	const pageNames = ["contacts", "companies", "groups", "interactions", "reminders", "upcoming"];
	const pagesHtml = pageNames
		.map((name) =>
			fs.readFileSync(path.join(pageDir, `${name}.html`), "utf-8"),
		)
		.join("\n\n");
	return shellHtml.replace("<!-- PAGES -->", pagesHtml);
}

// ── Page Handler ────────────────────────────────────────────────

/**
 * Serves the CRM HTML page. Mounted at /crm via web:mount.
 *
 * Also forwards /api/crm/* subpaths to the API handler — this handles
 * relative fetch URLs from the HTML page (e.g. `fetch("api/crm/contacts")`)
 * which resolve to /crm/api/crm/... when the page is at /crm/.
 */
export async function handleCrmPage(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	urlPath: string,
): Promise<void> {
	const method = req.method ?? "GET";

	// Forward API subpaths (from relative URLs in the HTML page)
	const apiPrefix = "/api/crm";
	if (urlPath.startsWith(apiPrefix + "/") || urlPath === apiPrefix) {
		const subPath = urlPath.slice(apiPrefix.length) || "/";
		return handleCrmApi(req, res, subPath);
	}

	try {
		// Trailing-slash redirect (needed when mounted at a prefix)
		if (urlPath === "/" && method === "GET") {
			const rawUrl = req.url ?? "/";
			const qIdx = rawUrl.indexOf("?");
			const rawPath = qIdx >= 0 ? rawUrl.slice(0, qIdx) : rawUrl;
			if (rawPath.length > 1 && !rawPath.endsWith("/")) {
				const qs = qIdx >= 0 ? rawUrl.slice(qIdx) : "";
				res.writeHead(301, { Location: rawPath + "/" + qs });
				res.end();
				return;
			}
		}

		if (method === "GET" && urlPath === "/") {
			const CRM_HTML = loadCrmHtml();
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(CRM_HTML);
			return;
		}

		json(res, 404, { error: "Not found" });
	} catch (err: any) {
		json(res, 500, { error: err.message });
	}
}

// ── API Handler ─────────────────────────────────────────────────

/**
 * Handles CRM REST API requests. Paths are relative to the API mount
 * point (e.g. "/contacts", "/companies/1").
 *
 * When mounted via pi-webserver's mountApi at "/crm", the webserver
 * strips "/api/crm" and passes the remainder. The standalone server
 * strips the prefix before calling this handler.
 */
export async function handleCrmApi(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	urlPath: string,
): Promise<void> {
	const url = new URL(req.url ?? "/", "http://localhost");
	const method = req.method ?? "GET";

	try {
		// ── Contacts ────────────────────────────────────────
		if (method === "GET" && urlPath === "/contacts") {
			const companyId = url.searchParams.get("company_id");
			if (companyId) {
				json(res, 200, crmApi.getContactsByCompany(parseInt(companyId)));
				return;
			}
			const search = url.searchParams.get("q") ?? undefined;
			const limit = parseInt(url.searchParams.get("limit") ?? "1000");
			json(res, 200, crmApi.getContacts(search, limit));
			return;
		}

		if (method === "GET" && urlPath === "/contacts/export.csv") {
			const csv = crmApi.exportContactsCsv();
			res.writeHead(200, {
				"Content-Type": "text/csv; charset=utf-8",
				"Content-Disposition": 'attachment; filename="crm-contacts.csv"',
			});
			res.end(csv);
			return;
		}

		if (method === "POST" && urlPath === "/contacts/import") {
			const csv = await readBody(req);
			if (!csv.trim()) { json(res, 400, { error: "Empty CSV body" }); return; }
			json(res, 200, crmApi.importContactsCsv(csv));
			return;
		}

		if (method === "POST" && urlPath === "/contacts/check-duplicates") {
			const body = JSON.parse(await readBody(req));
			if (!body.first_name) { json(res, 400, { error: "first_name is required" }); return; }
			json(res, 200, { duplicates: crmApi.findDuplicates(body) });
			return;
		}

		const contactMatch = urlPath.match(/^\/contacts\/(\d+)$/);
		if (contactMatch) {
			const id = parseInt(contactMatch[1]);

			if (method === "GET") {
				const contact = crmApi.getContact(id);
				if (!contact) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, {
					contact,
					interactions: crmApi.getInteractions(id),
					reminders: crmApi.getReminders(id),
					relationships: crmApi.getRelationships(id),
					groups: crmApi.getContactGroups(id),
					extensionFields: crmApi.getExtensionFields(id),
				});
				return;
			}

			if (method === "PATCH") {
				const body = JSON.parse(await readBody(req));
				let company_id = body.company_id;
				if (body.company_name && company_id === undefined) {
					const companies = crmApi.getCompanies(body.company_name);
					if (companies.length > 0) { company_id = companies[0].id; }
					else if (body.company_name) { company_id = crmApi.createCompany({ name: body.company_name }).id; }
				}
				const contact = crmApi.updateContact(id, { ...body, company_id });
				if (!contact) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, contact);
				return;
			}

			if (method === "DELETE") {
				json(res, 200, { ok: crmApi.deleteContact(id) });
				return;
			}
		}

		if (method === "POST" && urlPath === "/contacts") {
			const body = JSON.parse(await readBody(req));
			if (!body.first_name) { json(res, 400, { error: "first_name is required" }); return; }
			let company_id = body.company_id;
			if (body.company_name && !company_id) {
				const companies = crmApi.getCompanies(body.company_name);
				if (companies.length > 0) { company_id = companies[0].id; }
				else { company_id = crmApi.createCompany({ name: body.company_name }).id; }
			}
			json(res, 201, crmApi.createContact({ ...body, company_id }));
			return;
		}

		// ── Companies ───────────────────────────────────────
		if (method === "GET" && urlPath === "/companies") {
			const search = url.searchParams.get("q") ?? undefined;
			json(res, 200, crmApi.getCompanies(search));
			return;
		}

		const companyMatch = urlPath.match(/^\/companies\/(\d+)$/);
		if (companyMatch) {
			const id = parseInt(companyMatch[1]);
			if (method === "PATCH") {
				const body = JSON.parse(await readBody(req));
				if (body.website !== undefined) {
					try { body.website = sanitizeUrl(body.website); }
					catch (e: any) { json(res, 400, { error: e.message }); return; }
				}
				const co = crmApi.updateCompany(id, body);
				if (!co) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, co);
				return;
			}
			if (method === "DELETE") { json(res, 200, { ok: crmApi.deleteCompany(id) }); return; }
		}

		if (method === "POST" && urlPath === "/companies") {
			const body = JSON.parse(await readBody(req));
			if (!body.name) { json(res, 400, { error: "name is required" }); return; }
			try { body.website = sanitizeUrl(body.website); }
			catch (e: any) { json(res, 400, { error: e.message }); return; }
			json(res, 201, crmApi.createCompany(body));
			return;
		}

		// ── Interactions ────────────────────────────────────
		if (method === "GET" && urlPath === "/interactions") {
			const contactId = url.searchParams.get("contact_id");
			if (contactId) {
				json(res, 200, crmApi.getInteractions(parseInt(contactId)));
			} else {
				json(res, 200, crmApi.getAllInteractions());
			}
			return;
		}

		if (method === "POST" && urlPath === "/interactions") {
			const body = JSON.parse(await readBody(req));
			if (!body.contact_id || !body.interaction_type || !body.summary) {
				json(res, 400, { error: "contact_id, interaction_type, and summary are required" }); return;
			}
			json(res, 201, crmApi.createInteraction(body));
			return;
		}

		const interactionMatch = urlPath.match(/^\/interactions\/(\d+)$/);
		if (interactionMatch && method === "DELETE") {
			json(res, 200, { ok: crmApi.deleteInteraction(parseInt(interactionMatch[1])) });
			return;
		}

		// ── Reminders ───────────────────────────────────────
		if (method === "GET" && urlPath === "/reminders/upcoming") {
			const days = parseInt(url.searchParams.get("days") ?? "30");
			json(res, 200, crmApi.getUpcomingReminders(days));
			return;
		}

		if (method === "GET" && urlPath === "/reminders") {
			const contactId = url.searchParams.get("contact_id");
			json(res, 200, contactId ? crmApi.getReminders(parseInt(contactId)) : crmApi.getAllReminders());
			return;
		}

		if (method === "POST" && urlPath === "/reminders") {
			const body = JSON.parse(await readBody(req));
			if (!body.contact_id || !body.reminder_type || !body.reminder_date) {
				json(res, 400, { error: "contact_id, reminder_type, and reminder_date are required" }); return;
			}
			json(res, 201, crmApi.createReminder(body));
			return;
		}

		const reminderMatch = urlPath.match(/^\/reminders\/(\d+)$/);
		if (reminderMatch && method === "DELETE") {
			json(res, 200, { ok: crmApi.deleteReminder(parseInt(reminderMatch[1])) });
			return;
		}

		// ── Relationships ───────────────────────────────────
		if (method === "GET" && urlPath === "/relationships") {
			const contactId = url.searchParams.get("contact_id");
			if (!contactId) { json(res, 400, { error: "contact_id is required" }); return; }
			json(res, 200, crmApi.getRelationships(parseInt(contactId)));
			return;
		}

		if (method === "POST" && urlPath === "/relationships") {
			const body = JSON.parse(await readBody(req));
			if (!body.contact_id || !body.related_contact_id || !body.relationship_type) {
				json(res, 400, { error: "contact_id, related_contact_id, and relationship_type are required" }); return;
			}
			json(res, 201, crmApi.createRelationship(body));
			return;
		}

		const relMatch = urlPath.match(/^\/relationships\/(\d+)$/);
		if (relMatch && method === "DELETE") {
			json(res, 200, { ok: crmApi.deleteRelationship(parseInt(relMatch[1])) });
			return;
		}

		// ── Groups ──────────────────────────────────────────
		if (method === "GET" && urlPath === "/groups") {
			json(res, 200, crmApi.getGroups());
			return;
		}

		if (method === "POST" && urlPath === "/groups") {
			const body = JSON.parse(await readBody(req));
			if (!body.name) { json(res, 400, { error: "name is required" }); return; }
			json(res, 201, crmApi.createGroup(body));
			return;
		}

		const groupMembersMatch = urlPath.match(/^\/groups\/(\d+)\/members$/);
		if (groupMembersMatch) {
			const groupId = parseInt(groupMembersMatch[1]);
			if (method === "GET") { json(res, 200, crmApi.getGroupMembers(groupId)); return; }
			if (method === "POST") {
				const body = JSON.parse(await readBody(req));
				if (!body.contact_id) { json(res, 400, { error: "contact_id is required" }); return; }
				const ok = crmApi.addGroupMember(groupId, body.contact_id);
				json(res, ok ? 201 : 200, { ok });
				return;
			}
		}

		const groupMemberMatch = urlPath.match(/^\/groups\/(\d+)\/members\/(\d+)$/);
		if (groupMemberMatch && method === "DELETE") {
			json(res, 200, { ok: crmApi.removeGroupMember(parseInt(groupMemberMatch[1]), parseInt(groupMemberMatch[2])) });
			return;
		}

		const groupMatch = urlPath.match(/^\/groups\/(\d+)$/);
		if (groupMatch && method === "DELETE") {
			json(res, 200, { ok: crmApi.deleteGroup(parseInt(groupMatch[1])) });
			return;
		}

		// ── Extension Fields ────────────────────────────────
		// GET /contacts/:id/extension-fields[?source=...]
		const extFieldsMatch = urlPath.match(/^\/contacts\/(\d+)\/extension-fields$/);
		if (extFieldsMatch && method === "GET") {
			const contactId = parseInt(extFieldsMatch[1]);
			const source = url.searchParams.get("source");
			json(res, 200, source
				? crmApi.getExtensionFieldsBySource(contactId, source)
				: crmApi.getExtensionFields(contactId));
			return;
		}

		// PUT /contacts/:id/extension-fields — upsert a field
		if (extFieldsMatch && method === "PUT") {
			const contactId = parseInt(extFieldsMatch[1]);
			const body = JSON.parse(await readBody(req));
			if (!body.source || !body.field_name || body.field_value == null) {
				json(res, 400, { error: "source, field_name, and field_value are required" }); return;
			}
			if (body.field_type && !VALID_EXTENSION_FIELD_TYPES.includes(body.field_type)) {
				json(res, 400, { error: `Invalid field_type — must be one of: ${VALID_EXTENSION_FIELD_TYPES.join(", ")}` }); return;
			}
			json(res, 200, crmApi.setExtensionField({ ...body, contact_id: contactId }));
			return;
		}

		// DELETE /contacts/:id/extension-fields?source=...
		if (extFieldsMatch && method === "DELETE") {
			const contactId = parseInt(extFieldsMatch[1]);
			const source = url.searchParams.get("source");
			if (!source) { json(res, 400, { error: "source query param is required" }); return; }
			json(res, 200, { deleted: crmApi.deleteExtensionFields(contactId, source) });
			return;
		}

		// ── Company Extension Fields ────────────────────────
		// GET /companies/:id/extension-fields[?source=...]
		const coExtFieldsMatch = urlPath.match(/^\/companies\/(\d+)\/extension-fields$/);
		if (coExtFieldsMatch && method === "GET") {
			const companyId = parseInt(coExtFieldsMatch[1]);
			const source = url.searchParams.get("source");
			json(res, 200, source
				? crmApi.getCompanyExtensionFieldsBySource(companyId, source)
				: crmApi.getCompanyExtensionFields(companyId));
			return;
		}

		// PUT /companies/:id/extension-fields — upsert a field
		if (coExtFieldsMatch && method === "PUT") {
			const companyId = parseInt(coExtFieldsMatch[1]);
			const body = JSON.parse(await readBody(req));
			if (!body.source || !body.field_name || body.field_value == null) {
				json(res, 400, { error: "source, field_name, and field_value are required" }); return;
			}
			if (body.field_type && !VALID_EXTENSION_FIELD_TYPES.includes(body.field_type)) {
				json(res, 400, { error: `Invalid field_type — must be one of: ${VALID_EXTENSION_FIELD_TYPES.join(", ")}` }); return;
			}
			json(res, 200, crmApi.setCompanyExtensionField({ ...body, company_id: companyId }));
			return;
		}

		// DELETE /companies/:id/extension-fields?source=...
		if (coExtFieldsMatch && method === "DELETE") {
			const companyId = parseInt(coExtFieldsMatch[1]);
			const source = url.searchParams.get("source");
			if (!source) { json(res, 400, { error: "source query param is required" }); return; }
			json(res, 200, { deleted: crmApi.deleteCompanyExtensionFields(companyId, source) });
			return;
		}

		// 404
		json(res, 404, { error: "Not found" });
	} catch (err: any) {
		json(res, 500, { error: err.message });
	}
}

// ── Standalone Server ───────────────────────────────────────────

/**
 * Start a standalone CRM web server. Returns the URL.
 * Routes /api/crm/* to the API handler, everything else to the page handler.
 */
export function startStandaloneServer(port: number = 4100): string {
	if (standaloneServer) stopStandaloneServer();

	const API_PREFIX = "/api/crm";
	standaloneServer = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://localhost:${port}`);
		if (url.pathname.startsWith(API_PREFIX + "/") || url.pathname === API_PREFIX) {
			const subPath = url.pathname.slice(API_PREFIX.length) || "/";
			await handleCrmApi(req, res, subPath);
		} else {
			await handleCrmPage(req, res, url.pathname);
		}
	});

	standaloneServer.listen(port);
	standalonePort = port;
	return `http://localhost:${port}`;
}

/**
 * Stop the standalone CRM web server. Returns true if a server was running.
 */
export function stopStandaloneServer(): boolean {
	if (!standaloneServer) return false;
	standaloneServer.closeAllConnections();
	standaloneServer.close();
	standaloneServer = null;
	standalonePort = null;
	return true;
}

// ── pi-webserver Integration ────────────────────────────────────

/**
 * Mount CRM on the shared pi-webserver via the event bus.
 * - Page at /crm (web:mount)
 * - API at /api/crm (web:mount-api) — gets pi-webserver's token auth for free
 */
export function mountOnWebServer(events: { emit: (event: string, data: unknown) => void }): void {
	events.emit("web:mount", {
		name: "crm",
		label: "Personal CRM",
		description: "Contact management, interactions, and reminders",
		prefix: "/crm",
		handler: handleCrmPage,
	});
	events.emit("web:mount-api", {
		name: "crm-api",
		label: "CRM API",
		description: "CRM REST API",
		prefix: "/crm",
		handler: handleCrmApi,
	});
	webServerMounted = true;
}

/**
 * Unmount CRM routes from the shared pi-webserver.
 */
export function unmountFromWebServer(events: { emit: (event: string, data: unknown) => void }): void {
	events.emit("web:unmount", { name: "crm" });
	events.emit("web:unmount-api", { name: "crm-api" });
	webServerMounted = false;
}

/**
 * Check if the CRM is currently mounted on pi-webserver.
 */
export function isMountedOnWebServer(): boolean {
	return webServerMounted;
}

// ── Backward Compatibility ──────────────────────────────────────

/** @deprecated Use handleCrmApi instead */
export async function handleCrmRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	urlPath: string,
): Promise<void> {
	// Legacy handler — route based on path prefix
	if (urlPath.startsWith("/api/crm")) {
		const subPath = urlPath.slice("/api/crm".length) || "/";
		return handleCrmApi(req, res, subPath);
	}
	return handleCrmPage(req, res, urlPath);
}

/** @deprecated Use startStandaloneServer instead */
export function startCrmServer(port?: number): string {
	return startStandaloneServer(port);
}

/** @deprecated Use stopStandaloneServer instead */
export function stopCrmServer(): boolean {
	return stopStandaloneServer();
}

// ── Helpers ─────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}
