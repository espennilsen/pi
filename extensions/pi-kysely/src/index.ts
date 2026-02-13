import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createLogger } from "./logger.ts";
import { wireKyselyEvents } from "./events.ts";
import {
	clearDatabases,
	configureDefaults,
	createMySqlDatabase,
	createPostgresDatabase,
	createSqliteDatabase,
	getDatabase,
	getDefaultDatabaseName,
	getDefaultSqlitePath,
	listDatabases,
	unregisterDatabase,
} from "./registry.ts";
import { loadKyselySettings } from "./settings.ts";

export * from "./table-api.ts";
export * from "./schema.ts";
export type { KyselyAck } from "./events.ts";

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	wireKyselyEvents(pi, log);

	pi.registerCommand("kysely", {
		description: "Manage shared Kysely database registry: /kysely [status|close <name>|close-all]",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "status", label: "status — List registered databases" },
				{ value: "close", label: "close <name> — Unregister and destroy a database" },
				{ value: "close-all", label: "close-all — Unregister and destroy all databases" },
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

			if (cmd !== "status") {
				ctx.ui.notify("Usage: /kysely [status|close <name>|close-all]", "warning");
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
		configureDefaults({
			databaseName: settings.defaultDatabaseName,
			sqlitePath: settings.defaultSqlitePath,
		});

		try {
			if (!settings.autoCreateDefault) {
				ctx.ui.notify("kysely auto-create default is disabled by settings", "info");
				pi.events.emit("kysely:ready", {});
				return;
			}

			if (getDatabase(settings.defaultDatabaseName)) {
				pi.events.emit("kysely:ready", {});
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
		pi.events.emit("kysely:ready", {});
	});

	pi.on("session_shutdown", async () => {
		await clearDatabases({ destroy: true });
	});
}
