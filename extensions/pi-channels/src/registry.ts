/**
 * pi-channels — Adapter registry + route resolution.
 */

import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { ChannelAdapter, ChannelMessage, AdapterConfig, ChannelConfig, AdapterDirection, OnIncomingMessage, IncomingMessage } from "./types.ts";
import { createTelegramAdapter } from "./adapters/telegram.ts";
import { createWebhookAdapter } from "./adapters/webhook.ts";
import { createSlackAdapter } from "./adapters/slack.ts";

// ── Built-in adapter factories ──────────────────────────────────

export type AdapterLogger = (event: string, data: Record<string, unknown>, level?: string) => void;

export interface AdapterFactoryContext {
	cwd?: string;
	log?: AdapterLogger;
	modelRegistry?: ModelRegistry;
}

type AdapterFactory = (config: AdapterConfig, context: AdapterFactoryContext) => Promise<ChannelAdapter>;

const builtinFactories: Record<string, AdapterFactory> = {
	telegram: createTelegramAdapter,
	webhook: createWebhookAdapter,
	slack: createSlackAdapter,
};

// ── Registry ────────────────────────────────────────────────────

export class ChannelRegistry {
	private adapters = new Map<string, ChannelAdapter>();
	private routes = new Map<string, { adapter: string; recipient: string }>();
	private errors: Array<{ adapter: string; error: string }> = [];
	private onIncoming: OnIncomingMessage = () => {};
	private log?: AdapterLogger;
	private modelRegistry?: ModelRegistry;

	/**
	 * Set the callback for incoming messages (called by the extension entry).
	 */
	setOnIncoming(cb: OnIncomingMessage): void {
		this.onIncoming = cb;
	}

	/**
	 * Set the logger for adapter error reporting.
	 */
	setLogger(log: AdapterLogger): void {
		this.log = log;
	}

	/**
	 * Set the model registry for API key resolution.
	 */
	setModelRegistry(modelRegistry: ModelRegistry): void {
		this.modelRegistry = modelRegistry;
	}

	/**
	 * Load adapters + routes from config. Custom adapters (registered via events) are preserved.
	 * @param cwd — working directory, passed to adapter factories for settings resolution.
	 */
	async loadConfig(config: ChannelConfig, cwd?: string): Promise<void> {
		this.errors = [];

		// Stop existing adapters
		for (const adapter of this.adapters.values()) {
			adapter.stop?.();
		}

		// Preserve custom adapters (prefixed with "custom:")
		const custom = new Map<string, ChannelAdapter>();
		for (const [name, adapter] of this.adapters) {
			if (name.startsWith("custom:")) custom.set(name, adapter);
		}
		this.adapters = custom;

		// Load routes
		this.routes.clear();
		if (config.routes) {
			for (const [alias, target] of Object.entries(config.routes)) {
				this.routes.set(alias, target);
			}
		}

		// Create adapters from config
		for (const [name, adapterConfig] of Object.entries(config.adapters)) {
			const factory = builtinFactories[adapterConfig.type];
			if (!factory) {
				this.errors.push({ adapter: name, error: `Unknown adapter type: ${adapterConfig.type}` });
				continue;
			}
			try {
				const adapter = await factory(adapterConfig, {
					cwd,
					log: this.log,
					modelRegistry: this.modelRegistry,
				});
				this.adapters.set(name, adapter);
			} catch (err: any) {
				this.errors.push({ adapter: name, error: err.message });
			}
		}
	}

	/** Start all incoming/bidirectional adapters. */
	async startListening(): Promise<void> {
		for (const [name, adapter] of this.adapters) {
			if ((adapter.direction === "incoming" || adapter.direction === "bidirectional") && adapter.start) {
				try {
					await adapter.start((msg: IncomingMessage) => {
						this.onIncoming({ ...msg, adapter: name });
					});
				} catch (err: any) {
					this.errors.push({ adapter: name, error: `Failed to start: ${err.message}` });
				}
			}
		}
	}

	/** Sync bot commands on all adapters that support it. */
	async syncBotCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
		for (const [name, adapter] of this.adapters) {
			if (adapter.syncBotCommands) {
				try {
					await adapter.syncBotCommands(commands);
				} catch (err: any) {
					this.errors.push({ adapter: name, error: `Failed to sync commands: ${err.message}` });
				}
			}
		}
	}

	/** Stop all adapters. */
	async stopAll(): Promise<void> {
		for (const adapter of this.adapters.values()) {
			await adapter.stop?.();
		}
	}

	/** Register a custom adapter (from another extension). */
	register(name: string, adapter: ChannelAdapter): void {
		this.adapters.set(name, adapter);
		// Auto-start if it receives
		if ((adapter.direction === "incoming" || adapter.direction === "bidirectional") && adapter.start) {
			adapter.start((msg: IncomingMessage) => {
				this.onIncoming({ ...msg, adapter: name });
			});
		}
	}

	/** Unregister an adapter. */
	unregister(name: string): boolean {
		const adapter = this.adapters.get(name);
		adapter?.stop?.();
		return this.adapters.delete(name);
	}

	/**
	 * Send a message. Resolves routes, validates adapter supports sending.
	 */
	async send(message: ChannelMessage): Promise<{ ok: boolean; error?: string }> {
		let adapterName = message.adapter;
		let recipient = message.recipient;

		// Check if this is a route alias
		const route = this.routes.get(adapterName);
		if (route) {
			adapterName = route.adapter;
			if (!recipient) recipient = route.recipient;
		}

		const adapter = this.adapters.get(adapterName);
		if (!adapter) {
			return { ok: false, error: `No adapter "${adapterName}"` };
		}

		if (adapter.direction === "incoming") {
			return { ok: false, error: `Adapter "${adapterName}" is incoming-only, cannot send` };
		}

		if (!adapter.send) {
			return { ok: false, error: `Adapter "${adapterName}" has no send method` };
		}

		try {
			await adapter.send({ ...message, adapter: adapterName, recipient });
			return { ok: true };
		} catch (err: any) {
			return { ok: false, error: err.message };
		}
	}

	/** List all registered adapters and route aliases. */
	list(): Array<{ name: string; type: "adapter" | "route"; direction?: AdapterDirection; target?: string }> {
		const result: Array<{ name: string; type: "adapter" | "route"; direction?: AdapterDirection; target?: string }> = [];
		for (const [name, adapter] of this.adapters) {
			result.push({ name, type: "adapter", direction: adapter.direction });
		}
		for (const [alias, target] of this.routes) {
			result.push({ name: alias, type: "route", target: `${target.adapter} → ${target.recipient}` });
		}
		return result;
	}

	getErrors(): Array<{ adapter: string; error: string }> {
		return [...this.errors];
	}

	/** Get an adapter by name (for direct access, e.g. typing indicators). */
	getAdapter(name: string): ChannelAdapter | undefined {
		return this.adapters.get(name);
	}
}
