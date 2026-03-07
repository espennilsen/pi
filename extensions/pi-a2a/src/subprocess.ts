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

export function runPrompt(
	prompt: string,
	cwd: string,
	log: LogFn,
	timeoutMs = DEFAULT_TIMEOUT_MS,
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

		const rl = readline.createInterface({ input: child.stdout });

		function settle(result: SubprocessResult): void {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
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

		child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
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

			if (code === 0 || responseText.length > 0) {
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
