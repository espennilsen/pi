/** Pure policy for selecting peer authentication without handling credentials. */

import type { AuthMode, AuthSelection, AuthSelectionInput } from "./auth-types.ts";

const MODE_STRENGTH: readonly AuthMode[] = ["oauth2+mtls", "oauth2", "legacy-api-key"];
const MODERN_MODES = new Set<AuthMode>(["oauth2", "oauth2+mtls"]);
const VALID_MODES = new Set<AuthMode>(MODE_STRENGTH);

/**
 * Select the strongest mutually usable authentication mode for a peer.
 * The result is denied rather than falling back when no permitted mode exists.
 */
export function selectPeerAuth(input: AuthSelectionInput): AuthSelection {
	const { peer, local = {} } = input;
	const modernOnly = input.modernOnly ?? (input.skillId !== undefined && local.modernOnlySkills?.includes(input.skillId));
	const localModes = local.supportedAuthModes ?? ["legacy-api-key"];
	const peerModes = peer.supportedAuthModes;
	const mutuallySupported = MODE_STRENGTH.filter(
		(mode) =>
			VALID_MODES.has(mode) &&
			localModes.includes(mode) &&
			peerModes.includes(mode) &&
			// mTLS is intentionally unavailable until the SDK client can install a
			// certificate-bearing HTTPS transport for the actual request.
			mode !== "oauth2+mtls",
	);
	const permittedModes = peer.selectedAuthMode
		? mutuallySupported.filter((mode) => mode === peer.selectedAuthMode)
		: mutuallySupported;

	if (modernOnly) {
		const modernMode = permittedModes.find((mode) => MODERN_MODES.has(mode));
		if (modernMode) return selected(modernMode, peer.source);
		return denied(peer.source, "modern-auth-required");
	}

	if (local.preferModern === false && permittedModes.includes("legacy-api-key")) {
		return selected("legacy-api-key", peer.source);
	}

	const mode = permittedModes[0];
	return mode ? selected(mode, peer.source) : denied(peer.source, "no-mutual-auth-mode");
}

function selected(mode: AuthMode, source: AuthSelection["source"]): AuthSelection {
	return { selectedAuthMode: mode, source, denial: null };
}

function denied(source: AuthSelection["source"], reason: "no-mutual-auth-mode" | "modern-auth-required"): AuthSelection {
	return { selectedAuthMode: null, source, denial: { reason } };
}
