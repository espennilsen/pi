import * as os from "node:os";
import * as path from "node:path";
import { SettingsManager, getAgentDir } from "@mariozechner/pi-coding-agent";

export interface CrossProjectConfig {
	rootDir: string;
	maxDepth: number;
}

interface TdWebuiSettings {
	crossProjectRoot?: string;
	crossProjectDepth?: number;
}

function expandHomeDir(value: string): string {
	if (value === "~") return os.homedir();
	if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
	return value;
}

function loadTdWebuiSettings(cwd: string): TdWebuiSettings {
	const settingsManager = SettingsManager.create(cwd, getAgentDir());
	const globalSettings = settingsManager.getGlobalSettings() as Record<string, any>;
	const projectSettings = settingsManager.getProjectSettings() as Record<string, any>;
	const globalTd = (globalSettings?.tdWebui ?? {}) as TdWebuiSettings;
	const projectTd = (projectSettings?.tdWebui ?? {}) as TdWebuiSettings;
	return { ...globalTd, ...projectTd };
}

export function getCrossProjectConfig(cwd = process.cwd()): CrossProjectConfig | null {
	const settings = loadTdWebuiSettings(cwd);
	const root = typeof settings.crossProjectRoot === "string" ? settings.crossProjectRoot.trim() : "";
	if (!root) return null;
	const depthRaw = settings.crossProjectDepth;
	const maxDepth = Number.isFinite(depthRaw) ? Math.max(0, Math.floor(depthRaw)) : 1;
	return {
		rootDir: expandHomeDir(root),
		maxDepth,
	};
}
