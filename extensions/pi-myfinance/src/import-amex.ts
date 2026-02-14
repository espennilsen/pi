/**
 * pi-myfinance — American Express .xlsx parser.
 *
 * Format: Header rows 0–5 (card info), row 6 = column headers, row 7+ = data.
 * Columns: Dato, Beskrivelse, Beløp, Utvidede detaljer, Opptrer på din
 *          kontoutskrift som, Adresse, Sted, Postnummer, Land, Referanse
 *
 * Dates: MM/DD/YYYY. Amounts in NOK.
 *   - Positive = expense (purchase/charge)
 *   - Negative + "BETALING MOTTATT - TAKK" = transfer (bill payment)
 *   - Negative + other = refund/credit (income)
 *
 * Foreign currency info in "Utvidede detaljer" field.
 */

import type { BankTransaction } from "./import-types.ts";
import { parseNumericValue, parseNorwegianNumber, parseDateValue } from "./import-types.ts";

export async function parseAmexXlsx(filePath: string): Promise<BankTransaction[]> {
	const readXlsxFile = (await import("read-excel-file/node")).default;
	const rows = await readXlsxFile(filePath);

	const txs: BankTransaction[] = [];

	// Find header row (contains "Dato", "Beskrivelse", "Beløp")
	let headerIdx = -1;
	for (let i = 0; i < Math.min(rows.length, 15); i++) {
		const first = String(rows[i]?.[0] ?? "").trim();
		const second = String(rows[i]?.[1] ?? "").trim();
		if (first === "Dato" && second === "Beskrivelse") {
			headerIdx = i;
			break;
		}
	}
	if (headerIdx === -1) return txs;

	for (let i = headerIdx + 1; i < rows.length; i++) {
		const row = rows[i];
		if (!row || row.length < 3) continue;

		const dateRaw = row[0];
		const description = String(row[1] ?? "").trim();
		const nokAmount = row[2] != null ? parseNumericValue(row[2]) : 0;
		const extendedDetails = String(row[3] ?? "").trim();

		if (!dateRaw || !description) continue;

		const date = parseDateValue(dateRaw);
		if (!date) continue;

		// Clean description: collapse extra whitespace
		const cleanDesc = description.replace(/\s{2,}/g, " ").trim();

		// Parse foreign currency from extended details
		let foreignAmount: number | undefined;
		let foreignCurrency: string | undefined;
		if (extendedDetails) {
			const fxMatch = extendedDetails.match(
				/Foreign Spend Amount:\s*([\d.,]+)\s+([A-Z][A-Z\s]+?)(?:\s+Commission)/,
			);
			if (fxMatch) {
				foreignAmount = parseNorwegianNumber(fxMatch[1]);
				foreignCurrency = fxMatch[2].trim();
			}
		}

		// Sign convention: positive on file = charge (out), negative = payment/credit (in)
		// "BETALING MOTTATT - TAKK" (negative) → bill payment → in
		// Other negative (e.g. FLYSAS refund) → credit → in
		// Positive → purchase → out
		const tx: BankTransaction = {
			date,
			description: cleanDesc,
			amount: nokAmount > 0 ? -nokAmount : Math.abs(nokAmount),
			currency: "NOK",
		};

		if (foreignCurrency && foreignAmount) {
			tx.foreign_amount = foreignAmount;
			tx.foreign_currency = foreignCurrency;
		}

		txs.push(tx);
	}

	return txs;
}
