import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";

const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
const OPENROUTER_KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";
const CALLBACK_URL = "http://localhost:3000/callback";

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	const verifier = btoa(String.fromCharCode(...array))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	return { verifier, challenge };
}

export async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const { verifier, challenge } = await generatePKCE();

	const params = new URLSearchParams({
		callback_url: CALLBACK_URL,
		code_challenge: challenge,
		code_challenge_method: "S256",
	});

	callbacks.onAuth({ url: `${OPENROUTER_AUTH_URL}?${params.toString()}` });

	const callbackUrl = await callbacks.onPrompt({
		message: "Paste the callback URL from your browser:",
	});

	let parsed: URL;
	try {
		parsed = new URL(callbackUrl);
	} catch {
		throw new Error("Invalid callback URL — paste the full URL from your browser's address bar");
	}

	const code = parsed.searchParams.get("code");
	if (!code) {
		throw new Error("No authorization code found in callback URL");
	}

	const response = await fetch(OPENROUTER_KEYS_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			code,
			code_verifier: verifier,
			code_challenge_method: "S256",
		}),
		signal: AbortSignal.timeout(30_000),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`OpenRouter key exchange failed (${response.status}): ${text}`);
	}

	let data: { key: string };
	try {
		data = (await response.json()) as { key: string };
	} catch {
		throw new Error("OpenRouter returned invalid JSON during key exchange");
	}

	if (!data.key) {
		throw new Error("OpenRouter returned empty API key");
	}

	// Permanent key — OpenRouter PKCE returns a non-expiring API key
	return {
		refresh: "",
		access: data.key,
		expires: Number.MAX_SAFE_INTEGER,
	};
}

export async function refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	// OpenRouter PKCE returns a permanent API key — no refresh needed
	return credentials;
}

export function getApiKey(credentials: OAuthCredentials): string {
	return credentials.access;
}
