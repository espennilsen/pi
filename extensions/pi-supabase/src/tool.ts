/**
 * pi-supabase — Agent tool for read-only Supabase queries.
 *
 * Actions:
 *   - query:     Select rows from a table with filters, ordering, pagination
 *   - describe:  List columns and types for a table
 *   - tables:    List all tables in the public schema
 *   - count:     Count rows matching optional filters
 *   - rpc:       Call a Postgres function (read-only)
 *   - status:    Show connection status and subscription info
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { getClient, isClientReady } from "./client.ts";
import { isStoreReady, getStore } from "./store.ts";

const ACTIONS = ["query", "describe", "tables", "count", "rpc", "status"] as const;

function text(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: {} };
}

export function registerSupabaseTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "supabase",
		label: "Supabase",
		description:
			"Read-only access to Supabase database. " +
			"Actions: query (select rows with filters/ordering/pagination), " +
			"describe (table schema), tables (list all tables), " +
			"count (count rows), rpc (call an allow-listed Postgres function), " +
			"status (connection info).",
		parameters: Type.Object({
			action: StringEnum(ACTIONS, {
				description: "Operation to perform",
			}),
			table: Type.Optional(
				Type.String({ description: "Table name (for query/describe/count)" }),
			),
			columns: Type.Optional(
				Type.String({ description: "Comma-separated column names to select (default: all)" }),
			),
			filters: Type.Optional(
				Type.Array(
					Type.Object({
						column: Type.String({ description: "Column name" }),
						operator: Type.String({ description: "Filter operator: eq, neq, gt, gte, lt, lte, like, ilike, is, in" }),
						value: Type.Any({ description: "Filter value" }),
					}),
					{ description: "Array of filters to apply" },
				),
			),
			order_by: Type.Optional(
				Type.String({ description: "Column to order by" }),
			),
			order_desc: Type.Optional(
				Type.Boolean({ description: "Order descending (default: false)" }),
			),
			limit: Type.Optional(
				Type.Number({ description: "Max rows to return (default: 50, max: 1000)" }),
			),
			offset: Type.Optional(
				Type.Number({ description: "Offset for pagination" }),
			),
			function_name: Type.Optional(
				Type.String({ description: "Postgres function name (for rpc action)" }),
			),
			function_args: Type.Optional(
				Type.Any({ description: "Arguments object for the rpc function" }),
			),
		}),
		async execute(_toolCallId, params, _signal) {
			if (!isClientReady()) {
				return text("❌ Supabase not configured. Add url and anonKey to settings under \"pi-supabase\".");
			}

			const start = Date.now();

			try {
				switch (params.action) {
					case "query":
						return await handleQuery(params, start);
					case "describe":
						return await handleDescribe(params, start);
					case "tables":
						return await handleTables(start);
					case "count":
						return await handleCount(params, start);
					case "rpc":
						return await handleRpc(params, start);
					case "status":
						return handleStatus();
					default:
						return text(`Unknown action: ${(params as any).action}`);
				}
			} catch (err: any) {
				return text(`❌ Supabase error: ${err.message}`);
			}
		},
	});
}

// ── Handlers ────────────────────────────────────────────────────

async function handleQuery(params: any, start: number) {
	if (!params.table) return text("❌ 'table' is required for query action");

	const client = getClient();
	const limit = Math.min(params.limit ?? 50, 1000);
	const columns = params.columns ?? "*";

	let query = client.from(params.table).select(columns);

	// Apply filters
	if (params.filters) {
		query = applyFilters(query, params.filters);
	}

	// Ordering
	if (params.order_by) {
		query = query.order(params.order_by, { ascending: !params.order_desc });
	}

	// Pagination
	query = query.range(params.offset ?? 0, (params.offset ?? 0) + limit - 1);

	const { data, error } = await query;
	const durationMs = Date.now() - start;

	if (error) return text(`❌ Query error: ${error.message}`);

	const rows = data ?? [];
	await logQueryIfReady(params.table, "query", summarizeFilters(params.filters), rows.length, durationMs);

	if (rows.length === 0) {
		return text(`No rows found in \`${params.table}\` matching filters.`);
	}

	const lines = [
		`**${params.table}** — ${rows.length} row${rows.length !== 1 ? "s" : ""} (${durationMs}ms)`,
		"",
		formatRows(rows),
	];

	return text(lines.join("\n"));
}

async function handleDescribe(params: any, start: number) {
	if (!params.table) return text("❌ 'table' is required for describe action");

	const client = getClient();

	// Use information_schema to describe the table
	const { data: cols, error: colErr } = await client
		.from("information_schema.columns" as any)
		.select("column_name, data_type, is_nullable, column_default")
		.eq("table_schema", "public")
		.eq("table_name", params.table)
		.order("ordinal_position" as any);

	const durationMs = Date.now() - start;

	if (colErr) {
		// Fallback: try selecting 0 rows to get column info from the response
		const { data: sample, error: sampleErr } = await client
			.from(params.table)
			.select("*")
			.limit(1);

		if (sampleErr) return text(`❌ Cannot describe table: ${sampleErr.message}`);

		const keys = sample && sample.length > 0 ? Object.keys(sample[0]) : [];
		if (keys.length === 0) return text(`Table \`${params.table}\` exists but has no rows to infer schema from.`);

		const lines = [
			`**${params.table}** — ${keys.length} columns (inferred from data)`,
			"",
			...keys.map(k => `- \`${k}\``),
		];
		return text(lines.join("\n"));
	}

	const columns = cols ?? [];
	await logQueryIfReady(params.table, "describe", "", columns.length, durationMs);

	const lines = [
		`**${params.table}** — ${columns.length} columns`,
		"",
		"| Column | Type | Nullable | Default |",
		"|--------|------|----------|---------|",
		...columns.map((c: any) =>
			`| \`${c.column_name}\` | ${c.data_type} | ${c.is_nullable} | ${c.column_default ?? "—"} |`
		),
	];

	return text(lines.join("\n"));
}

async function handleTables(start: number) {
	const client = getClient();

	const { data, error } = await client
		.from("information_schema.tables" as any)
		.select("table_name")
		.eq("table_schema", "public")
		.eq("table_type", "BASE TABLE")
		.order("table_name" as any);

	const durationMs = Date.now() - start;

	if (error) {
		return text(`❌ Cannot list tables: ${error.message}`);
	}

	const tables = data ?? [];
	await logQueryIfReady("information_schema", "tables", "", tables.length, durationMs);

	if (tables.length === 0) {
		return text("No tables found in public schema.");
	}

	const lines = [
		`**Public tables** — ${tables.length} found (${durationMs}ms)`,
		"",
		...tables.map((t: any) => `- \`${t.table_name}\``),
	];

	return text(lines.join("\n"));
}

async function handleCount(params: any, start: number) {
	if (!params.table) return text("❌ 'table' is required for count action");

	const client = getClient();
	let query = client.from(params.table).select("*", { count: "exact", head: true });

	if (params.filters) {
		query = applyFilters(query, params.filters);
	}

	const { count, error } = await query;
	const durationMs = Date.now() - start;

	if (error) return text(`❌ Count error: ${error.message}`);

	await logQueryIfReady(params.table, "count", summarizeFilters(params.filters), count ?? 0, durationMs);

	return text(`**${params.table}** — ${count ?? 0} row${count !== 1 ? "s" : ""} (${durationMs}ms)`);
}

/**
 * RPC allow-list. Only explicitly approved functions can be called.
 * To allow a function, add it to "pi-supabase.rpc.allowList" in settings,
 * or pass it here. Empty list = all RPC calls blocked.
 */
let rpcAllowList: Set<string> = new Set();

export function setRpcAllowList(functions: string[]): void {
	rpcAllowList = new Set(functions.map(f => f.toLowerCase()));
}

async function handleRpc(params: any, start: number) {
	if (!params.function_name) return text("❌ 'function_name' is required for rpc action");

	const fnLower = params.function_name.toLowerCase();
	if (rpcAllowList.size === 0) {
		return text("❌ Read-only mode: no RPC functions are allowed. Configure `pi-supabase.rpc.allowList` in settings to permit specific functions.");
	}
	if (!rpcAllowList.has(fnLower)) {
		return text(`❌ Read-only mode: '${params.function_name}' is not in the RPC allow-list. Allowed: ${[...rpcAllowList].join(", ")}`);
	}

	const client = getClient();
	const { data, error } = await client.rpc(params.function_name, params.function_args ?? {});
	const durationMs = Date.now() - start;

	if (error) return text(`❌ RPC error: ${error.message}`);

	await logQueryIfReady(params.function_name, "rpc", "", Array.isArray(data) ? data.length : 1, durationMs);

	if (data === null || data === undefined) {
		return text(`**${params.function_name}()** — returned null (${durationMs}ms)`);
	}

	if (Array.isArray(data)) {
		return text([
			`**${params.function_name}()** — ${data.length} row${data.length !== 1 ? "s" : ""} (${durationMs}ms)`,
			"",
			formatRows(data),
		].join("\n"));
	}

	return text(`**${params.function_name}()** (${durationMs}ms)\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
}

function handleStatus() {
	const ready = isClientReady();
	if (!ready) {
		return text("Supabase: ❌ Not configured");
	}
	return text("Supabase: ✅ Connected");
}

// ── Helpers ─────────────────────────────────────────────────────

const VALID_OPERATORS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in"]);

function applyFilters(query: any, filters: any[]): any {
	for (const f of filters) {
		if (!VALID_OPERATORS.has(f.operator)) {
			throw new Error(`Unknown filter operator: '${f.operator}'. Valid: ${[...VALID_OPERATORS].join(", ")}`);
		}
		switch (f.operator) {
			case "eq":    query = query.eq(f.column, f.value); break;
			case "neq":   query = query.neq(f.column, f.value); break;
			case "gt":    query = query.gt(f.column, f.value); break;
			case "gte":   query = query.gte(f.column, f.value); break;
			case "lt":    query = query.lt(f.column, f.value); break;
			case "lte":   query = query.lte(f.column, f.value); break;
			case "like":  query = query.like(f.column, f.value); break;
			case "ilike": query = query.ilike(f.column, f.value); break;
			case "is":    query = query.is(f.column, f.value); break;
			case "in":
				if (!Array.isArray(f.value)) throw new Error(`Filter 'in' on column '${f.column}' requires an array value, got ${typeof f.value}`);
				query = query.in(f.column, f.value);
				break;
		}
	}
	return query;
}

function summarizeFilters(filters: any[] | undefined): string {
	if (!filters || filters.length === 0) return "";
	return filters.map(f => `${f.column} ${f.operator} ${JSON.stringify(f.value)}`).join(", ");
}

function formatRows(rows: any[]): string {
	if (rows.length === 0) return "_No rows_";

	// Markdown table
	const keys = Object.keys(rows[0]);
	const header = `| ${keys.map(k => `\`${k}\``).join(" | ")} |`;
	const sep = `| ${keys.map(() => "---").join(" | ")} |`;
	const body = rows.slice(0, 50).map(row =>
		`| ${keys.map(k => {
			const v = row[k];
			if (v === null || v === undefined) return "—";
			const s = typeof v === "object" ? JSON.stringify(v) : String(v);
			return s.length > 80 ? s.slice(0, 77) + "…" : s;
		}).join(" | ")} |`
	);

	const lines = [header, sep, ...body];
	if (rows.length > 50) {
		lines.push(`\n_… and ${rows.length - 50} more rows_`);
	}

	return lines.join("\n");
}

async function logQueryIfReady(table: string, action: string, filterSummary: string, rowCount: number, durationMs: number): Promise<void> {
	if (!isStoreReady()) return;
	try {
		await getStore().logQuery({ table, action, filter_summary: filterSummary, row_count: rowCount, duration_ms: durationMs });
	} catch { /* ignore store errors */ }
}
