/**
 * pi-myfinance — SAS Mastercard .xlsx parser.
 *
 * Complex multi-section format with multi-card support and exchange rate rows.
 * Sections: "Totalt andre hendelser" → payments, "Kjøp/uttak" → purchases
 * Header: Dato, Bokført, Spesifikasjon, Sted, Valuta, Utl. beløp, Beløp
 */

import type { BankTransaction } from "./import-types.ts";
import { parseNumericValue, parseDateValue } from "./import-types.ts";

export async function parseSasXlsx(filePath: string): Promise<BankTransaction[]> {
	const readXlsxFile = (await import("read-excel-file/node")).default;
	const rows = await readXlsxFile(filePath);

	const txs: BankTransaction[] = [];
	let inTransactionBlock = false;

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (!row || row.length === 0) continue;

		const firstCell = String(row[0] ?? "").trim();

		// Detect section headers
		if (firstCell === "Dato" && String(row[2] ?? "").trim() === "Spesifikasjon") {
			inTransactionBlock = true;
			continue;
		}

		// End of section
		if (firstCell === "Totalbeløp" || firstCell === "" && String(row[2] ?? "").includes("Saldo")) {
			inTransactionBlock = false;
			continue;
		}

		if (!inTransactionBlock) continue;

		// Skip noise rows
		if (firstCell.toLowerCase().startsWith("valutakurs")) continue;
		if (firstCell.includes("*")) continue;
		if (firstCell === "Kjøp/uttak") continue;

		// Parse: Dato, Bokført, Spesifikasjon, Sted, Valuta, Utl. beløp, Beløp
		const dateRaw = row[0];
		const description = String(row[2] ?? "").trim();
		const location = String(row[3] ?? "").trim();
		const currency = String(row[4] ?? "NOK").trim();
		const foreignAmount = row[5] != null ? parseNumericValue(row[5]) : 0;
		const nokAmount = row[6] != null ? parseNumericValue(row[6]) : 0;

		if (!dateRaw || !description) continue;

		const date = parseDateValue(dateRaw);
		if (!date) continue;

		// Annual fee
		if (description === "ÅRSKONTINGENT") {
			txs.push({
				date,
				description: "SAS Mastercard årsavgift",
				amount: -Math.abs(nokAmount),
				currency: "NOK",
			});
			continue;
		}

		// Sign convention: positive beløp = charge (out), negative = payment/credit (in)
		// Credit card bill payment (INNBETALING BANKGIRO) flows through naturally:
		//   negative on file → positive amount → "in"
		const amount = nokAmount > 0 ? -nokAmount : Math.abs(nokAmount);
		const fullDesc = location ? `${description}, ${location}` : description;

		const tx: BankTransaction = {
			date,
			description: fullDesc,
			amount,
			currency: "NOK",
		};

		if (currency !== "NOK" && foreignAmount !== 0) {
			tx.foreign_amount = foreignAmount;
			tx.foreign_currency = currency;
		}

		txs.push(tx);
	}

	return txs;
}
