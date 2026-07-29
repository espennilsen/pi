/**
 * pi-myfinance — Bank statement import orchestrator.
 *
 * Format detection, import-into-store logic, and re-exports.
 * Parsers live in separate files per bank:
 *   - import-dnb.ts   — DNB .txt and .xlsx
 *   - import-sas.ts   — SAS Mastercard .xlsx
 *   - import-amex.ts  — American Express .xlsx
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { FinanceStore, CreateTransactionData } from "./types.ts";
import { suggestCategory } from "./insights.ts";


// Re-export types
export type { ImportResult, BankTransaction } from "./import-types.ts";
export { parseDnbTxt, parseDnbXlsx } from "./import-dnb.ts";
export { parseSasXlsx } from "./import-sas.ts";
export { parseAmexXlsx } from "./import-amex.ts";

import type { ImportResult, BankTransaction } from "./import-types.ts";
import { parseDnbTxt, parseDnbXlsx } from "./import-dnb.ts";
import { parseSasXlsx } from "./import-sas.ts";
import { parseAmexXlsx } from "./import-amex.ts";

// ── Format Detection ────────────────────────────────────────────

export type BankFormat = "dnb-txt" | "dnb-xlsx" | "sas-xlsx" | "amex-xlsx" | "unknown";

/** Quick detection from file name alone (fallback). */
export function detectFormatByName(filePath: string): BankFormat {
	const ext = path.extname(filePath).toLowerCase();
	const basename = path.basename(filePath).toLowerCase();

	if (ext === ".txt") return "dnb-txt";
	if (ext === ".xlsx") {
		if (basename.includes("aktivitet") || basename.includes("amex") || basename.includes("american")) return "amex-xlsx";
		if (basename.includes("transaction") || basename.includes("sas")) return "sas-xlsx";
		return "dnb-xlsx";
	}
	return "unknown";
}

/** Content-aware format detection — peeks at xlsx content to identify the bank. */
export async function detectFormat(filePath: string): Promise<BankFormat> {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === ".txt") return "dnb-txt";
	if (ext !== ".xlsx") return "unknown";

	try {
		const readXlsxFile = (await import("read-excel-file/node")).default;
		const rows = await readXlsxFile(filePath);
		if (rows.length === 0) return "unknown";

		const firstCell = String(rows[0]?.[0] ?? "").trim();
		const secondCell = String(rows[0]?.[1] ?? "").trim();

		// Amex: first row is "Transaksjonsdetaljer" + mentions "American Express"
		if (firstCell === "Transaksjonsdetaljer" && secondCell.includes("American Express")) {
			return "amex-xlsx";
		}

		// SAS Mastercard: has "Dato" + "Spesifikasjon" header somewhere
		for (let i = 0; i < Math.min(rows.length, 10); i++) {
			if (String(rows[i]?.[0] ?? "").trim() === "Dato" && String(rows[i]?.[2] ?? "").trim() === "Spesifikasjon") {
				return "sas-xlsx";
			}
		}

		// DNB xlsx: first row starts with "Dato"
		if (firstCell === "Dato") return "dnb-xlsx";

		return detectFormatByName(filePath);
	} catch {
		return detectFormatByName(filePath);
	}
}

// ── Import into Store ───────────────────────────────────────────

export async function importBankFile(
	store: FinanceStore,
	filePath: string,
	accountName: string,
	options?: { dryRun?: boolean; skipDuplicates?: boolean },
): Promise<ImportResult> {
	const format = await detectFormat(filePath);
	let transactions: BankTransaction[];

	switch (format) {
		case "dnb-txt":
			transactions = parseDnbTxt(filePath);
			break;
		case "dnb-xlsx":
			transactions = await parseDnbXlsx(filePath);
			break;
		case "sas-xlsx":
			transactions = await parseSasXlsx(filePath);
			break;
		case "amex-xlsx":
			transactions = await parseAmexXlsx(filePath);
			break;
		default:
			return { account_name: accountName, imported: 0, skipped: 0, errors: [`Unknown format: ${path.basename(filePath)}`], categorized: 0, linked: 0 };
	}

	// Find or create account
	let account = (await store.getAccounts()).find((a) => a.name === accountName);
	if (!account) {
		const nameLower = accountName.toLowerCase();
		const isCreditCard = nameLower.includes("mastercard") || nameLower.includes("credit")
			|| nameLower.includes("amex") || nameLower.includes("american express");
		account = await store.createAccount({
			name: accountName,
			account_type: isCreditCard ? "credit" : "checking",
			currency: "NOK",
		});
	}

	// Duplicate detection: compare against existing DB records.
	// Key = date|amount|type. Track counts so identical-looking transactions
	// (e.g. 3 beers same day same amount) all import on first run.
	const existingTxs = options?.skipDuplicates !== false
		? await store.getTransactions({ account_id: account.id, limit: 100000 })
		: [];
	const existingCounts = new Map<string, number>();
	for (const t of existingTxs) {
		const key = `${t.date}|${t.amount}|${t.transaction_type}`;
		existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
	}
	const matchedCounts = new Map<string, number>();

	const result: ImportResult = {
		account_name: accountName,
		imported: 0,
		skipped: 0,
		errors: [],
		categorized: 0,
		linked: 0,
	};

	const importedTxIds: number[] = [];

	for (const tx of transactions) {
		try {
			// Derive type from sign: positive = in, negative = out
			const txType: "in" | "out" = tx.amount >= 0 ? "in" : "out";

			// Duplicate check
			const key = `${tx.date}|${Math.abs(tx.amount)}|${txType}`;
			const dbCount = existingCounts.get(key) ?? 0;
			const matched = matchedCounts.get(key) ?? 0;
			if (matched < dbCount) {
				matchedCounts.set(key, matched + 1);
				result.skipped++;
				continue;
			}

			if (options?.dryRun) {
				result.imported++;
				continue;
			}

			// Auto-categorize (try cleaned description first, fall back to raw)
			const match = await suggestCategory(store, tx.description)
				?? (tx.raw_description ? await suggestCategory(store, tx.raw_description) : null);
			const categoryId = match?.category_id;
			if (categoryId) result.categorized++;

			// Foreign currency note
			let notes: string | undefined;
			if (tx.foreign_currency && tx.foreign_amount) {
				notes = `Original: ${tx.foreign_amount} ${tx.foreign_currency}`;
			}

			const data: CreateTransactionData = {
				account_id: account.id,
				amount: Math.abs(tx.amount),
				transaction_type: txType,
				description: tx.description,
				date: tx.date,
				category_id: categoryId,
				notes,
			};

			const created = await store.createTransaction(data);
			importedTxIds.push(created.id);
			result.imported++;
		} catch (err: any) {
			result.errors.push(`${tx.date} "${tx.description}": ${err.message}`);
		}
	}

	// Auto-link transfers: match newly imported transactions against
	// existing unlinked transactions on other accounts (same amount, ±3 days)
	if (!options?.dryRun && importedTxIds.length > 0) {
		for (const txId of importedTxIds) {
			try {
				const tx = await store.getTransaction(txId);
				if (!tx || tx.linked_transaction_id) continue;
				const matches = await store.findTransferMatches(txId, 1);
				if (matches.length > 0) {
					const ok = await store.linkTransactions(txId, matches[0].id);
					if (ok) result.linked++;
				}
			} catch { /* skip linking errors */ }
		}
	}

	return result;
}

// ── Import from Buffer (web upload) ─────────────────────────────

/**
 * Import a bank file from an in-memory buffer (uploaded via web UI).
 * Writes to a temp file, imports, then cleans up.
 */
export async function importBankFileFromBuffer(
	store: FinanceStore,
	buffer: Buffer,
	fileName: string,
	accountId: number,
	options?: { dryRun?: boolean; skipDuplicates?: boolean },
): Promise<ImportResult> {
	const account = await store.getAccount(accountId);
	if (!account) {
		return { account_name: "Unknown", imported: 0, skipped: 0, errors: ["Account not found"], categorized: 0, linked: 0 };
	}

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fin-"));
	const tmpFile = path.join(tmpDir, fileName);
	try {
		fs.writeFileSync(tmpFile, buffer);
		return await importBankFile(store, tmpFile, account.name, options);
	} finally {
		try { fs.unlinkSync(tmpFile); } catch {}
		try { fs.rmdirSync(tmpDir); } catch {}
	}
}

// ── Import All Files in a Directory ─────────────────────────────

export async function importBankDirectory(
	store: FinanceStore,
	dirPath: string,
	options?: { dryRun?: boolean },
): Promise<ImportResult[]> {
	const results: ImportResult[] = [];

	const entries = fs.readdirSync(dirPath, { withFileTypes: true });

	const files: { path: string; accountName: string }[] = [];

	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);

		if (entry.isDirectory()) {
			const subResults = await importBankDirectory(store, fullPath, options);
			results.push(...subResults);
		} else if (entry.isFile()) {
			const ext = path.extname(entry.name).toLowerCase();
			if (ext !== ".txt" && ext !== ".xlsx") continue;
			if (entry.name.startsWith(".") || entry.name.startsWith("~$")) continue;

			const parentDir = path.basename(path.dirname(fullPath));
			const basename = path.basename(entry.name, ext).trim();
			const accountName = parentDir === "finance"
				? basename
				: `${parentDir} — ${basename}`;

			files.push({ path: fullPath, accountName });
		}
	}

	// Deduplicate: if both .txt and .xlsx exist for same account, prefer .xlsx
	const byAccount = new Map<string, { path: string; accountName: string }[]>();
	for (const f of files) {
		const key = f.accountName.replace(/ $/, "");
		if (!byAccount.has(key)) byAccount.set(key, []);
		byAccount.get(key)!.push(f);
	}

	const filteredFiles: { path: string; accountName: string }[] = [];
	for (const [, group] of byAccount) {
		if (group.length > 1) {
			const xlsx = group.find((f) => f.path.endsWith(".xlsx"));
			filteredFiles.push(xlsx ?? group[0]);
		} else {
			filteredFiles.push(group[0]);
		}
	}

	for (const f of filteredFiles) {
		const result = await importBankFile(store, f.path, f.accountName, options);
		results.push(result);
	}

	return results;
}
