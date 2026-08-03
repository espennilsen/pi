/** Build secret-bearing outbound auth only after peer mode selection succeeds. */

import type { AuthSelection, LocalAuthOverride, PeerAuthMetadata } from "./auth-types.ts";
import type { TokenProvider } from "./token-provider.ts";

export interface OutboundAuthContext {
	headers: { Authorization: string };
	mode: NonNullable<AuthSelection["selectedAuthMode"]>;
	transport: { kind: "default" } | { kind: "mtls"; certPath: string; keyPath: string; caPath?: string };
}

export interface BuildOutboundAuthInput {
	peer: PeerAuthMetadata;
	selection: AuthSelection;
	provider: TokenProvider;
	localAuth?: LocalAuthOverride;
}

/**
 * Produces headers and an intentionally transport-agnostic mTLS descriptor.
 * Callers must create the actual HTTPS transport from this descriptor later.
 */
export async function buildOutboundAuthContext(input: BuildOutboundAuthInput): Promise<OutboundAuthContext> {
	const mode = input.selection.selectedAuthMode;
	if (!mode || input.selection.denial) throw new Error("No mutually supported authentication mode");

	if (mode === "oauth2+mtls") {
		// The SDK client cannot install a certificate-bearing HTTPS transport. Reject
		// before consulting the provider, so client credentials are never acquired.
		throw new Error("OAuth 2.0 + mTLS is unavailable until outbound mTLS transport is installed");
	}

	const token = await input.provider.getAccessToken(input.peer, input.selection);
	if (token.mode !== mode) throw new Error("Token provider returned a token for the wrong authentication mode");
	return { headers: { Authorization: `Bearer ${token.value}` }, mode, transport: { kind: "default" } };
}
