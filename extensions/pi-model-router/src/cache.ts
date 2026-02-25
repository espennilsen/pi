/**
 * pi-model-router — Classification cache.
 *
 * In-memory LRU cache keyed by a hash of the prompt's first 500 chars.
 * Avoids repeated classifier calls for identical or near-identical prompts.
 */

import * as crypto from "node:crypto";
import type { Tier, CacheSettings } from "./settings.ts";

// ── Types ───────────────────────────────────────────────────────

interface CacheEntry {
	tier: Tier;
	timestamp: number;
}

// ── Cache ───────────────────────────────────────────────────────

export class ClassificationCache {
	private entries = new Map<string, CacheEntry>();
	private ttlMs: number;
	private maxEntries: number;
	private enabled: boolean;

	constructor(settings: CacheSettings) {
		this.enabled = settings.enabled && settings.maxEntries > 0;
		this.ttlMs = settings.ttlHours * 60 * 60 * 1000;
		this.maxEntries = settings.maxEntries;
	}

	/**
	 * Generate cache key from prompt text.
	 * Uses first 500 chars, normalized whitespace, hashed with SHA-256.
	 */
	private key(prompt: string): string {
		const normalized = prompt.slice(0, 500).replace(/\s+/g, " ").trim().toLowerCase();
		return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
	}

	/**
	 * Look up a cached classification.
	 * Returns null on miss or expired entry.
	 */
	get(prompt: string): Tier | null {
		if (!this.enabled) return null;

		const k = this.key(prompt);
		const entry = this.entries.get(k);
		if (!entry) return null;

		if (Date.now() - entry.timestamp > this.ttlMs) {
			this.entries.delete(k);
			return null;
		}

		// Re-insert to move to end of iteration order (true LRU)
		this.entries.delete(k);
		this.entries.set(k, entry);

		return entry.tier;
	}

	/**
	 * Store a classification result.
	 * Evicts oldest entry if at capacity.
	 */
	set(prompt: string, tier: Tier): void {
		if (!this.enabled) return;

		// Evict expired entry first, fall back to LRU
		if (this.entries.size >= this.maxEntries) {
			const now = Date.now();
			let evicted = false;
			for (const [k, v] of this.entries) {
				if (now - v.timestamp > this.ttlMs) {
					this.entries.delete(k);
					evicted = true;
					break;
				}
			}
			if (!evicted) {
				const oldestKey = this.entries.keys().next().value;
				if (oldestKey) this.entries.delete(oldestKey);
			}
		}

		this.entries.set(this.key(prompt), { tier, timestamp: Date.now() });
	}

	/** Number of cached entries. */
	get size(): number {
		return this.entries.size;
	}
}
