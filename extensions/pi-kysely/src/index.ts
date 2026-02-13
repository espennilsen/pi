import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createLogger } from "./logger.ts";
import { wireKyselyEvents } from "./events.ts";
import {
	clearDatabases,
	configureDefaults,
	createMySqlDatabase,
	createPostgresDatabase,
	createSqliteDatabase,
	type DatabaseDriver,
	getDatabase,
	getDefaultDatabaseName,
	getDefaultSqlitePath,
	listDatabases,
	requireDatabase,
	unregisterDatabase,
} from "./registry.ts";
import { loadKyselySettings } from "./settings.ts";
import { getMigrationStatus } from "./migrations.ts";

export * from "./table-api.ts";
export * from "./schema.ts";
export * from "./migrations.ts";
export type { KyselyAck } from "./events.ts";
export type { QueryInput, QueryResult } from "./table-api.ts";

/** Payload emitted with kysely:ready and returned by kysely:info */
export interface KyselyReadyPayload {
	databases: Array<{ name: string; driver: DatabaseDriver }>;
	defaultDatabase: string;
	defaultDriver: string;
}

let activeDefaultDriver: string = "sqlite";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	wireKyselyEvents(pi, log);

	// ── kysely:info — on-demand database info query ───────────
	pi.events.on("kysely:info", (payload: unknown) => {
		const data = payload as {
			reply?: (info: KyselyReadyPayload) => void;
		};
		data.reply?.({
			databases: listDatabases().map((d) => ({
				name: d.name,
				driver: d.driver,
			})),
			defaultDatabase: getDefaultDatabaseName(),
			defaultDriver: activeDefaultDriver,
		});
	});

	pi.registerCommand("kysely", {
		description: "Manage shared Kysely database registry: /kysely [status|close <name>|close-all]",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "status", label: "status — List registered databases" },
				{ value: "close", label: "close <name> — Unregister and destroy a database" },
				{ value: "close-all", label: "close-all — Unregister and destroy all databases" },
				{ value: "migrations", label: "migrations [actor] — List applied migrations" },
			];
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const input = (args ?? "").trim();
			const [cmd, ...rest] = input.length ? input.split(/\s+/) : ["status"];

			if (cmd === "close") {
				const name = rest.join(" ").trim();
				if (!name) {
					ctx.ui.notify("Usage: /kysely close <name>", "warning");
					return;
				}
				const ok = await unregisterDatabase(name, { destroy: true });
				ctx.ui.notify(ok ? `Closed database: ${name}` : `No database named \"${name}\"`, ok ? "info" : "warning");
				return;
			}

			if (cmd === "close-all") {
				await clearDatabases({ destroy: true });
				ctx.ui.notify("Closed all registered databases", "info");
				return;
			}

			if (cmd === "migrations") {
				try {
					const actor = rest.join(" ").trim() || undefined;
					const db = requireDatabase();
					const records = await getMigrationStatus(db, actor);
					if (records.length === 0) {
						ctx.ui.notify(actor ? `No migrations for ${actor}` : "No migrations applied", "info");
						return;
					}
					let msg = `Applied migrations (${records.length}):`;
					for (const r of records) {
						msg += `\n  ${r.actor} / ${r.name}  (${r.applied_at})  [${r.checksum}]`;
					}
					ctx.ui.notify(msg, "info");
				} catch (err: any) {
					ctx.ui.notify(`Error: ${err.message}`, "warning");
				}
				return;
			}

			if (cmd !== "status") {
				ctx.ui.notify("Usage: /kysely [status|close <name>|close-all|migrations [actor]]", "warning");
				return;
			}

			const dbs = listDatabases();
			if (dbs.length === 0) {
				ctx.ui.notify("No databases registered", "info");
				return;
			}

			let msg = `Registered databases (${dbs.length}):`;
			for (const db of dbs) {
				msg += `\n  ${db.name} [${db.driver}]`;
				if (db.label) msg += ` — ${db.label}`;
				if (db.description) msg += ` (${db.description})`;
			}
			ctx.ui.notify(msg, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const settings = loadKyselySettings(ctx.cwd);
		activeDefaultDriver = settings.defaultDriver;
		configureDefaults({
			databaseName: settings.defaultDatabaseName,
			sqlitePath: settings.defaultSqlitePath,
		});

		/** Build the info payload for kysely:ready and kysely:info */
		function buildReadyPayload(): KyselyReadyPayload {
			return {
				databases: listDatabases().map((d) => ({
					name: d.name,
					driver: d.driver,
				})),
				defaultDatabase: getDefaultDatabaseName(),
				defaultDriver: settings.defaultDriver,
			};
		}

		try {
			if (!settings.autoCreateDefault) {
				ctx.ui.notify("kysely auto-create default is disabled by settings", "info");
				pi.events.emit("kysely:ready", buildReadyPayload());
				return;
			}

			if (getDatabase(settings.defaultDatabaseName)) {
				pi.events.emit("kysely:ready", buildReadyPayload());
				return;
			}

			if (settings.defaultDriver === "sqlite") {
				await createSqliteDatabase(settings.defaultDatabaseName, settings.defaultSqlitePath, {
					label: "Default SQLite",
					description: "Auto-created shared database",
				});
				ctx.ui.notify(
					`kysely default: ${getDefaultDatabaseName()} (sqlite at ${getDefaultSqlitePath()})`,
					"info",
				);
			} else if (settings.defaultDriver === "postgres") {
				if (!settings.defaultDatabaseUrl) {
					throw new Error("databaseUrl is required for driver=postgres");
				}
				await createPostgresDatabase(settings.defaultDatabaseName, settings.defaultDatabaseUrl, {
					label: "Default PostgreSQL",
					description: "Auto-created shared database",
				});
				ctx.ui.notify(`kysely default: ${settings.defaultDatabaseName} (postgres)`, "info");
			} else if (settings.defaultDriver === "mysql") {
				if (!settings.defaultDatabaseUrl) {
					throw new Error("databaseUrl is required for driver=mysql");
				}
				await createMySqlDatabase(settings.defaultDatabaseName, settings.defaultDatabaseUrl, {
					label: "Default MySQL",
					description: "Auto-created shared database",
				});
				ctx.ui.notify(`kysely default: ${settings.defaultDatabaseName} (mysql)`, "info");
			}
		} catch (err: any) {
			ctx.ui.notify(`kysely default database disabled: ${err.message}`, "warning");
			log("error", { message: err.message }, "ERROR");
		}

		log("ready", { defaultDb: settings.defaultDatabaseName, driver: settings.defaultDriver });
		pi.events.emit("kysely:ready", buildReadyPayload());
	});

	pi.on("session_shutdown", async () => {
		await clearDatabases({ destroy: true });
	});
}
