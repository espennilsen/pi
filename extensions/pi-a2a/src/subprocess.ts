/**
 * pi-a2a — Pi subprocess runner.
 *
 * Spawns `pi --mode rpc` as an isolated subprocess.
 * Sends a prompt via stdin JSON-RPC, collects streaming text deltas,
 * and returns the complete response.
 *
 * No extensions loaded in subprocess (-ne flag) to keep it fast and isolated.
 */

import { spawn } from "node:child_process";
import * as readline from "node:readline";
import type { LogFn } from "./logger.ts";

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

export interface SubprocessResult {
	ok: boolean;
	response: string;
	error?: string;
	durationMs: number;
}

export interface SubprocessHandle {
	result: Promise<SubprocessResult>;
	abort: () => void;
}

export function runPrompt(
	prompt: string,
	cwd: string,
	log: LogFn,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): SubprocessHandle {
	const ac = new AbortController();

	const result = _runPromptInner(prompt, cwd, log, timeoutMs, ac.signal);
	return { result, abort: () => ac.abort() };
}

function _runPromptInner(
	prompt: string,
	cwd: string,
	log: LogFn,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<SubprocessResult> {
	const start = Date.now();

	return new Promise((resolve) => {
		const args = ["--mode", "rpc", "-ne"];
		const child = spawn("pi", args, {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
		});

		let responseText = "";
		let stderr = "";
		let settled = false;
		let killTimer: ReturnType<typeof setTimeout> | null = null;
		let agentEnded = false;

		const rl = readline.createInterface({ input: child.stdout });

		function settle(result: SubprocessResult): void {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			// Note: killTimer is intentionally NOT cleared here — it must fire
			// SIGKILL if the process ignores SIGTERM. It's cleared in the
			// child "close" handler once the process actually exits.
			signal.removeEventListener("abort", onAbort);
			rl.close();
			resolve(result);
		}

		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5_000);
			killTimer.unref();
			settle({
				ok: false,
				response: responseText,
				error: "Prompt timed out",
				durationMs: Date.now() - start,
			});
		}, timeoutMs);

		// External abort (e.g. task cancellation)
		const onAbort = () => {
			child.kill("SIGTERM");
			killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5_000);
			killTimer.unref();
			settle({
				ok: false,
				response: responseText,
				error: "Canceled",
				durationMs: Date.now() - start,
			});
		};
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });

		const MAX_STDERR = 65_536; // 64 KB
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderr.length < MAX_STDERR) {
				stderr += chunk.toString();
				if (stderr.length > MAX_STDERR) {
					stderr = stderr.slice(0, MAX_STDERR);
				}
			}
		});
		child.stdin.on("error", () => { /* ignore EPIPE / ERR_STREAM_DESTROYED */ });

		rl.on("line", (line) => {
			try {
				const event = JSON.parse(line);

				// Collect text deltas from assistant message streaming
				if (event.type === "message_update") {
					const delta = event.assistantMessageEvent;
					if (delta?.type === "text_delta" && delta.delta) {
						responseText += delta.delta;
					}
				}

				// Agent finished — clean up
				if (event.type === "agent_end") {
					agentEnded = true;
					child.stdin.end();
					child.kill("SIGTERM");
				}
			} catch {
				// Ignore non-JSON lines
			}
		});

		// Send the prompt once the child process has spawned
		const promptCmd = JSON.stringify({ type: "prompt", message: prompt }) + "\n";
		child.once("spawn", () => {
			child.stdin.write(promptCmd);
			log("subprocess_spawned", { promptLength: prompt.length });
		});

		child.on("close", (code) => {
			if (killTimer) { clearTimeout(killTimer); killTimer = null; }
			const durationMs = Date.now() - start;

			// Only treat as success if process exited cleanly (code 0) or
			// the agent protocol completed normally (agent_end observed)
			if (code === 0 || (agentEnded && responseText.length > 0)) {
				settle({ ok: true, response: responseText, durationMs });
			} else {
				settle({
					ok: false,
					response: responseText,
					error: stderr.trim() || `Process exited with code ${code}`,
					durationMs,
				});
			}
		});

		child.on("error", (err) => {
			if (killTimer) { clearTimeout(killTimer); killTimer = null; }
			settle({
				ok: false,
				response: responseText,
				error: err.message,
				durationMs: Date.now() - start,
			});
		});
	});
}
