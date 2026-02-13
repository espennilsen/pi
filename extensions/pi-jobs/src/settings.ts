/**
 * pi-jobs — Settings loader.
 */

import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export interface JobsSettings {
	dbPath: string;
	useKysely: boolean;
}

const DEFAULT_DB_PATH = "jobs/jobs.db";

export function resolveSettings(cwd: string): JobsSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const cfg = { ...(global?.["pi-jobs"] ?? {}), ...(project?.["pi-jobs"] ?? {}) };

		return {
			dbPath: cfg.dbPath ?? DEFAULT_DB_PATH,
			useKysely: !!cfg.useKysely,
		};
	} catch {
		return { dbPath: DEFAULT_DB_PATH, useKysely: false };
	}
}
