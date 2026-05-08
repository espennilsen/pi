import type { PiSecretSettings, PolicyManifest, PolicySecretRule } from "./types.ts";

export class SecretPolicyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SecretPolicyError";
	}
}

/**
 * Conservative first-party policy manifest.
 *
 * The default is deny: an extension must have an entry here (or in SettingsManager
 * policy overrides) to access a secret. Cross-extension access is denied unless
 * a secret-specific allowRequesters list explicitly allows it.
 */
export const DEFAULT_POLICY_MANIFEST: PolicyManifest = {
	extensions: {
		"elevenlabs-extension": {
			secrets: ["api_key", "voice_id"],
			rawSecretAccess: ["api_key", "voice_id"],
		},
		"github-extension": {
			secrets: ["token"],
			rawSecretAccess: ["token"],
		},
	},
};

let activePolicyManifest: PolicyManifest = clonePolicy(DEFAULT_POLICY_MANIFEST);

export function configurePolicy(settings?: PiSecretSettings): PolicyManifest {
	activePolicyManifest = mergePolicy(DEFAULT_POLICY_MANIFEST, settings?.policy);
	return clonePolicy(activePolicyManifest);
}

export function getPolicyManifest(): PolicyManifest {
	return clonePolicy(activePolicyManifest);
}

export function listPolicySecrets(policy: PolicyManifest = activePolicyManifest): Array<{ extensionId: string; secretName: string }> {
	return Object.entries(policy.extensions).flatMap(([extensionId, rule]) =>
		rule.secrets.map((secretName) => ({ extensionId, secretName })),
	);
}

export function canAccessSecret(
	extensionId: string,
	secretName: string,
	requesterExtensionId: string,
	policy: PolicyManifest = activePolicyManifest,
): boolean {
	const rule = policy.extensions[extensionId];
	if (!rule || !rule.secrets.includes(secretName)) return false;
	if (requesterExtensionId === extensionId) return true;
	return rule.allowRequesters?.[secretName]?.includes(requesterExtensionId) === true;
}

export function canAccessRawSecret(
	extensionId: string,
	secretName: string,
	requesterExtensionId: string,
	policy: PolicyManifest = activePolicyManifest,
): boolean {
	if (!canAccessSecret(extensionId, secretName, requesterExtensionId, policy)) return false;
	const rule = policy.extensions[extensionId];
	return rule?.rawSecretAccess?.includes(secretName) === true;
}

export function assertCanAccessSecret(
	extensionId: string,
	secretName: string,
	requesterExtensionId: string,
	policy: PolicyManifest = activePolicyManifest,
): void {
	if (!canAccessSecret(extensionId, secretName, requesterExtensionId, policy)) {
		throw new SecretPolicyError(
			`Access denied: requester "${requesterExtensionId}" is not allowed to access "${extensionId}" secret "${secretName}"`,
		);
	}
}

export function assertCanAccessRawSecret(
	extensionId: string,
	secretName: string,
	requesterExtensionId: string,
	policy: PolicyManifest = activePolicyManifest,
): void {
	if (!canAccessRawSecret(extensionId, secretName, requesterExtensionId, policy)) {
		throw new SecretPolicyError(
			`Raw secret access denied: requester "${requesterExtensionId}" is not trusted for "${extensionId}" secret "${secretName}"`,
		);
	}
}

export function assertSecretIsManaged(
	extensionId: string,
	secretName: string,
	policy: PolicyManifest = activePolicyManifest,
): void {
	const rule = policy.extensions[extensionId];
	if (!rule || !rule.secrets.includes(secretName)) {
		throw new SecretPolicyError(`Secret is not declared in pi-secret policy: "${extensionId}" / "${secretName}"`);
	}
}

export function validateIdentifier(value: string, label: string): string {
	const trimmed = value.trim();
	if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
		throw new SecretPolicyError(`${label} must contain only letters, numbers, underscores, dots, or dashes`);
	}
	return trimmed;
}

function mergePolicy(base: PolicyManifest, override?: Partial<PolicyManifest>): PolicyManifest {
	const merged = clonePolicy(base);
	if (!override?.extensions || typeof override.extensions !== "object") return merged;

	for (const [extensionId, incomingRule] of Object.entries(override.extensions)) {
		if (!incomingRule) continue;
		const current: PolicySecretRule = merged.extensions[extensionId] ?? { secrets: [] };
		merged.extensions[extensionId] = {
			secrets: mergeStrings(current.secrets, incomingRule.secrets),
			allowRequesters: mergeAllowRequesters(current.allowRequesters, incomingRule.allowRequesters),
			rawSecretAccess: mergeStrings(current.rawSecretAccess ?? [], incomingRule.rawSecretAccess),
		};
	}

	return merged;
}

function mergeStrings(base: string[], incoming?: string[]): string[] {
	if (!Array.isArray(incoming)) return [...base];
	return [...new Set([...base, ...incoming.filter((value): value is string => typeof value === "string")])];
}

function mergeAllowRequesters(
	base?: Record<string, string[]>,
	incoming?: Record<string, string[]>,
): Record<string, string[]> | undefined {
	const result: Record<string, string[]> = {};
	for (const [secret, requesters] of Object.entries(base ?? {})) {
		result[secret] = [...requesters];
	}
	for (const [secret, requesters] of Object.entries(incoming ?? {})) {
		if (!Array.isArray(requesters)) continue;
		result[secret] = mergeStrings(result[secret] ?? [], requesters);
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

function clonePolicy(policy: PolicyManifest): PolicyManifest {
	return {
		extensions: Object.fromEntries(
			Object.entries(policy.extensions).map(([extensionId, rule]) => [
				extensionId,
				{
					secrets: [...rule.secrets],
					allowRequesters: rule.allowRequesters
						? Object.fromEntries(Object.entries(rule.allowRequesters).map(([name, requesters]) => [name, [...requesters]]))
						: undefined,
					rawSecretAccess: rule.rawSecretAccess ? [...rule.rawSecretAccess] : undefined,
				},
			]),
		),
	};
}
