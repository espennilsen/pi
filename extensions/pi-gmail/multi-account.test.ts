import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	getTokensPath,
	getAccountConfig,
	loadTokens,
	saveTokens,
	listAccounts,
	generateOAuthState,
	verifyOAuthState,
	fetchUserEmail,
	validateAccountName,
} from "./auth.ts";
import type { GmailSettings, OAuthTokens } from "./types.ts";

test("validateAccountName accepts safe names and rejects invalid characters", () => {
	assert.doesNotThrow(() => validateAccountName("work"));
	assert.doesNotThrow(() => validateAccountName("personal_1"));
	assert.doesNotThrow(() => validateAccountName("account-2"));
	assert.doesNotThrow(() => validateAccountName("default"));
	assert.doesNotThrow(() => validateAccountName(undefined));

	assert.throws(() => validateAccountName("work:personal"), /Invalid account name/);
	assert.throws(() => validateAccountName("../traversal"), /Invalid account name/);
	assert.throws(() => validateAccountName("work/personal"), /Invalid account name/);
	assert.throws(() => validateAccountName("work personal"), /Invalid account name/);
});

test("getTokensPath resolves default and named account paths safely", () => {
	const agentDir = "/tmp/test-agent";
	assert.equal(getTokensPath(agentDir), path.join(agentDir, "db", "gmail-tokens.json"));
	assert.equal(getTokensPath(agentDir, "default"), path.join(agentDir, "db", "gmail-tokens.json"));
	assert.equal(getTokensPath(agentDir, "work"), path.join(agentDir, "db", "gmail-tokens-work.json"));
	assert.equal(getTokensPath(agentDir, "personal"), path.join(agentDir, "db", "gmail-tokens-personal.json"));
	assert.throws(() => getTokensPath(agentDir, "bad/name"), /Invalid account name/);
});

test("getAccountConfig resolves account-specific settings and rejects unknown accounts", () => {
	const settings: GmailSettings = {
		clientId: "global-id",
		clientSecret: "global-secret",
		readOnly: true,
		defaultAccount: "work",
		accounts: {
			work: {
				clientId: "work-id",
				clientSecret: "work-secret",
				readOnly: false,
			},
			personal: {
				clientId: "personal-id",
			},
		},
	};

	// Named account with all fields overridden
	const workConfig = getAccountConfig(settings, "work");
	assert.equal(workConfig.clientId, "work-id");
	assert.equal(workConfig.clientSecret, "work-secret");
	assert.equal(workConfig.readOnly, false);

	// Named account with fallback to global clientSecret and global readOnly
	const personalConfig = getAccountConfig(settings, "personal");
	assert.equal(personalConfig.clientId, "personal-id");
	assert.equal(personalConfig.clientSecret, "global-secret");
	assert.equal(personalConfig.readOnly, true);

	// Unknown account should be rejected when accounts map is configured
	assert.throws(() => getAccountConfig(settings, "unknown"), /not configured in settings\.json/);

	// Single account setup (empty accounts map) falls back to global settings
	const singleAccountSettings: GmailSettings = {
		clientId: "global-id",
		clientSecret: "global-secret",
	};
	assert.equal(getAccountConfig(singleAccountSettings, "any").clientId, "global-id");
});

test("loadTokens and saveTokens persist and isolate tokens per account", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gmail-test-"));

	try {
		const workTokens: OAuthTokens = {
			email: "work@example.com",
			access_token: "work-access",
			refresh_token: "work-refresh",
			expires_at: Date.now() + 3600000,
			scope: "gmail.readonly",
		};

		const personalTokens: OAuthTokens = {
			email: "personal@example.com",
			access_token: "personal-access",
			refresh_token: "personal-refresh",
			expires_at: Date.now() + 3600000,
			scope: "gmail.readonly",
		};

		saveTokens(tempDir, workTokens, "work");
		saveTokens(tempDir, personalTokens, "personal");

		assert.deepEqual(loadTokens(tempDir, "work"), workTokens);
		assert.deepEqual(loadTokens(tempDir, "personal"), personalTokens);
		assert.equal(loadTokens(tempDir, "nonexistent"), null);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("listAccounts discovers accounts from settings and disk merged", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gmail-test-"));

	try {
		const workTokens: OAuthTokens = {
			email: "work@example.com",
			access_token: "work-access",
			refresh_token: "work-refresh",
			expires_at: Date.now() + 3600000,
			scope: "gmail.readonly",
		};

		const unconfiguredTokens: OAuthTokens = {
			email: "other@example.com",
			access_token: "other-access",
			refresh_token: "other-refresh",
			expires_at: Date.now() + 3600000,
			scope: "gmail.readonly",
		};

		saveTokens(tempDir, workTokens, "work");
		saveTokens(tempDir, unconfiguredTokens, "ondisk_only");

		const settings: GmailSettings = {
			defaultAccount: "work",
			accounts: {
				work: { clientId: "work-id", clientSecret: "work-secret" },
				personal: { clientId: "personal-id", clientSecret: "personal-secret" },
			},
		};

		const accounts = listAccounts(settings, tempDir, "work");
		assert.equal(accounts.length, 3);

		const workAcc = accounts.find((a) => a.name === "work");
		assert.ok(workAcc);
		assert.equal(workAcc.email, "work@example.com");
		assert.equal(workAcc.authenticated, true);
		assert.equal(workAcc.isActive, true);
		assert.equal(workAcc.isDefault, true);

		const personalAcc = accounts.find((a) => a.name === "personal");
		assert.ok(personalAcc);
		assert.equal(personalAcc.authenticated, false);
		assert.equal(personalAcc.isActive, false);

		const onDiskAcc = accounts.find((a) => a.name === "ondisk_only");
		assert.ok(onDiskAcc);
		assert.equal(onDiskAcc.email, "other@example.com");
		assert.equal(onDiskAcc.authenticated, true);
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("OAuth state generates, verifies, and isolates concurrent flows", () => {
	const stateWork = generateOAuthState("work");
	const statePersonal = generateOAuthState("personal");

	// Interleaved validation
	const resultPersonal = verifyOAuthState(statePersonal);
	assert.equal(resultPersonal.valid, true);
	assert.equal(resultPersonal.account, "personal");

	const resultWork = verifyOAuthState(stateWork);
	assert.equal(resultWork.valid, true);
	assert.equal(resultWork.account, "work");

	// Single use check
	assert.equal(verifyOAuthState(stateWork).valid, false);
	assert.equal(verifyOAuthState(statePersonal).valid, false);

	// Default state without account
	const defaultState = generateOAuthState();
	const defaultResult = verifyOAuthState(defaultState);
	assert.equal(defaultResult.valid, true);
	assert.equal(defaultResult.account, undefined);

	// Capacity eviction test (generate 105 states, oldest should be evicted)
	const firstState = generateOAuthState("first");
	for (let i = 0; i < 105; i++) {
		generateOAuthState(`acc_${i}`);
	}
	assert.equal(verifyOAuthState(firstState).valid, false); // evicted

	// Invalid state rejected
	assert.equal(verifyOAuthState("invalid-state").valid, false);
	assert.throws(() => generateOAuthState("invalid:name"), /Invalid account name/);
});

test("fetchUserEmail extracts email from profile, userinfo fallback, or unknown", async () => {
	const originalFetch = globalThis.fetch;

	try {
		// 1. Profile success
		globalThis.fetch = (async (url: string | URL) => {
			if (String(url).includes("/users/me/profile")) {
				return {
					ok: true,
					json: async () => ({ emailAddress: "profile@example.com" }),
				} as any;
			}
			return { ok: false } as any;
		}) as typeof fetch;

		const email1 = await fetchUserEmail("token-1");
		assert.equal(email1, "profile@example.com");

		// 2. Profile failure, Userinfo success
		globalThis.fetch = (async (url: string | URL) => {
			if (String(url).includes("/users/me/profile")) {
				return { ok: false } as any;
			}
			if (String(url).includes("/userinfo")) {
				return {
					ok: true,
					json: async () => ({ email: "userinfo@example.com" }),
				} as any;
			}
			return { ok: false } as any;
		}) as typeof fetch;

		const email2 = await fetchUserEmail("token-2");
		assert.equal(email2, "userinfo@example.com");

		// 3. Both endpoints fail
		globalThis.fetch = (async () => ({ ok: false })) as unknown as typeof fetch;

		const email3 = await fetchUserEmail("token-3");
		assert.equal(email3, "unknown");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
