/**
 * pi-myfinance — Bank import test against real files.
 *
 * Run: npx tsx src/test-import.ts
 */

import { closeDb } from "./db.ts";
import { createSqliteStore } from "./store.ts";
import { parseDnbTxt, parseDnbXlsx, parseSasXlsx, parseAmexXlsx, importBankFile, importBankDirectory, detectFormat } from "./import-bank.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const TEST_DB = "/tmp/pi-myfinance-test-import.db";
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);

const store = await createSqliteStore(TEST_DB);

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
	if (cond) { console.log(`  ✅ ${msg}`); passed++; }
	else { console.log(`  ❌ ${msg}`); failed++; }
}

const FINANCE_DIR = "/Users/espen/Dev/aivena/workspace/finance";

console.log("=== pi-myfinance Bank Import Test ===\n");

// ── Format Detection ────────────────────────────────────────────

console.log("🔍 Format Detection");
assert(await detectFormat(`${FINANCE_DIR}/DNB/Kortet.txt`) === "dnb-txt", "Kortet.txt → dnb-txt");
assert(await detectFormat(`${FINANCE_DIR}/DNB/Siste transaksjoner .xlsx`) === "dnb-xlsx", "Siste transaksjoner → dnb-xlsx");
assert(await detectFormat(`${FINANCE_DIR}/SAS Mastercard/transactions-08.02.2026-to-31.12.2024.xlsx`) === "sas-xlsx", "SAS transactions → sas-xlsx");

// ── DNB .txt Parser ─────────────────────────────────────────────

console.log("\n📄 DNB .txt — Kortet");
const kortetTxs = parseDnbTxt(`${FINANCE_DIR}/DNB/Kortet.txt`);
assert(kortetTxs.length > 0, `Parsed ${kortetTxs.length} transactions`);
assert(kortetTxs[0].date.match(/^\d{4}-\d{2}-\d{2}$/) !== null, `Date format: ${kortetTxs[0].date}`);
const expenses = kortetTxs.filter(t => t.amount < 0);
const incomes = kortetTxs.filter(t => t.amount > 0);
assert(expenses.length > 0, `${expenses.length} expenses`);
assert(incomes.length > 0, `${incomes.length} incomes`);
console.log(`    Sample: ${kortetTxs[0].date} | ${kortetTxs[0].amount} | ${kortetTxs[0].description}`);

console.log("\n📄 DNB .txt — Saga Gull Mastercard");
const sagaTxs = parseDnbTxt(`${FINANCE_DIR}/DNB/Saga Gull Mastercard.txt`);
assert(sagaTxs.length > 0, `Parsed ${sagaTxs.length} transactions`);
console.log(`    Sample: ${sagaTxs[0].date} | ${sagaTxs[0].amount} | ${sagaTxs[0].description}`);

// ── DNB .xlsx Parser ────────────────────────────────────────────

console.log("\n📊 DNB .xlsx — Siste transaksjoner");
const dnbXlsxTxs = await parseDnbXlsx(`${FINANCE_DIR}/DNB/Siste transaksjoner .xlsx`);
assert(dnbXlsxTxs.length > 100, `Parsed ${dnbXlsxTxs.length} transactions`);
assert(dnbXlsxTxs[0].date.match(/^\d{4}-\d{2}-\d{2}$/) !== null, `Date format: ${dnbXlsxTxs[0].date}`);
// Check date parsing is reasonable (year should be 2025 or 2026)
const years = new Set(dnbXlsxTxs.map(t => parseInt(t.date.slice(0, 4))));
assert(years.has(2025) || years.has(2026), `Years: ${[...years].join(", ")}`);
console.log(`    Sample: ${dnbXlsxTxs[0].date} | ${dnbXlsxTxs[0].amount} | ${dnbXlsxTxs[0].description}`);

// ── SAS Mastercard .xlsx Parser ─────────────────────────────────

console.log("\n💳 SAS Mastercard .xlsx");
const sasTxs = await parseSasXlsx(`${FINANCE_DIR}/SAS Mastercard/transactions-08.02.2026-to-31.12.2024.xlsx`);
assert(sasTxs.length > 50, `Parsed ${sasTxs.length} transactions`);
const foreignTxs = sasTxs.filter(t => t.foreign_currency);
assert(foreignTxs.length > 0, `${foreignTxs.length} foreign currency transactions`);
const currencies = new Set(foreignTxs.map(t => t.foreign_currency));
assert(currencies.size >= 2, `Currencies: ${[...currencies].join(", ")}`);
// Should NOT contain INNBETALING BANKGIRO
const payments = sasTxs.filter(t => t.description.includes("INNBETALING"));
assert(payments.length === 0, `Filtered out ${payments.length} payment rows (should be 0)`);
console.log(`    Sample: ${sasTxs[0].date} | ${sasTxs[0].amount} | ${sasTxs[0].description}`);
if (foreignTxs[0]) console.log(`    Foreign: ${foreignTxs[0].date} | ${foreignTxs[0].amount} NOK (${foreignTxs[0].foreign_amount} ${foreignTxs[0].foreign_currency}) | ${foreignTxs[0].description}`);

// ── Full Import (dry run) ───────────────────────────────────────

// ── Full Import (real) ──────────────────────────────────────────

console.log("\n🏦 Full Import (real)");
const realResults = await importBankDirectory(store, FINANCE_DIR);
const totalReal = realResults.reduce((s, r) => s + r.imported, 0);
const totalCategorized = realResults.reduce((s, r) => s + r.categorized, 0);
assert(totalReal > 100, `Imported ${totalReal} transactions`);
assert(totalCategorized > 0, `Auto-categorized ${totalCategorized} transactions`);
for (const r of realResults) {
	console.log(`    ${r.account_name}: ${r.imported} imported, ${r.categorized} categorized${r.errors.length > 0 ? `, ${r.errors.length} errors` : ""}`);
}

// Verify accounts were created (should be 3: Kortet xlsx, Saga xlsx, Siste xlsx, SAS xlsx)
const accounts = await store.getAccounts();
assert(accounts.length >= 3, `${accounts.length} accounts created`);
for (const a of accounts) {
	console.log(`    🏦 ${a.name} (${a.account_type}): ${a.balance.toLocaleString("nb-NO")} NOK`);
}

// ── Re-import (duplicate detection) ─────────────────────────────
// All transactions should be skipped — including cases where the same
// amount+date appears multiple times (e.g., 3 beers at same bar).

console.log("\n🔁 Re-import (duplicate detection)");
const reResults = await importBankDirectory(store, FINANCE_DIR);
const reImported = reResults.reduce((s, r) => s + r.imported, 0);
const reSkipped = reResults.reduce((s, r) => s + r.skipped, 0);
assert(reImported === 0, `Re-import: ${reImported} new (expected 0)`);
assert(reSkipped === totalReal, `Re-import: ${reSkipped} skipped (expected ${totalReal})`);

console.log(`\n${"═".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(40)}`);

closeDb();
fs.unlinkSync(TEST_DB);
process.exit(failed > 0 ? 1 : 0);
