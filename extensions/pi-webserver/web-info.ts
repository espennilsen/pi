export interface WebInfo {
	port: number;
	url: string;
}

export interface WebInfoRequest {
	reply: (info: WebInfo) => void;
}

interface WebEvents {
	on(event: "web:info", handler: (request: unknown) => void): void;
}

/** Register the synchronous discovery contract used by other extensions. */
export function registerWebInfoListener(
	events: WebEvents,
	getInfo: () => WebInfo | null,
): void {
	events.on("web:info", (request: unknown) => {
		const reply = (request as Partial<WebInfoRequest> | null)?.reply;
		if (typeof reply !== "function") return;
		const info = getInfo();
		if (info) reply(info);
	});
}
