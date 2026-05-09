import http from "node:http";

import { buildLoopbackRedirectUri } from "./auth-config.ts";

/** Successful authorization callback payload captured from the loopback server. */
export interface CallbackResult {
  code: string;
  state: string | null;
}

/** Configuration for the temporary loopback callback server. */
export interface StartCallbackServerOptions {
  callbackPath?: string;
  expectedState?: string;
  timeoutMs?: number;
  successHtml?: string;
}

/** Handle for waiting on and shutting down the loopback callback server. */
export interface CallbackServer {
  host: "127.0.0.1";
  port: number;
  callbackPath: string;
  redirectUri: string;
  waitForCallback(): Promise<CallbackResult>;
  close(): Promise<void>;
}

function respond(res: http.ServerResponse, statusCode: number, body: string): void {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

/**
 * Starts a one-shot loopback HTTP server used to receive the browser auth callback.
 * @param options - Callback path, timeout, state validation, and success response settings.
 * @returns A server handle for waiting on the callback and closing the listener.
 */
export async function startCallbackServer(options: StartCallbackServerOptions = {}): Promise<CallbackServer> {
  const callbackPath = options.callbackPath?.startsWith("/") ? options.callbackPath : `/${options.callbackPath ?? "callback"}`;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const host: "127.0.0.1" = "127.0.0.1";
  const server = http.createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    throw new Error("Expected callback server TCP address");
  }

  const port = address.port;
  const redirectUri = buildLoopbackRedirectUri(port, callbackPath);

  let settled = false;
  let timeout: NodeJS.Timeout | null = null;

  const closeServer = async (): Promise<void> => {
    if (!server.listening) return;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  };

  const callbackPromise = new Promise<CallbackResult>((resolve, reject) => {
    const finish = async (finalize: () => void): Promise<void> => {
      if (settled) return;
      settled = true;
      try {
        finalize();
      } finally {
        await closeServer();
      }
    };

    timeout = setTimeout(() => {
      void finish(() => reject(new Error(`Authentication callback timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    server.on("request", (req, res) => {
      if (settled) {
        respond(res, 410, "Authentication callback already handled.");
        return;
      }

      if (req.method !== "GET") {
        respond(res, 405, "Method not allowed.");
        void finish(() => reject(new Error(`Unexpected callback method ${req.method ?? "UNKNOWN"}`)));
        return;
      }

      const url = new URL(req.url ?? "/", redirectUri);
      if (url.pathname !== callbackPath) {
        respond(res, 404, "Not found.");
        return;
      }

      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");
      if (error) {
        respond(res, 400, `Authentication failed: ${error}`);
        void finish(() => reject(new Error(`${error}${errorDescription ? `: ${errorDescription}` : ""}`)));
        return;
      }

      const receivedState = url.searchParams.get("state");
      if (options.expectedState && receivedState !== options.expectedState) {
        respond(res, 400, "State mismatch.");
        void finish(() => reject(new Error("Authentication callback state mismatch")));
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        respond(res, 400, "Missing authorization code.");
        void finish(() => reject(new Error("Authentication callback missing authorization code")));
        return;
      }

      respond(res, 200, options.successHtml ?? "Authentication complete. You can close this window.");
      void finish(() => resolve({ code, state: receivedState }));
    });
  });

  callbackPromise.catch(() => undefined);

  return {
    host,
    port,
    callbackPath,
    redirectUri,
    waitForCallback() {
      return callbackPromise;
    },
    close() {
      settled = true;
      return closeServer();
    },
  };
}
