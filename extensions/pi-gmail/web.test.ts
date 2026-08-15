import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { mountGmailRoutes, updateGmailWebInfo } from "./web.ts";

type RouteHandler = (
	req: IncomingMessage,
	res: ServerResponse,
	subPath: string,
) => void | Promise<void>;

describe("Gmail OAuth web routes", () => {
	it("uses the discovered manual-start server origin in the consent redirect", async () => {
		let gmailHandler: RouteHandler | undefined;
		const bus = {
			on() {},
			emit(event: string, data: unknown) {
				// Simulate mounting before pi-webserver starts: web:info has no reply.
				if (event === "web:mount") {
					gmailHandler = (data as { handler: RouteHandler }).handler;
				}
			},
		};

		updateGmailWebInfo({ port: 3100, url: "http://localhost:3100" });
		mountGmailRoutes(bus, { clientId: "test-client" }, "/tmp/pi-gmail-test");

		// /gmail-auth discovers this after /web was started manually.
		assert.equal(
			updateGmailWebInfo({ port: 42873, url: "http://localhost:42873" }),
			true,
		);

		let status: number | undefined;
		let location: string | undefined;
		let ended = false;
		const response = {
			writeHead(nextStatus: number, headers: Record<string, string>) {
				status = nextStatus;
				location = headers.Location;
			},
			end() {
				ended = true;
			},
		} as unknown as ServerResponse;

		assert.ok(gmailHandler);
		const handler = gmailHandler as RouteHandler;
		await handler(
			{ method: "GET", url: "/gmail/auth" } as IncomingMessage,
			response,
			"/auth",
		);

		assert.equal(status, 302);
		assert.equal(ended, true);
		assert.ok(location);
		const consentUrl = new URL(location as string);
		assert.equal(
			consentUrl.searchParams.get("redirect_uri"),
			"http://localhost:42873/gmail/callback",
		);
	});
});
