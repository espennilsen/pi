import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { DatabaseDriver } from "./registry.ts";

export interface KyselyRuntimeSettings {
	defaultDatabaseName: string;
	defaultDriver: Exclude<DatabaseDriver, "custom">;
	defaultSqlitePath: string;
	defaultDatabaseUrl?: string;
	autoCreateDefault: boolean;
}

const FALLBACK_SETTINGS: KyselyRuntimeSettings = {
	defaultDatabaseName: "default",
	defaultDriver: "sqlite",
	defaultSqlitePath: "db/kysely.db",
	autoCreateDefault: true,
};

interface PiSettingsFile {
	kysely?: {
		databaseName?: string;
		driver?: "sqlite" | "postgres" | "mysql";
		sqlitePath?: string;
		databaseUrl?: string;
		autoCreateDefault?: boolean;
		// Legacy keys (still supported)
		defaultDatabaseName?: string;
		defaultDriver?: "sqlite" | "postgres" | "mysql";
		defaultSqlitePath?: string;
		defaultDatabaseUrl?: string;
	};
}

const PROJECT_CONFIG_DIR_NAME = ".pi";

function expandHomePath(input: string): string {
	if (input === "~") return homedir();
	if (input.startsWith("~/")) return join(homedir(), input.slice(2));
	return input;
}

function normalizePathSetting(value?: string): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function resolveSqlitePath(pathValue: string, baseDir: string): string {
	const expanded = expandHomePath(pathValue.trim());
	if (isAbsolute(expanded)) return expanded;
	return resolve(baseDir, expanded);
}

function readJsonIfExists(path: string): PiSettingsFile {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as PiSettingsFile;
	} catch {
		return {};
	}
}

export function loadKyselySettings(cwd: string): KyselyRuntimeSettings {
	const globalAgentDir = getAgentDir();
	const globalPath = join(globalAgentDir, "settings.json");
	const projectConfigDir = join(cwd, PROJECT_CONFIG_DIR_NAME);
	const projectPath = join(projectConfigDir, "settings.json");

	const globalSettings = readJsonIfExists(globalPath).kysely ?? {};
	const projectSettings = readJsonIfExists(projectPath).kysely ?? {};

	const projectDriver = projectSettings.driver ?? projectSettings.defaultDriver;
	const globalDriver = globalSettings.driver ?? globalSettings.defaultDriver;
	const defaultDriver = projectDriver ?? globalDriver ?? FALLBACK_SETTINGS.defaultDriver;

	const projectDatabaseUrl = projectSettings.databaseUrl ?? projectSettings.defaultDatabaseUrl;
	const globalDatabaseUrl = globalSettings.databaseUrl ?? globalSettings.defaultDatabaseUrl;
	const defaultDatabaseUrl = projectDatabaseUrl ?? globalDatabaseUrl;

	const projectSqlitePath = normalizePathSetting(projectSettings.sqlitePath ?? projectSettings.defaultSqlitePath);
	const globalSqlitePath = normalizePathSetting(globalSettings.sqlitePath ?? globalSettings.defaultSqlitePath);
	const sqlitePathBase = projectSqlitePath ? projectConfigDir : globalAgentDir;
	const resolvedSqlitePath = resolveSqlitePath(
		projectSqlitePath ?? globalSqlitePath ?? FALLBACK_SETTINGS.defaultSqlitePath,
		sqlitePathBase,
	);

	const projectDatabaseName = projectSettings.databaseName ?? projectSettings.defaultDatabaseName;
	const globalDatabaseName = globalSettings.databaseName ?? globalSettings.defaultDatabaseName;

	return {
		defaultDatabaseName: projectDatabaseName ?? globalDatabaseName ?? FALLBACK_SETTINGS.defaultDatabaseName,
		defaultDriver,
		defaultSqlitePath: resolvedSqlitePath,
		defaultDatabaseUrl,
		autoCreateDefault:
			projectSettings.autoCreateDefault ?? globalSettings.autoCreateDefault ?? FALLBACK_SETTINGS.autoCreateDefault,
	};
}
