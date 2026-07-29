import { createServer } from "node:net";

/**
 * Find a free port in the given range (inclusive) on the specified host.
 * Returns the first available port, or null if none found.
 */
export function findFreePort(rangeStart: number, rangeEnd: number, host = "127.0.0.1"): Promise<number | null> {
	return new Promise((resolve) => {
		if (rangeStart > rangeEnd) {
			resolve(null);
			return;
		}
		tryNext(rangeStart);

		function tryNext(port: number): void {
			if (port > rangeEnd) {
				resolve(null);
				return;
			}
			const server = createServer();
			server.once("error", () => {
				tryNext(port + 1);
			});
			server.once("listening", () => {
				server.close(() => resolve(port));
			});
			server.listen(port, host);
		}
	});
}
