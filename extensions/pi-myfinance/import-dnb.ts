/**
 * pi-myfinance — DNB bank statement parsers.
 *
 * Handles two DNB export formats:
 *   1. DNB .txt  — semicolon-delimited, YYYY-MM-DD dates
 *   2. DNB .xlsx — main account export, M/D/YY dates
 */

import * as fs from "node:fs";
import type { BankTransaction } from "./import-types.ts";
import { parseNorwegianNumber, parseNumericValue, parseDateValue, normalizeDate } from "./import-types.ts";

// ── DNB .txt Parser ─────────────────────────────────────────────
// Format: "Dato";"Beskrivelse";"Rentedato";"Ut av konto";"Inn på konto"

export function parseDnbTxt(filePath: string): BankTransaction[] {
	const content = fs.readFileSync(filePath, "utf-8");
	const lines = content.trim().split("\n");
	if (lines.length < 2) return [];

	const txs: BankTransaction[] = [];

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;

		const fields = line.split(";").map((f) => f.replace(/^"|"$/g, "").trim());
		const [date, description, rentedato, utAvKonto, innPaaKonto] = fields;

		if (!date || !description) continue;

		// Skip pending transactions — no Rentedato means not finalized yet
		if (!rentedato || rentedato === "") continue;

		let amount = 0;
		if (utAvKonto && utAvKonto !== "") {
			amount = -Math.abs(parseNorwegianNumber(utAvKonto));
		} else if (innPaaKonto && innPaaKonto !== "") {
			amount = Math.abs(parseNorwegianNumber(innPaaKonto));
		}

		if (amount === 0) continue;

		txs.push({ date: normalizeDate(date), description: cleanDescription(description), amount });
	}

	return txs;
}

// ── DNB .xlsx Parser ────────────────────────────────────────────
// Format: Dato, Forklaring, Rentedato, Ut fra konto, Inn på konto
// Dates are M/D/YY (US format) or Date objects

export async function parseDnbXlsx(filePath: string): Promise<BankTransaction[]> {
	const readXlsxFile = (await import("read-excel-file/node")).default;
	const rows = await readXlsxFile(filePath);
	if (rows.length < 2) return [];

	const txs: BankTransaction[] = [];

	for (let i = 1; i < rows.length; i++) {
		const row = rows[i];
		if (!row || row.length < 4) continue;

		const dateRaw = row[0];
		const description = String(row[1] ?? "").trim();
		const rentedato = row[2];
		const utFraKonto = row[3];
		const innPaaKonto = row[4];

		if (!dateRaw || !description) continue;

		// Skip pending transactions
		if (rentedato == null || String(rentedato).trim() === "") continue;

		const date = parseDateValue(dateRaw);
		if (!date) continue;

		let amount = 0;
		if (utFraKonto != null && utFraKonto !== "") {
			amount = -Math.abs(parseNumericValue(utFraKonto));
		} else if (innPaaKonto != null && innPaaKonto !== "") {
			amount = Math.abs(parseNumericValue(innPaaKonto));
		}

		if (amount === 0) continue;

		txs.push({ date, description: cleanDescription(description), amount });
	}

	return txs;
}

// ── Helpers ─────────────────────────────────────────────────────

function cleanDescription(desc: string): string {
	let cleaned = desc;
	// Strip common DNB prefixes with reference numbers
	cleaned = cleaned.replace(/^Visa\s+\d[\d\s]*/i, "");
	cleaned = cleaned.replace(/^Nettgiro\s+(til|fra):?\s*\d*/i, "");
	cleaned = cleaned.replace(/^Giro\s+\d[\d\s]*/i, "");
	cleaned = cleaned.replace(/^Kontoregulering\s+\d[\d\s]*/i, "");
	// Preserve "Overføring" as a keyword — only strip the reference number after it
	cleaned = cleaned.replace(/^(Mobil\s+)?Overf[øo]ring\s+Innland\s+\d[\d\s]*/i, "Overføring ");
	cleaned = cleaned.replace(/^(Mobil\s+)?Overf[øo]ring\s+\d[\d\s]*/i, "Overføring ");
	cleaned = cleaned.replace(/^Vipps\s*\*\s*/i, "Vipps ");
	cleaned = cleaned.replace(/^(Kreditrente|Debetrente|Gebyr)\b/i, "$1");
	cleaned = cleaned.replace(/^Betaling\s+Reservert\s+transaksjon\s*/i, "");
	cleaned = cleaned.replace(/^Avtalegiro\s*/i, "");
	cleaned = cleaned.replace(/^Autogiro\s*/i, "");
	cleaned = cleaned.replace(/^Varekj[øo]p\s*/i, "");
	// Strip trailing noise
	cleaned = cleaned.replace(/\s+Tpp:\s+.*$/i, "");
	cleaned = cleaned.replace(/\s+Efaktura\s*$/i, "");
	cleaned = cleaned.replace(/\s+\d{4}\.\d{2}\.\d{2}\s*$/i, ""); // trailing dates
	cleaned = cleaned.replace(/\s+Kurs:?\s+[\d.,]+\s*$/i, ""); // trailing exchange rates
	cleaned = cleaned.replace(/\s+/g, " ").trim();
	return cleaned || desc;
}
