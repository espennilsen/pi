/** Select the strongest Hub runtime authentication mode Pi can enforce. */

import type { AuthMode } from "./auth-types.ts";
import { getHubRuntimeAuthMetadata, introspectHubRuntimeToken, issueHubRuntimeCredential, parseUsableHubInstanceSession, type HubInstanceSession, type HubRuntimeAuthMetadata, type HubRuntimeCredential } from "./hub.ts";
import { createHubOAuthVerifier, type HubOAuthBinding } from "./hub-oauth-verifier.ts";
import type { OAuthVerifier } from "./inbound-auth.ts";
import type { LogFn } from "./logger.ts";
import type { HubConfig } from "./types.ts";

export interface HubRuntimeAuth {
	supportedModes: AuthMode[];
	credential?: string;
	verifyOAuth?: OAuthVerifier;
	managedOAuth: boolean;
	/** Atomically bind once, or rotate the session for the same logical agent. */
	activateRegistration(agentId: string, instanceSession: HubInstanceSession): boolean;
	/** Disable future introspections while retaining the one-shot agent binding. */
	deactivateRegistration(): void;
}

interface Dependencies {
	getMetadata?: (hub: HubConfig, log: LogFn) => Promise<HubRuntimeAuthMetadata>;
	issueCredential?: (hub: HubConfig, log: LogFn) => Promise<HubRuntimeCredential | null>;
	introspectToken?: (token: string, instanceSessionAccessToken: string) => Promise<boolean>;
}

export async function initializeHubRuntimeAuth(
	hub: HubConfig,
	instanceId: string,
	log: LogFn,
	dependencies: Dependencies = {},
): Promise<HubRuntimeAuth> {
	const getMetadata = dependencies.getMetadata ?? getHubRuntimeAuthMetadata;
	const metadata = await getMetadata(hub, log);
	if (metadata.mode === "oauth2") {
		const binding: HubOAuthBinding = { agentId: "", instanceId };
		let sessionAccessToken: string | undefined;
		let registrationGeneration = 0;
		const introspect = dependencies.introspectToken ?? ((token, session) => introspectHubRuntimeToken(token, session, hub, log));
		const verifyOAuth = createHubOAuthVerifier({
			...metadata,
			jwks: { keys: metadata.jwks.keys },
		}, binding, async (token) => {
			// Capture synchronously for this call so later rotation cannot change it.
			const capturedSession = sessionAccessToken;
			if (!capturedSession) return false;
			return introspect(token, capturedSession);
		}, () => String(registrationGeneration));
		return {
			supportedModes: ["oauth2"],
			verifyOAuth,
			managedOAuth: true,
			activateRegistration(agentId, instanceSession) {
				const validated = parseUsableHubInstanceSession(instanceSession);
				if (!agentId || !validated || (binding.agentId && binding.agentId !== agentId)) return false;
				binding.agentId = agentId;
				sessionAccessToken = validated.accessToken;
				registrationGeneration++;
				return true;
			},
			deactivateRegistration() {
				sessionAccessToken = undefined;
				registrationGeneration++;
			},
		};
	}

	const issueCredential = dependencies.issueCredential ?? issueHubRuntimeCredential;
	const fallback = await issueCredential(hub, log);
	if (!fallback || fallback.mode !== "legacy-api-key") {
		throw new Error("Hub did not provide enforceable OAuth metadata or a legacy runtime credential");
	}
	return {
		supportedModes: ["legacy-api-key"],
		credential: fallback.credential,
		managedOAuth: false,
		activateRegistration() { return true; },
		deactivateRegistration() {},
	};
}
