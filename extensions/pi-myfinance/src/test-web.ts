/**
 * pi-myfinance — Web API smoke test.
 *
 * Starts a standalone server, hits all API endpoints, validates responses.
 * Run: npx tsx src/test-web.ts
 */

import { closeDb } from "./db.ts";
import { createSqliteStore } from "./store.ts";
import { startStandaloneServer, stopStandaloneServer } from "./web.ts";
import * as fs from "node:fs";

import { setFinanceStore } from "./store.ts";
const TEST_DB = "/tmp/pi-myfinance-test-web.db";
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const store = await createSqliteStore(TEST_DB);
setFinanceStore(store);

import { handleFinanceApi } from "./web.ts";
import * as http from "node:http";

const PORT = 14200;
const BASE = `http://localhost:${PORT}/api/finance`;

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
	const prefix = "/api/finance";
	if (url.pathname.startsWith(prefix)) {
		const subPath = url.pathname.slice(prefix.length) || "/";
		await handleFinanceApi(req, res, subPath);
	} else {
		res.writeHead(404);
		res.end("Not found");
	}
});

server.listen(PORT, async () => {
	let passed = 0;
	let failed = 0;

	function assert(cond: boolean, msg: string) {
		if (cond) { console.log(`  ✅ ${msg}`); passed++; }
		else { console.log(`  ❌ ${msg}`); failed++; }
	}

	async function get(path: string) {
		const res = await fetch(BASE + path);
		return { status: res.status, data: await res.json() };
	}
	async function post(path: string, body: any) {
		const res = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
		return { status: res.status, data: await res.json() };
	}
	async function patch(path: string, body: any) {
		const res = await fetch(BASE + path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
		return { status: res.status, data: await res.json() };
	}
	async function del(path: string) {
		const res = await fetch(BASE + path, { method: "DELETE" });
		return { status: res.status, data: await res.json() };
	}

	console.log("=== pi-myfinance Web API Test ===\n");

	// Accounts
	console.log("🏦 Accounts");
	let r = await get("/accounts");
	assert(r.status === 200 && Array.isArray(r.data), `GET /accounts: ${r.data.length} accounts`);

	r = await post("/accounts", { name: "Test Checking", account_type: "checking", currency: "NOK", balance: 10000 });
	assert(r.status === 201 && r.data.name === "Test Checking", `POST /accounts: created id=${r.data.id}`);
	const acctId = r.data.id;

	r = await patch(`/accounts/${acctId}`, { name: "Updated Checking" });
	assert(r.status === 200 && r.data.name === "Updated Checking", "PATCH /accounts/:id");

	// Categories
	console.log("\n📁 Categories");
	r = await get("/categories");
	assert(r.status === 200 && r.data.length > 0, `GET /categories: ${r.data.length} categories`);
	const groceryCat = r.data.find((c: any) => c.name === "Groceries");

	// Transactions
	console.log("\n💳 Transactions");
	r = await post("/transactions", { account_id: acctId, amount: 500, transaction_type: "out", description: "Test expense" });
	assert(r.status === 201 && r.data.id > 0, `POST /transactions: id=${r.data.id}`);
	const txId = r.data.id;

	r = await get(`/transactions/${txId}`);
	assert(r.status === 200 && r.data.description === "Test expense", `GET /transactions/:id`);

	r = await get("/transactions?type=out&limit=10");
	assert(r.status === 200 && r.data.length >= 1, `GET /transactions?type=out: ${r.data.length}`);

	r = await patch(`/transactions/${txId}`, { description: "Updated expense" });
	assert(r.status === 200 && r.data.description === "Updated expense", "PATCH /transactions/:id");

	r = await del(`/transactions/${txId}`);
	assert(r.status === 200 && r.data.ok === true, "DELETE /transactions/:id");

	// Budgets
	console.log("\n📊 Budgets");
	if (groceryCat) {
		r = await post("/budgets", { category_id: groceryCat.id, amount: 5000, period: "monthly", month: 2, year: 2026 });
		assert(r.status === 201 && r.data.id > 0, `POST /budgets: id=${r.data.id}`);
	}

	r = await get("/budgets?year=2026&month=2");
	assert(r.status === 200 && Array.isArray(r.data), `GET /budgets: ${r.data.length}`);

	r = await get("/budgets/status?year=2026&month=2");
	assert(r.status === 200 && Array.isArray(r.data), `GET /budgets/status: ${r.data.length}`);

	// Goals
	console.log("\n🎯 Goals");
	r = await post("/goals", { name: "Test Goal", goal_type: "savings", target_amount: 50000 });
	assert(r.status === 201 && r.data.name === "Test Goal", `POST /goals: id=${r.data.id}`);
	const goalId = r.data.id;

	r = await get(`/goals/${goalId}`);
	assert(r.status === 200 && r.data.name === "Test Goal", "GET /goals/:id");

	r = await patch(`/goals/${goalId}`, { current_amount: 10000 });
	assert(r.status === 200 && r.data.current_amount === 10000, "PATCH /goals/:id");

	r = await del(`/goals/${goalId}`);
	assert(r.status === 200 && r.data.ok === true, "DELETE /goals/:id");

	// Recurring
	console.log("\n🔁 Recurring");
	r = await post("/recurring", { account_id: acctId, amount: 199, transaction_type: "out", description: "Netflix", frequency: "monthly", next_date: "2026-02-13" });
	assert(r.status === 201, `POST /recurring: id=${r.data.id}`);

	r = await get("/recurring");
	assert(r.status === 200 && r.data.length >= 1, `GET /recurring: ${r.data.length}`);

	r = await get("/recurring/upcoming?days=60");
	assert(r.status === 200 && Array.isArray(r.data), `GET /recurring/upcoming: ${r.data.length} upcoming`);

	r = await post("/recurring/process", {});
	assert(r.status === 200 && Array.isArray(r.data.created), `POST /recurring/process: ${r.data.created.length} created`);

	// Reports
	console.log("\n📈 Reports");
	r = await get("/reports/summary?year=2026&month=2");
	assert(r.status === 200 && r.data.period === "2026-02", `GET /reports/summary: period=${r.data.period}`);

	r = await get("/reports/breakdown?year=2026&month=2");
	assert(r.status === 200 && Array.isArray(r.data), `GET /reports/breakdown: ${r.data.length} categories`);

	r = await get("/reports/trend?months=6");
	assert(r.status === 200 && Array.isArray(r.data), `GET /reports/trend: ${r.data.length} months`);

	r = await get("/reports/breakdown-range?date_from=2026-01-01&date_to=2026-12-31");
	assert(r.status === 200 && Array.isArray(r.data), `GET /reports/breakdown-range: ${r.data.length} categories`);

	// 404
	r = await get("/nonexistent");
	assert(r.status === 404, "404 for unknown route");

	// Cleanup
	r = await del(`/accounts/${acctId}`);
	assert(r.status === 200, "DELETE /accounts/:id (cascade)");

	console.log(`\n${"═".repeat(40)}`);
	console.log(`Results: ${passed} passed, ${failed} failed`);
	console.log(`${"═".repeat(40)}`);

	server.closeAllConnections();
	server.close();
	closeDb();
	fs.unlinkSync(TEST_DB);
	process.exit(failed > 0 ? 1 : 0);
});
