/**
 * pi-myfinance — Web UI + REST API.
 *
 * Mounts on pi-webserver at /finance (page) and /api/finance (API).
 * Also supports standalone mode via /finance-web command.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { getFinanceStore } from "./store.ts";
import { importBankFileFromBuffer } from "./import-bank.ts";
import { autoCategorize } from "./insights.ts";
import type { TransactionFilters } from "./types.ts";

// ── State ───────────────────────────────────────────────────────

let standaloneServer: http.Server | null = null;
let webServerMounted = false;

// ── HTML Loader ─────────────────────────────────────────────────

let cachedHtml: string | null = null;

function loadFinanceHtml(): string {
	if (cachedHtml) return cachedHtml;
	cachedHtml = fs.readFileSync(
		path.resolve(import.meta.dirname, "../finance.html"),
		"utf-8",
	);
	return cachedHtml;
}

// ── Page Handler ────────────────────────────────────────────────

export async function handleFinancePage(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	urlPath: string,
): Promise<void> {
	const method = req.method ?? "GET";

	try {
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
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(loadFinanceHtml());
			return;
		}

		json(res, 404, { error: "Not found" });
	} catch (err: any) {
		json(res, 500, { error: err.message });
	}
}

// ── API Handler ─────────────────────────────────────────────────

export async function handleFinanceApi(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	urlPath: string,
): Promise<void> {
	const url = new URL(req.url ?? "/", "http://localhost");
	const method = req.method ?? "GET";

	try {
		let store: ReturnType<typeof getFinanceStore>;
		try {
			store = getFinanceStore();
		} catch {
			json(res, 503, { error: "Finance store not initialized", retry: true });
			return;
		}

		// ── Accounts ────────────────────────────────────────
		if (method === "GET" && urlPath === "/accounts") {
			json(res, 200, await store.getAccounts());
			return;
		}

		const accountMatch = urlPath.match(/^\/accounts\/(\d+)$/);
		if (accountMatch) {
			const id = parseInt(accountMatch[1]);
			if (method === "GET") {
				const account = await store.getAccount(id);
				if (!account) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, account);
				return;
			}
			if (method === "PATCH") {
				const body = JSON.parse(await readBody(req));
				const updated = await store.updateAccount(id, body);
				if (!updated) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, updated);
				return;
			}
			if (method === "DELETE") {
				json(res, 200, { ok: await store.deleteAccount(id) });
				return;
			}
		}

		if (method === "POST" && urlPath === "/accounts") {
			const body = JSON.parse(await readBody(req));
			if (!body.name || !body.account_type) {
				json(res, 400, { error: "name and account_type are required" });
				return;
			}
			json(res, 201, await store.createAccount(body));
			return;
		}

		// ── Categories ──────────────────────────────────────
		if (method === "GET" && urlPath === "/categories") {
			json(res, 200, await store.getCategories());
			return;
		}

		if (method === "POST" && urlPath === "/categories") {
			const body = JSON.parse(await readBody(req));
			if (!body.name) { json(res, 400, { error: "name is required" }); return; }
			json(res, 201, await store.createCategory(body));
			return;
		}

		// ── Category Keywords ───────────────────────────────
		if (method === "GET" && urlPath === "/keywords") {
			const categoryId = intParam(url, "category_id");
			json(res, 200, await store.getCategoryKeywords(categoryId));
			return;
		}

		if (method === "POST" && urlPath === "/keywords") {
			const body = JSON.parse(await readBody(req));
			if (!body.category_id || !body.keyword) {
				json(res, 400, { error: "category_id and keyword are required" });
				return;
			}
			json(res, 201, await store.createCategoryKeyword(body));
			return;
		}

		if (method === "POST" && urlPath === "/keywords/test") {
			const body = JSON.parse(await readBody(req));
			if (!body.description) { json(res, 400, { error: "description is required" }); return; }
			const match = await store.matchKeyword(body.description);
			json(res, 200, { match });
			return;
		}

		const kwMatch = urlPath.match(/^\/keywords\/(\d+)$/);
		if (kwMatch) {
			const id = parseInt(kwMatch[1]);
			if (method === "GET") {
				const kw = await store.getCategoryKeyword(id);
				if (!kw) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, kw);
				return;
			}
			if (method === "PATCH") {
				const body = JSON.parse(await readBody(req));
				const updated = await store.updateCategoryKeyword(id, body);
				if (!updated) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, updated);
				return;
			}
			if (method === "DELETE") {
				json(res, 200, { ok: await store.deleteCategoryKeyword(id) });
				return;
			}
		}

		// ── Transactions ────────────────────────────────────
		if (method === "GET" && urlPath === "/transactions") {
			const categoryIdsStr = url.searchParams.get("category_ids");
			const categoryIds = categoryIdsStr ? categoryIdsStr.split(",").map(Number).filter(n => !isNaN(n)) : undefined;
			const filters: TransactionFilters = {
				account_id: intParam(url, "account_id"),
				category_id: intParam(url, "category_id"),
				category_ids: categoryIds,
				transaction_type: url.searchParams.get("type") as any ?? undefined,
				date_from: url.searchParams.get("date_from") ?? undefined,
				date_to: url.searchParams.get("date_to") ?? undefined,
				search: url.searchParams.get("q") ?? undefined,
				limit: intParam(url, "limit") ?? 100,
				offset: intParam(url, "offset") ?? 0,
			};
			json(res, 200, await store.getTransactions(filters));
			return;
		}

		if (method === "GET" && urlPath === "/transactions/export.csv") {
			const filters: TransactionFilters = {
				account_id: intParam(url, "account_id"),
				date_from: url.searchParams.get("date_from") ?? undefined,
				date_to: url.searchParams.get("date_to") ?? undefined,
			};
			const csv = await store.exportTransactionsCsv(filters);
			res.writeHead(200, {
				"Content-Type": "text/csv; charset=utf-8",
				"Content-Disposition": 'attachment; filename="transactions.csv"',
			});
			res.end(csv);
			return;
		}

		if (method === "POST" && urlPath === "/transactions/import") {
			const body = JSON.parse(await readBody(req));
			if (!body.csv || !body.account_id) {
				json(res, 400, { error: "csv and account_id are required" });
				return;
			}
			json(res, 200, await store.importTransactionsCsv(body.csv, body.account_id));
			return;
		}

		if (method === "POST" && urlPath === "/transactions/import-file") {
			const contentType = req.headers["content-type"] ?? "";
			if (!contentType.includes("multipart/form-data")) {
				json(res, 400, { error: "Expected multipart/form-data" });
				return;
			}
			const { fields, files } = await parseMultipart(req);
			const accountId = parseInt(fields.account_id ?? "");
			if (!accountId) {
				json(res, 400, { error: "account_id field is required" });
				return;
			}
			if (!files.file) {
				json(res, 400, { error: "file field is required" });
				return;
			}
			const { buffer, filename } = files.file;
			const result = await importBankFileFromBuffer(store, buffer, filename, accountId);
			json(res, 200, result);
			return;
		}

		// ── Auto-Categorize ──────────────────────────────────
		if (method === "POST" && urlPath === "/transactions/auto-categorize") {
			const result = await autoCategorize(store);
			json(res, 200, result);
			return;
		}

		// ── Transfer Linking ─────────────────────────────────
		const matchesMatch = urlPath.match(/^\/transactions\/(\d+)\/matches$/);
		if (matchesMatch && method === "GET") {
			const id = parseInt(matchesMatch[1]);
			const limit = intParam(url, "limit") ?? 10;
			json(res, 200, await store.findTransferMatches(id, limit));
			return;
		}

		const linkMatch = urlPath.match(/^\/transactions\/(\d+)\/link$/);
		if (linkMatch && method === "POST") {
			const id = parseInt(linkMatch[1]);
			const body = JSON.parse(await readBody(req));
			if (!body.linked_id) {
				json(res, 400, { error: "linked_id is required" });
				return;
			}
			const ok = await store.linkTransactions(id, body.linked_id);
			if (!ok) { json(res, 400, { error: "Cannot link: transactions not found or same account" }); return; }
			json(res, 200, { ok: true });
			return;
		}

		const unlinkMatch = urlPath.match(/^\/transactions\/(\d+)\/unlink$/);
		if (unlinkMatch && method === "POST") {
			const id = parseInt(unlinkMatch[1]);
			const ok = await store.unlinkTransaction(id);
			if (!ok) { json(res, 400, { error: "Transaction not linked" }); return; }
			json(res, 200, { ok: true });
			return;
		}

		const txMatch = urlPath.match(/^\/transactions\/(\d+)$/);
		if (txMatch) {
			const id = parseInt(txMatch[1]);
			if (method === "GET") {
				const tx = await store.getTransaction(id);
				if (!tx) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, tx);
				return;
			}
			if (method === "PATCH") {
				const body = JSON.parse(await readBody(req));
				const updated = await store.updateTransaction(id, body);
				if (!updated) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, updated);
				return;
			}
			if (method === "DELETE") {
				json(res, 200, { ok: await store.deleteTransaction(id) });
				return;
			}
		}

		if (method === "POST" && urlPath === "/transactions") {
			const body = JSON.parse(await readBody(req));
			if (!body.account_id || !body.amount || !body.transaction_type || !body.description) {
				json(res, 400, { error: "account_id, amount, transaction_type, and description are required" });
				return;
			}
			json(res, 201, await store.createTransaction(body));
			return;
		}

		// ── Budgets ─────────────────────────────────────────
		if (method === "GET" && urlPath === "/budgets") {
			const year = intParam(url, "year");
			const month = intParam(url, "month");
			json(res, 200, await store.getBudgets(year, month));
			return;
		}

		if (method === "GET" && urlPath === "/budgets/status") {
			const now = new Date();
			const year = intParam(url, "year") ?? now.getFullYear();
			const month = intParam(url, "month") ?? now.getMonth() + 1;
			json(res, 200, await store.getBudgetStatus(year, month));
			return;
		}

		const budgetMatch = urlPath.match(/^\/budgets\/(\d+)$/);
		if (budgetMatch) {
			const id = parseInt(budgetMatch[1]);
			if (method === "PATCH") {
				const body = JSON.parse(await readBody(req));
				const updated = await store.updateBudget(id, body);
				if (!updated) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, updated);
				return;
			}
			if (method === "DELETE") {
				json(res, 200, { ok: await store.deleteBudget(id) });
				return;
			}
		}

		if (method === "POST" && urlPath === "/budgets") {
			const body = JSON.parse(await readBody(req));
			if (!body.category_id || !body.amount) {
				json(res, 400, { error: "category_id and amount are required" });
				return;
			}
			json(res, 201, await store.createBudget(body));
			return;
		}

		// ── Goals ───────────────────────────────────────────
		if (method === "GET" && urlPath === "/goals") {
			const status = url.searchParams.get("status") as any ?? undefined;
			json(res, 200, await store.getGoals(status));
			return;
		}

		const goalMatch = urlPath.match(/^\/goals\/(\d+)$/);
		if (goalMatch) {
			const id = parseInt(goalMatch[1]);
			if (method === "GET") {
				const goal = await store.getGoal(id);
				if (!goal) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, goal);
				return;
			}
			if (method === "PATCH") {
				const body = JSON.parse(await readBody(req));
				const updated = await store.updateGoal(id, body);
				if (!updated) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, updated);
				return;
			}
			if (method === "DELETE") {
				json(res, 200, { ok: await store.deleteGoal(id) });
				return;
			}
		}

		if (method === "POST" && urlPath === "/goals") {
			const body = JSON.parse(await readBody(req));
			if (!body.name || !body.goal_type || !body.target_amount) {
				json(res, 400, { error: "name, goal_type, and target_amount are required" });
				return;
			}
			json(res, 201, await store.createGoal(body));
			return;
		}

		// ── Recurring ───────────────────────────────────────
		if (method === "GET" && urlPath === "/recurring") {
			const activeOnly = url.searchParams.get("active") !== "false";
			json(res, 200, await store.getRecurring(activeOnly));
			return;
		}

		if (method === "GET" && urlPath === "/recurring/upcoming") {
			const days = intParam(url, "days") ?? 30;
			json(res, 200, await store.getUpcomingRecurring(days));
			return;
		}

		if (method === "POST" && urlPath === "/recurring/process") {
			json(res, 200, { created: await store.processDueRecurring() });
			return;
		}

		const recurringMatch = urlPath.match(/^\/recurring\/(\d+)$/);
		if (recurringMatch) {
			const id = parseInt(recurringMatch[1]);
			if (method === "PATCH") {
				const body = JSON.parse(await readBody(req));
				const updated = await store.updateRecurring(id, body);
				if (!updated) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, updated);
				return;
			}
			if (method === "DELETE") {
				json(res, 200, { ok: await store.deleteRecurring(id) });
				return;
			}
		}

		if (method === "POST" && urlPath === "/recurring") {
			const body = JSON.parse(await readBody(req));
			if (!body.account_id || !body.amount || !body.transaction_type || !body.description || !body.frequency || !body.next_date) {
				json(res, 400, { error: "account_id, amount, transaction_type, description, frequency, and next_date are required" });
				return;
			}
			json(res, 201, await store.createRecurring(body));
			return;
		}

		// ── Vendors ─────────────────────────────────────────
		if (method === "GET" && urlPath === "/vendors") {
			const includeIgnored = url.searchParams.get("include_ignored") === "true";
			json(res, 200, await store.getVendors(includeIgnored));
			return;
		}

		if (method === "POST" && urlPath === "/vendors") {
			const body = JSON.parse(await readBody(req));
			if (!body.name) {
				json(res, 400, { error: "name is required" });
				return;
			}
			json(res, 201, await store.createVendor(body));
			return;
		}

		if (method === "POST" && urlPath === "/vendors/match") {
			const body = JSON.parse(await readBody(req));
			if (!body.description) { json(res, 400, { error: "description is required" }); return; }
			const match = await store.matchVendor(body.description);
			json(res, 200, { match });
			return;
		}

		const vendorMatch = urlPath.match(/^\/vendors\/(\d+)$/);
		if (vendorMatch) {
			const id = parseInt(vendorMatch[1]);
			if (method === "GET") {
				const vendor = await store.getVendor(id);
				if (!vendor) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, vendor);
				return;
			}
			if (method === "PATCH") {
				const body = JSON.parse(await readBody(req));
				const updated = await store.updateVendor(id, body);
				if (!updated) { json(res, 404, { error: "Not found" }); return; }
				json(res, 200, updated);
				return;
			}
			if (method === "DELETE") {
				json(res, 200, { ok: await store.deleteVendor(id) });
				return;
			}
		}

		// ── Reports ─────────────────────────────────────────
		if (method === "GET" && urlPath === "/reports/summary") {
			const now = new Date();
			const year = intParam(url, "year") ?? now.getFullYear();
			const month = intParam(url, "month") ?? now.getMonth() + 1;
			json(res, 200, await store.getSpendingSummary(year, month));
			return;
		}

		if (method === "GET" && urlPath === "/reports/trend") {
			const months = intParam(url, "months") ?? 12;
			const trendDateFrom = url.searchParams.get("date_from") ?? undefined;
			const trendDateTo = url.searchParams.get("date_to") ?? undefined;
			json(res, 200, await store.getMonthlyTrend(months, trendDateFrom, trendDateTo));
			return;
		}

		if (method === "GET" && urlPath === "/reports/breakdown-range") {
			const dateFrom = url.searchParams.get("date_from");
			const dateTo = url.searchParams.get("date_to");
			if (!dateFrom || !dateTo) {
				json(res, 400, { error: "date_from and date_to are required" });
				return;
			}
			json(res, 200, await store.getCategoryBreakdownByRange(dateFrom, dateTo));
			return;
		}

		if (method === "GET" && urlPath === "/reports/breakdown") {
			const now = new Date();
			const year = intParam(url, "year") ?? now.getFullYear();
			const month = intParam(url, "month") ?? now.getMonth() + 1;
			const type = url.searchParams.get("type") as any ?? undefined;
			json(res, 200, await store.getCategoryBreakdown(year, month, type));
			return;
		}

		json(res, 404, { error: "Not found" });
	} catch (err: any) {
		json(res, 500, { error: err.message });
	}
}

// ── pi-webserver Integration ────────────────────────────────────

export function mountOnWebServer(events: { emit: (event: string, data: unknown) => void }): void {
	events.emit("web:mount", {
		name: "finance",
		label: "Finance",
		description: "Personal finance tracking",
		prefix: "/finance",
		handler: handleFinancePage,
	});
	events.emit("web:mount-api", {
		name: "finance-api",
		label: "Finance API",
		description: "Finance REST API",
		prefix: "/finance",
		handler: handleFinanceApi,
	});
	webServerMounted = true;
}

export function isMountedOnWebServer(): boolean {
	return webServerMounted;
}

// ── Standalone Server ───────────────────────────────────────────

export function startStandaloneServer(port: number = 4200): string {
	if (standaloneServer) stopStandaloneServer();

	const API_PREFIX = "/api/finance";
	standaloneServer = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://localhost:${port}`);
		if (url.pathname.startsWith(API_PREFIX + "/") || url.pathname === API_PREFIX) {
			const subPath = url.pathname.slice(API_PREFIX.length) || "/";
			await handleFinanceApi(req, res, subPath);
		} else {
			await handleFinancePage(req, res, url.pathname);
		}
	});

	standaloneServer.listen(port);
	return `http://localhost:${port}`;
}

export function stopStandaloneServer(): boolean {
	if (!standaloneServer) return false;
	standaloneServer.closeAllConnections();
	standaloneServer.close();
	standaloneServer = null;
	return true;
}

// ── Helpers ─────────────────────────────────────────────────────

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

function readBody(req: http.IncomingMessage, maxSize: number = MAX_BODY_SIZE): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > maxSize) {
				req.destroy();
				reject(new Error(`Request body exceeds maximum size of ${maxSize} bytes`));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

function intParam(url: URL, name: string): number | undefined {
	const val = url.searchParams.get(name);
	if (!val) return undefined;
	const n = parseInt(val);
	return isNaN(n) ? undefined : n;
}

// ── Multipart Parser ────────────────────────────────────────────

interface MultipartResult {
	fields: Record<string, string>;
	files: Record<string, { buffer: Buffer; filename: string; contentType: string }>;
}

function readRawBody(req: http.IncomingMessage, maxSize: number = MAX_BODY_SIZE): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > maxSize) {
				req.destroy();
				reject(new Error(`Request body exceeds maximum size of ${maxSize} bytes`));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

async function parseMultipart(req: http.IncomingMessage): Promise<MultipartResult> {
	const contentType = req.headers["content-type"] ?? "";
	const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
	if (!boundaryMatch) throw new Error("No boundary in Content-Type");
	const boundary = boundaryMatch[1] ?? boundaryMatch[2];

	const raw = await readRawBody(req);
	const delimiter = Buffer.from(`--${boundary}`);
	const result: MultipartResult = { fields: {}, files: {} };

	// Split by boundary
	let start = 0;
	const parts: Buffer[] = [];
	while (true) {
		const idx = raw.indexOf(delimiter, start);
		if (idx === -1) break;
		if (start > 0) {
			// Strip leading \r\n and trailing \r\n before delimiter
			let partStart = start;
			let partEnd = idx;
			if (raw[partStart] === 0x0d && raw[partStart + 1] === 0x0a) partStart += 2;
			if (raw[partEnd - 2] === 0x0d && raw[partEnd - 1] === 0x0a) partEnd -= 2;
			if (partEnd > partStart) parts.push(raw.subarray(partStart, partEnd));
		}
		start = idx + delimiter.length;
		// Check for closing --
		if (raw[start] === 0x2d && raw[start + 1] === 0x2d) break;
	}

	for (const part of parts) {
		// Split headers from body at \r\n\r\n
		const headerEnd = part.indexOf("\r\n\r\n");
		if (headerEnd === -1) continue;

		const headers = part.subarray(0, headerEnd).toString("utf-8");
		const body = part.subarray(headerEnd + 4);

		const nameMatch = headers.match(/name="([^"]+)"/);
		if (!nameMatch) continue;
		const name = nameMatch[1];

		const filenameMatch = headers.match(/filename="([^"]+)"/);
		if (filenameMatch) {
			const ctMatch = headers.match(/Content-Type:\s*(.+)/i);
			result.files[name] = {
				buffer: Buffer.from(body),
				filename: filenameMatch[1],
				contentType: ctMatch?.[1]?.trim() ?? "application/octet-stream",
			};
		} else {
			result.fields[name] = body.toString("utf-8");
		}
	}

	return result;
}
