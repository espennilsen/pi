import test from "node:test";
import assert from "node:assert/strict";
import { isSendActionBlocked, sendingDisabledMessage } from "./policy.ts";

test("readOnly settings block both email send actions", () => {
	assert.equal(isSendActionBlocked({ readOnly: true }, "send"), true);
	assert.equal(isSendActionBlocked({ readOnly: true }, "send_draft"), true);
	assert.equal(sendingDisabledMessage(), "❌ Sending email is disabled because pi-gmail is in read-only mode.");
});

test("readOnly settings preserve draft creation and inbox actions", () => {
	assert.equal(isSendActionBlocked({ readOnly: true }, "compose"), false);
	assert.equal(isSendActionBlocked({ readOnly: true }, "reply"), false);
	assert.equal(isSendActionBlocked({ readOnly: true }, "search"), false);
	assert.equal(isSendActionBlocked({ readOnly: true }, "list_inbox"), false);
});

test("sending is allowed unless readOnly is explicitly enabled", () => {
	assert.equal(isSendActionBlocked({}, "send"), false);
	assert.equal(isSendActionBlocked({ readOnly: false }, "send_draft"), false);
});
