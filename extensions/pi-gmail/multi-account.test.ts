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
	clearTokens,
	listAccounts,
	generateOAuthState,
	verifyOAuthState,
	fetchUserEmail,
} from "./auth.ts";
import type { GmailSettings, OAuthTokens } from "./types.ts";

test("getTokensPath resolves default and named account paths", () => {
	const agentDir = "/tmp/test-agent";
	assert.equal(getTokensPath(agentDir), path.join(agentDir, "db", "gmail-tokens.json"));
	assert.equal(getTokensPath(agentDir, "default"), path.join(agentDir, "db", "gmail-tokens.json"));
	assert.equal(getTokensPath(agentDir, "work"), path.join(agentDir, "db", "gmail-tokens-work.json"));
	assert.equal(getTokensPath(agentDir, "personal"), path.join(agentDir, "db", "gmail-tokens-personal.json"));
});

test("getAccountConfig resolves account-specific settings with fallback to top-level", () => {
	const settings: GmailSettings = {
		clientId: "global-id",
		clientSecret: "global-secret",
		readOnly: false,
		defaultAccount: "work",
		accounts: {
			work: {
				clientId: "work-id",
				clientSecret: "work-secret",
				readOnly: true,
			},
			personal: {
				clientId: "personal-id",
			},
		},
	};

	// Named account with all fields
	const workConfig = getAccountConfig(settings, "work");
	assert.equal(workConfig.clientId, "work-id");
	assert.equal(workConfig.clientSecret, "work-secret");
	assert.equal(workConfig.readOnly, true);

	// Named account with fallback to global clientSecret and readOnly
	const personalConfig = getAccountConfig(settings, "personal");
	assert.equal(personalConfig.clientId, "personal-id");
	assert.equal(personalConfig.clientSecret, "global-secret");
	assert.equal(personalConfig.readOnly, false);

	// Default fallback
	const globalConfig = getAccountConfig(settings, "unknown");
	assert.equal(globalConfig.clientId, "global-id");
	assert.equal(globalConfig.clientSecret, "global-secret");
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

test("listAccounts discovers accounts from settings and disk", () => {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gmail-test-"));

	try {
		const workTokens: OAuthTokens = {
			email: "work@example.com",
			access_token: "work-access",
			refresh_token: "work-refresh",
			expires_at: Date.now() + 3600000,
			scope: "gmail.readonly",
		};

		saveTokens(tempDir, workTokens, "work");

		const settings: GmailSettings = {
			defaultAccount: "work",
			accounts: {
				work: { clientId: "work-id", clientSecret: "work-secret" },
				personal: { clientId: "personal-id", clientSecret: "personal-secret" },
			},
		};

		const accounts = listAccounts(settings, tempDir, "work");
		assert.equal(accounts.length, 2);

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
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});

test("OAuth state generates and parses account name safely", () => {
	const stateWithAccount = generateOAuthState("work");
	const result = verifyOAuthState(stateWithAccount);
	assert.equal(result.valid, true);
	assert.equal(result.account, "work");

	const defaultState = generateOAuthState();
	const defaultResult = verifyOAuthState(defaultState);
	assert.equal(defaultResult.valid, true);
	assert.equal(defaultResult.account, undefined);

	// Invalid state rejected
	assert.equal(verifyOAuthState("invalid-state").valid, false);
});
