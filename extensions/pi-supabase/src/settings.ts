/**
 * pi-supabase — Settings loader.
 *
 * Settings in settings.json under "pi-supabase":
 * {
 *   "pi-supabase": {
 *     "url": "https://xxx.supabase.co",
 *     "anonKey": "eyJ...",
 *     "serviceRoleKey": "eyJ...",
 *     "useServiceRole": false,
 *     "useKysely": false,
 *     "notifications": {
 *       "enabled": false,
 *       "route": "ops",
 *       "tables": ["users", "orders"]
 *     }
 *   }
 * }
 */

import { getAgentDir, SettingsManager } from "@mariozechner/pi-coding-agent";

export interface NotificationSettings {
	/** Enable pi-channels notifications for table changes (default: false). */
	enabled: boolean;
	/** pi-channels route to send notifications to (default: "ops"). */
	route: string;
	/** Tables to subscribe to for realtime changes. Empty = none. */
	tables: string[];
}

export interface RpcSettings {
	/** Explicit allow-list of RPC function names. Empty = all blocked. */
	allowList: string[];
}

export interface SupabaseSettings {
	/** Supabase project URL. */
	url: string | null;
	/** Supabase anon/public key. */
	anonKey: string | null;
	/** Supabase service role key (optional, for elevated access). */
	serviceRoleKey: string | null;
	/** Use service role key instead of anon key (default: false). */
	useServiceRole: boolean;
	/** Use pi-kysely shared DB for local cache/state (default: false). */
	useKysely: boolean;
	/** Notification settings for table change events. */
	notifications: NotificationSettings;
	/** RPC settings. */
	rpc: RpcSettings;
}

const DEFAULTS: SupabaseSettings = {
	url: null,
	anonKey: null,
	serviceRoleKey: null,
	useServiceRole: false,
	useKysely: false,
	notifications: {
		enabled: false,
		route: "ops",
		tables: [],
	},
	rpc: {
		allowList: [],
	},
};

export function resolveSettings(cwd: string): SupabaseSettings {
	try {
		const agentDir = getAgentDir();
		const sm = SettingsManager.create(cwd, agentDir);
		const global = sm.getGlobalSettings() as Record<string, any>;
		const project = sm.getProjectSettings() as Record<string, any>;
		const cfg = { ...(global?.["pi-supabase"] ?? {}), ...(project?.["pi-supabase"] ?? {}) };

		const notifications = cfg.notifications ?? {};
		const rpc = cfg.rpc ?? {};

		return {
			url: cfg.url ?? DEFAULTS.url,
			anonKey: cfg.anonKey ?? DEFAULTS.anonKey,
			serviceRoleKey: cfg.serviceRoleKey ?? DEFAULTS.serviceRoleKey,
			useServiceRole: cfg.useServiceRole ?? DEFAULTS.useServiceRole,
			useKysely: cfg.useKysely ?? DEFAULTS.useKysely,
			notifications: {
				enabled: notifications.enabled ?? DEFAULTS.notifications.enabled,
				route: notifications.route ?? DEFAULTS.notifications.route,
				tables: Array.isArray(notifications.tables) ? notifications.tables : DEFAULTS.notifications.tables,
			},
			rpc: {
				allowList: Array.isArray(rpc.allowList) ? rpc.allowList : DEFAULTS.rpc.allowList,
			},
		};
	} catch {
		return { ...DEFAULTS, notifications: { ...DEFAULTS.notifications }, rpc: { ...DEFAULTS.rpc } };
	}
}
