export const PI_SECRET_SERVICE = "com.earendil.pi-secret" as const;
export const DEFAULT_FALLBACK_PATH = "~/.pi/agents/secret.json" as const;

export type SecretBackend = "keychain" | "fallback";
export type AuditAction = "set" | "delete" | "access" | "denied";

export interface AuditEntry {
	timestamp: string;
	action: AuditAction;
	extensionId: string;
	secretName: string;
	requesterExtensionId?: string;
	backend?: SecretBackend;
	allowed: boolean;
	reason?: string;
}

export interface PolicySecretRule {
	/** Secret names this extension owns and may use. */
	secrets: string[];
	/** Requester extension ids allowed to read each named secret across extension boundaries. */
	allowRequesters?: Record<string, string[]>;
	/** Secret names that may be exposed as plaintext to trusted host-side extension code. */
	rawSecretAccess?: string[];
}

export interface PolicyManifest {
	extensions: Record<string, PolicySecretRule>;
}

export interface PiSecretSettings {
	/** Disable fallback writes if you prefer keychain-only operation. Defaults to true. */
	allowFallback?: boolean;
	/** Optional path for fallback storage. Must remain outside the project cwd. */
	fallbackFile?: string;
	/** Optional policy additions/overrides loaded through Pi SettingsManager. */
	policy?: Partial<PolicyManifest>;
}

export interface SecretListItem {
	extensionId: string;
	secretName: string;
	present: boolean;
}

export interface ElevenLabsServiceClient {
	readonly service: "elevenlabs";
	readonly extensionId: string;
	withApiKey<T>(fn: (apiKey: string) => T | Promise<T>): Promise<T>;
	withVoiceId<T>(fn: (voiceId: string) => T | Promise<T>): Promise<T>;
}

export interface GitHubServiceClient {
	readonly service: "github";
	readonly extensionId: string;
	withToken<T>(fn: (token: string) => T | Promise<T>): Promise<T>;
}

export type SecretServiceClient = ElevenLabsServiceClient | GitHubServiceClient;

export interface PiSecretApi {
	readonly service: typeof PI_SECRET_SERVICE;
	setSecret(extensionId: string, secretName: string, value: string): Promise<void>;
	getSecret(extensionId: string, secretName: string, requesterExtensionId: string): Promise<string | null>;
	deleteSecret(extensionId: string, secretName: string): Promise<void>;
	hasSecret(extensionId: string, secretName: string): Promise<boolean>;
	withSecret<T>(
		extensionId: string,
		secretName: string,
		requesterExtensionId: string,
		fn: (value: string) => T | Promise<T>,
	): Promise<T | null>;
	getServiceClient(extensionId: string, serviceName: string): SecretServiceClient;
	listSecrets(): Promise<SecretListItem[]>;
	getAuditLog(): AuditEntry[];
}

declare global {
	// Host-side registry used by trusted first-party Pi extensions. This is not an LLM tool.
	// eslint-disable-next-line no-var
	var __piSecret: PiSecretApi | undefined;
}
