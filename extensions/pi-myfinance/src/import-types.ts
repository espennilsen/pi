/**
 * pi-myfinance — Shared types and helpers for bank import parsers.
 */

// ── Types ───────────────────────────────────────────────────────

export interface ImportResult {
	account_name: string;
	imported: number;
	skipped: number;
	errors: string[];
	categorized: number;
	linked: number;
}

export interface BankTransaction {
	date: string; // YYYY-MM-DD
	description: string; // Cleaned description (stored in DB)
	raw_description?: string; // Original before cleaning (for categorization fallback)
	amount: number; // Positive = in (money in), negative = out (money out)
	currency?: string;
	foreign_amount?: number;
	foreign_currency?: string;
}

// ── Parsing Helpers ─────────────────────────────────────────────

export function parseNorwegianNumber(value: string): number {
	// Norwegian format uses period as thousands separator and comma as decimal: "1.234,56"
	// Strip thousands separators (periods), then convert decimal comma to dot
	const cleaned = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
	return parseFloat(cleaned) || 0;
}

export function parseNumericValue(value: unknown): number {
	if (typeof value === "number") return value;
	if (value instanceof Date) return 0;
	const s = String(value).trim().replace(/\s/g, "");
	// Norwegian format: strip thousands periods, convert decimal comma to dot
	const cleaned = s.replace(/"/g, "").replace(/\./g, "").replace(",", ".");
	return parseFloat(cleaned) || 0;
}

export function parseDateValue(value: unknown): string | null {
	if (value instanceof Date) {
		const y = value.getFullYear();
		const m = String(value.getMonth() + 1).padStart(2, "0");
		const d = String(value.getDate()).padStart(2, "0");
		return `${y}-${m}-${d}`;
	}

	const s = String(value).trim();

	// YYYY-MM-DD
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

	// DD.MM.YYYY (Norwegian)
	const dotMatch = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
	if (dotMatch) return `${dotMatch[3]}-${dotMatch[2].padStart(2, "0")}-${dotMatch[1].padStart(2, "0")}`;

	// M/D/YY or M/D/YYYY (US format — used by DNB xlsx, Amex)
	const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
	if (usMatch) {
		let year = parseInt(usMatch[3]);
		if (year < 100) year += 2000;
		return `${year}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
	}

	return null;
}

export function normalizeDate(date: string): string {
	return parseDateValue(date) ?? date;
}
