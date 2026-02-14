import * as os from "node:os";
import * as path from "node:path";
import { SettingsManager, getAgentDir } from "@mariozechner/pi-coding-agent";

export interface CrossProjectConfig {
	rootDir: string;
	maxDepth: number;
}

export interface TdSettings {
	/** Enable the web dashboard UI (default: true). */
	webui: boolean;
	crossProjectRoot?: string;
	crossProjectDepth?: number;
}

const DEFAULTS: TdSettings = {
	webui: true,
};

function expandHomeDir(value: string): string {
	if (value === "~") return os.homedir();
	if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
	return value;
}

export function loadTdSettings(cwd: string): TdSettings {
	try {
		const settingsManager = SettingsManager.create(cwd, getAgentDir());
		const globalSettings = settingsManager.getGlobalSettings() as Record<string, any>;
		const projectSettings = settingsManager.getProjectSettings() as Record<string, any>;
		// Support both "pi-td" (new) and "tdWebui" (legacy) keys
		const globalTd = (globalSettings?.["pi-td"] ?? globalSettings?.tdWebui ?? {}) as Record<string, any>;
		const projectTd = (projectSettings?.["pi-td"] ?? projectSettings?.tdWebui ?? {}) as Record<string, any>;
		const cfg = { ...globalTd, ...projectTd };
		return {
			webui: cfg.webui ?? DEFAULTS.webui,
			crossProjectRoot: cfg.crossProjectRoot,
			crossProjectDepth: cfg.crossProjectDepth,
		};
	} catch {
		return { ...DEFAULTS };
	}
}

export function getCrossProjectConfig(cwd = process.cwd()): CrossProjectConfig | null {
	const settings = loadTdSettings(cwd);
	const root = typeof settings.crossProjectRoot === "string" ? settings.crossProjectRoot.trim() : "";
	if (!root) return null;
	const depthRaw = settings.crossProjectDepth;
	const maxDepth = depthRaw != null && Number.isFinite(depthRaw) ? Math.max(0, Math.floor(depthRaw)) : 1;
	return {
		rootDir: expandHomeDir(root),
		maxDepth,
	};
}
