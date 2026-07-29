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

	let transport: OutboundAuthContext["transport"] = { kind: "default" };
	if (mode === "oauth2+mtls") {
		const flags = input.localAuth?.transport;
		const mtls = input.localAuth?.mtls;
		if (!flags?.mtls || !flags.clientCertificate) {
			throw new Error("mTLS requires local transport.mtls and transport.clientCertificate");
		}
		if (!mtls?.certPath || !mtls.keyPath) {
			throw new Error("mTLS requires certPath and keyPath");
		}
		transport = { kind: "mtls", certPath: mtls.certPath, keyPath: mtls.keyPath, ...(mtls.caPath ? { caPath: mtls.caPath } : {}) };
	}

	const token = await input.provider.getAccessToken(input.peer, input.selection);
	if (token.mode !== mode) throw new Error("Token provider returned a token for the wrong authentication mode");
	return { headers: { Authorization: `Bearer ${token.value}` }, mode, transport };
}
