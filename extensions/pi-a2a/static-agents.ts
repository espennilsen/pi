/**
 * pi-a2a — Static agent registry.
 *
 * Manages manually configured remote agents and their cached agent cards.
 * Agents are configured in settings.json under "pi-a2a.staticAgents".
 * Agent cards are fetched from /.well-known/agent-card.json on demand.
 */

import type { LogFn } from "./logger.ts";
import type { StaticAgentConfig } from "./types.ts";

/** A static agent entry with its cached agent card. */
export interface CachedStaticAgent {
	/** User-provided config. */
	config: StaticAgentConfig;
	/** Fetched agent card (null if not yet fetched or fetch failed). */
	card: Record<string, unknown> | null;
	/** When the card was last successfully fetched (epoch ms). */
	fetchedAt: number | null;
	/** Error message if the last fetch failed. */
	error?: string;
}

/** Result of a refresh operation. */
export interface RefreshResult {
	succeeded: number;
	failed: number;
	details: Array<{ name: string; ok: boolean; skillCount?: number; error?: string }>;
}

/**
 * Registry for manually configured A2A agents.
 *
 * Fetches and caches agent cards from remote endpoints.
 * Used by a2a_discover and a2a_send to resolve agents without a hub.
 */
export class StaticAgentRegistry {
	private agents = new Map<string, CachedStaticAgent>();
	private log: LogFn;

	constructor(log: LogFn) {
		this.log = log;
	}

	/** Load static agent configs. Clears any previous state. */
	configure(configs: StaticAgentConfig[]): void {
		this.agents.clear();
		for (const config of configs) {
			this.agents.set(config.name.toLowerCase(), {
				config,
				card: null,
				fetchedAt: null,
			});
		}
		this.log("static_agents_configured", { count: configs.length });
	}

	/** Fetch agent cards for all configured agents (in parallel). */
	async refreshAll(): Promise<RefreshResult> {
		const details: RefreshResult["details"] = [];
		let succeeded = 0;
		let failed = 0;

		const promises = Array.from(this.agents.values()).map(async (entry) => {
			const card = await fetchAgentCard(entry.config.url, this.log);
			if (card) {
				entry.card = card;
				entry.fetchedAt = Date.now();
				entry.error = undefined;
				const skills = extractSkills(card);
				details.push({ name: entry.config.name, ok: true, skillCount: skills.length });
				succeeded++;
			} else {
				entry.error = "Failed to fetch agent card";
				details.push({ name: entry.config.name, ok: false, error: entry.error });
				failed++;
			}
		});

		await Promise.all(promises);
		this.log("static_agents_refreshed", { succeeded, failed });
		return { succeeded, failed, details };
	}

	/** Fetch agent card for a single agent by name. */
	async refresh(name: string): Promise<boolean> {
		const entry = this.agents.get(name.toLowerCase());
		if (!entry) return false;

		const card = await fetchAgentCard(entry.config.url, this.log);
		if (card) {
			entry.card = card;
			entry.fetchedAt = Date.now();
			entry.error = undefined;
			this.log("static_agent_refreshed", { name: entry.config.name, skills: extractSkills(card).length });
			return true;
		}

		entry.error = "Failed to fetch agent card";
		this.log("static_agent_refresh_failed", { name: entry.config.name }, "WARN");
		return false;
	}

	/** Get all static agents. */
	getAll(): CachedStaticAgent[] {
		return Array.from(this.agents.values());
	}

	/** Find a static agent by name (case-insensitive). */
	findByName(name: string): CachedStaticAgent | undefined {
		return this.agents.get(name.toLowerCase());
	}

	/** Find a static agent by URL (trailing-slash insensitive). */
	findByUrl(url: string): CachedStaticAgent | undefined {
		const normalized = url.replace(/\/+$/, "");
		for (const entry of this.agents.values()) {
			if (entry.config.url.replace(/\/+$/, "") === normalized) return entry;
		}
		return undefined;
	}

	/** Number of configured static agents. */
	get size(): number {
		return this.agents.size;
	}
}

/**
 * Fetch an A2A agent card from a remote endpoint.
 *
 * Tries the canonical path first (/.well-known/agent-card.json),
 * then falls back to the compat path (/.well-known/agent.json).
 */
async function fetchAgentCard(baseUrl: string, log: LogFn): Promise<Record<string, unknown> | null> {
	const base = baseUrl.replace(/\/+$/, "");
	const canonicalUrl = `${base}/.well-known/agent-card.json`;
	// Agent Cards are public discovery metadata. A static API key is reserved
	// for a later authenticated task request and must never be leaked here.
	const headers: Record<string, string> = { Accept: "application/json" };

	try {
		log("static_agent_card_fetch", { url: canonicalUrl });
		const res = await fetch(canonicalUrl, {
			signal: AbortSignal.timeout(10_000),
			headers,
		});

		if (res.ok) {
			const card = (await res.json()) as Record<string, unknown>;
			log("static_agent_card_fetched", { url: canonicalUrl, name: card.name });
			return card;
		}

		// Try compat endpoint
		const compatUrl = `${base}/.well-known/agent.json`;
		log("static_agent_card_fetch_compat", { url: compatUrl });
		const res2 = await fetch(compatUrl, {
			signal: AbortSignal.timeout(10_000),
			headers,
		});

		if (res2.ok) {
			const card = (await res2.json()) as Record<string, unknown>;
			log("static_agent_card_fetched", { url: compatUrl, name: card.name });
			return card;
		}

		log("static_agent_card_fetch_failed", { url: canonicalUrl, status: res.status, compatStatus: res2.status }, "WARN");
		return null;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log("static_agent_card_fetch_error", { url: canonicalUrl, error: msg }, "WARN");
		return null;
	}
}

/** Extract skills array from an agent card. */
export function extractSkills(card: Record<string, unknown>): Array<{ id?: string; name: string; description?: string; tags?: string[] }> {
	const skills = card.skills;
	if (!Array.isArray(skills)) return [];
	return skills.filter(
		(s): s is { name: string } => s != null && typeof s === "object" && typeof (s as Record<string, unknown>).name === "string",
	);
}
