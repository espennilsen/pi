/**
 * pi-projects — Settings loader.
 */

import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export interface ProjectsSettings {
	devDir: string;
	autoScan: boolean;
	dbPath: string;
	useKysely: boolean;
}

const DEFAULTS: ProjectsSettings = {
	devDir: path.join(os.homedir(), "Dev"),
	autoScan: true,
	dbPath: "projects/projects.db",
	useKysely: false,
};

function expandHome(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

export function resolveSettings(cwd: string): ProjectsSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const cfg = { ...(global?.["pi-projects"] ?? {}), ...(project?.["pi-projects"] ?? {}) };

		return {
			devDir: cfg.devDir ? expandHome(cfg.devDir) : DEFAULTS.devDir,
			autoScan: cfg.autoScan ?? DEFAULTS.autoScan,
			dbPath: cfg.dbPath ?? DEFAULTS.dbPath,
			useKysely: !!cfg.useKysely,
		};
	} catch {
		return { ...DEFAULTS };
	}
}
