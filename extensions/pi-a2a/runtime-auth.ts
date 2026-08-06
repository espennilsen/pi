/** Select the strongest Hub runtime authentication mode Pi can enforce. */

import type { AuthMode } from "./auth-types.ts";
import { getHubRuntimeAuthMetadata, introspectHubRuntimeToken, issueHubRuntimeCredential, type HubRuntimeAuthMetadata, type HubRuntimeCredential } from "./hub.ts";
import { createHubOAuthVerifier, type HubOAuthBinding } from "./hub-oauth-verifier.ts";
import type { OAuthVerifier } from "./inbound-auth.ts";
import type { LogFn } from "./logger.ts";
import type { HubConfig } from "./types.ts";

export interface HubRuntimeAuth {
	supportedModes: AuthMode[];
	credential?: string;
	verifyOAuth?: OAuthVerifier;
	managedOAuth: boolean;
	binding?: HubOAuthBinding;
	bindAgent(agentId: string): void;
}

interface Dependencies {
	getMetadata?: (hub: HubConfig, log: LogFn) => Promise<HubRuntimeAuthMetadata>;
	issueCredential?: (hub: HubConfig, log: LogFn) => Promise<HubRuntimeCredential | null>;
	introspectToken?: (token: string) => Promise<boolean>;
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
		const verifyOAuth = createHubOAuthVerifier({
			...metadata,
			jwks: { keys: metadata.jwks.keys },
		}, binding, dependencies.introspectToken ?? ((token) => introspectHubRuntimeToken(token, hub, log)));
		return {
			supportedModes: ["oauth2"],
			verifyOAuth,
			managedOAuth: true,
			binding,
			bindAgent(agentId: string) { binding.agentId = agentId; },
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
		bindAgent() {},
	};
}
