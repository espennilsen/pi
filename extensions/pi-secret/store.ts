import { deletePassword, getKeyring, getPassword, initBackend, setPassword } from "cross-keychain";
import { FallbackSecretStore } from "./fallback-store.ts";
import { PI_SECRET_SERVICE, type SecretBackend } from "./types.ts";
import { validateIdentifier } from "./policy.ts";

export interface SecretStoreOptions {
	fallbackFile?: string;
	allowFallback?: boolean;
}

export interface SecretReadResult {
	value: string | null;
	backend?: SecretBackend;
}

export class SecretStoreError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SecretStoreError";
	}
}

/**
 * Storage broker for pi-secret.
 *
 * The preferred backend is the OS keychain through cross-keychain. We explicitly
 * exclude cross-keychain's file/null backends so the only file fallback is our
 * audited, fixed-location fallback store under ~/.pi/agents/secret.json.
 */
export class SecretStore {
	private readonly fallbackStore: FallbackSecretStore;
	private readonly allowFallback: boolean;
	private readonly cache = new Map<string, string>();
	private keychainState: "unknown" | "available" | "unavailable" = "unknown";

	constructor(options: SecretStoreOptions = {}) {
		this.fallbackStore = new FallbackSecretStore(options.fallbackFile);
		this.allowFallback = options.allowFallback ?? true;
	}

	accountFor(extensionId: string, secretName: string): string {
		const safeExtensionId = validateIdentifier(extensionId, "extensionId");
		const safeSecretName = validateIdentifier(secretName, "secretName");
		return `ext:${safeExtensionId}:secret:${safeSecretName}`;
	}

	async setSecret(extensionId: string, secretName: string, value: string): Promise<SecretBackend> {
		const account = this.accountFor(extensionId, secretName);
		if (typeof value !== "string" || value.length === 0) {
			throw new SecretStoreError("Secret value must be a non-empty string");
		}

		try {
			await this.withKeychain(async () => setPassword(PI_SECRET_SERVICE, account, value));
			this.cache.set(account, value);
			await this.fallbackStore.delete(account).catch(() => undefined);
			return "keychain";
		} catch (error) {
			if (!this.allowFallback) throw sanitizedStoreError("OS keychain write failed and fallback is disabled", error);
			await this.fallbackStore.set(account, value);
			this.cache.set(account, value);
			return "fallback";
		}
	}

	async getSecret(extensionId: string, secretName: string): Promise<SecretReadResult> {
		const account = this.accountFor(extensionId, secretName);
		if (this.cache.has(account)) {
			return { value: this.cache.get(account) ?? null };
		}

		try {
			const keychainValue = await this.withKeychain(async () => getPassword(PI_SECRET_SERVICE, account));
			if (keychainValue !== null) {
				this.cache.set(account, keychainValue);
				return { value: keychainValue, backend: "keychain" };
			}
		} catch (error) {
			if (!this.allowFallback) throw sanitizedStoreError("OS keychain read failed and fallback is disabled", error);
		}

		if (!this.allowFallback) return { value: null };
		const fallbackValue = await this.fallbackStore.get(account);
		if (fallbackValue !== null) this.cache.set(account, fallbackValue);
		return { value: fallbackValue, backend: fallbackValue === null ? undefined : "fallback" };
	}

	async hasSecret(extensionId: string, secretName: string): Promise<boolean> {
		return (await this.getSecret(extensionId, secretName)).value !== null;
	}

	async deleteSecret(extensionId: string, secretName: string): Promise<SecretBackend | "both" | undefined> {
		const account = this.accountFor(extensionId, secretName);
		this.cache.delete(account);
		let deletedKeychain = false;
		let deletedFallback = false;

		try {
			await this.withKeychain(async () => deletePassword(PI_SECRET_SERVICE, account));
			deletedKeychain = true;
		} catch {
			// Exceptions indicate keychain backend/permission failures. Continue with fallback cleanup.
		}

		if (this.allowFallback) {
			await this.fallbackStore.delete(account);
			deletedFallback = true;
		}

		if (deletedKeychain && deletedFallback) return "both";
		if (deletedKeychain) return "keychain";
		if (deletedFallback) return "fallback";
		return undefined;
	}

	get fallbackFilePath(): string {
		return this.fallbackStore.filePath;
	}

	private async withKeychain<T>(fn: () => Promise<T>): Promise<T> {
		await this.ensureKeychain();
		return fn();
	}

	private async ensureKeychain(): Promise<void> {
		if (this.keychainState === "available") return;
		if (this.keychainState === "unavailable") {
			throw new SecretStoreError("OS keychain is unavailable");
		}

		try {
			await initBackend((backend) => !["file", "null"].includes(backend.id));
			const backend = await getKeyring();
			if (["file", "null"].includes(backend.id)) {
				throw new SecretStoreError("cross-keychain selected a non-keychain backend");
			}
			this.keychainState = "available";
		} catch (error) {
			this.keychainState = "unavailable";
			throw sanitizedStoreError("OS keychain is unavailable", error);
		}
	}
}

export function sanitizedStoreError(message: string, cause: unknown): SecretStoreError {
	const detail = cause instanceof Error ? redactSensitiveText(cause.message) : "unknown error";
	return new SecretStoreError(`${message}: ${detail}`);
}

export function redactSensitiveText(input: string): string {
	return input
		.replace(/(password|secret|token|api[_-]?key)=([^\s,;]+)/gi, "$1=<redacted>")
		.replace(/sk-[A-Za-z0-9_-]{8,}/g, "<redacted>")
		.replace(/[A-Za-z0-9_\-]{32,}/g, "<redacted>");
}
