import {
	assertCanAccessRawSecret,
	assertCanAccessSecret,
	assertSecretIsManaged,
	configurePolicy,
	listPolicySecrets,
	SecretPolicyError,
} from "./policy.ts";
import { SecretStore } from "./store.ts";
import {
	PI_SECRET_SERVICE,
	type AuditEntry,
	type PiSecretApi,
	type PiSecretSettings,
	type SecretBackend,
	type SecretListItem,
	type SecretServiceClient,
} from "./types.ts";

const MAX_AUDIT_ENTRIES = 200;

export interface CreateSecretApiOptions {
	settings?: PiSecretSettings;
	store?: SecretStore;
}

export function createSecretApi(options: CreateSecretApiOptions = {}): PiSecretApi {
	const policy = configurePolicy(options.settings);
	const store = options.store ?? new SecretStore({
		allowFallback: options.settings?.allowFallback ?? true,
		fallbackFile: options.settings?.fallbackFile,
	});
	const auditLog: AuditEntry[] = [];

	function audit(entry: Omit<AuditEntry, "timestamp">): void {
		auditLog.push({ timestamp: new Date().toISOString(), ...entry });
		if (auditLog.length > MAX_AUDIT_ENTRIES) auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
	}

	function deny(extensionId: string, secretName: string, requesterExtensionId: string, reason: string): never {
		audit({ action: "denied", extensionId, secretName, requesterExtensionId, allowed: false, reason });
		throw new SecretPolicyError(reason);
	}

	const api: PiSecretApi = {
		service: PI_SECRET_SERVICE,

		async setSecret(extensionId, secretName, value) {
			assertSecretIsManaged(extensionId, secretName, policy);
			const backend = await store.setSecret(extensionId, secretName, value);
			audit({ action: "set", extensionId, secretName, backend, allowed: true });
		},

		async getSecret(extensionId, secretName, requesterExtensionId) {
			try {
				assertCanAccessRawSecret(extensionId, secretName, requesterExtensionId, policy);
			} catch (error) {
				const reason = error instanceof Error ? error.message : "Raw secret access denied";
				deny(extensionId, secretName, requesterExtensionId, reason);
			}
			const result = await store.getSecret(extensionId, secretName);
			if (result.value !== null) {
				audit({ action: "access", extensionId, secretName, requesterExtensionId, backend: result.backend, allowed: true });
			}
			return result.value;
		},

		async deleteSecret(extensionId, secretName) {
			assertSecretIsManaged(extensionId, secretName, policy);
			const backend = await store.deleteSecret(extensionId, secretName);
			audit({ action: "delete", extensionId, secretName, backend: normalizeDeleteBackend(backend), allowed: true });
		},

		async hasSecret(extensionId, secretName) {
			assertSecretIsManaged(extensionId, secretName, policy);
			return store.hasSecret(extensionId, secretName);
		},

		async withSecret(extensionId, secretName, requesterExtensionId, fn) {
			try {
				assertCanAccessSecret(extensionId, secretName, requesterExtensionId, policy);
			} catch (error) {
				const reason = error instanceof Error ? error.message : "Secret access denied";
				deny(extensionId, secretName, requesterExtensionId, reason);
			}
			const result = await store.getSecret(extensionId, secretName);
			if (result.value === null) return null;
			audit({ action: "access", extensionId, secretName, requesterExtensionId, backend: result.backend, allowed: true });
			try {
				return await fn(result.value);
			} catch (error) {
				throw sanitizedCallbackError(error);
			}
		},

		getServiceClient(extensionId, serviceName): SecretServiceClient {
			if (serviceName === "elevenlabs") {
				return {
					service: "elevenlabs",
					extensionId,
					withApiKey: (fn) => api.withSecret(extensionId, "api_key", extensionId, fn).then(requireSecret),
					withVoiceId: (fn) => api.withSecret(extensionId, "voice_id", extensionId, fn).then(requireSecret),
				};
			}
			if (serviceName === "github") {
				return {
					service: "github",
					extensionId,
					withToken: (fn) => api.withSecret(extensionId, "token", extensionId, fn).then(requireSecret),
				};
			}
			throw new SecretPolicyError(`Unsupported pi-secret service client: "${serviceName}"`);
		},

		async listSecrets(): Promise<SecretListItem[]> {
			const items = await Promise.all(
				listPolicySecrets(policy).map(async ({ extensionId, secretName }) => ({
					extensionId,
					secretName,
					present: await store.hasSecret(extensionId, secretName),
				})),
			);
			return items.sort((a, b) => `${a.extensionId}:${a.secretName}`.localeCompare(`${b.extensionId}:${b.secretName}`));
		},

		getAuditLog() {
			return auditLog.map((entry) => ({ ...entry }));
		},
	};

	return api;
}

export function installSecretRegistry(api: PiSecretApi): void {
	globalThis.__piSecret = api;
}

export function uninstallSecretRegistry(api: PiSecretApi): void {
	if (globalThis.__piSecret === api) globalThis.__piSecret = undefined;
}

function normalizeDeleteBackend(backend: SecretBackend | "both" | undefined): SecretBackend | undefined {
	return backend === "both" ? undefined : backend;
}

function requireSecret<T>(value: T | null): T {
	if (value === null) throw new SecretPolicyError("Required secret is not configured");
	return value;
}

function sanitizedCallbackError(error: unknown): Error {
	if (!(error instanceof Error)) return new Error("Secret callback failed");
	return new Error(
		error.message
			.replace(/(password|secret|token|api[_-]?key)=([^\s,;]+)/gi, "$1=<redacted>")
			.replace(/sk-[A-Za-z0-9_-]{8,}/g, "<redacted>")
			.replace(/[A-Za-z0-9_\-]{32,}/g, "<redacted>"),
	);
}
