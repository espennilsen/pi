/**
 * pi-channels — Subprocess runner for the chat bridge.
 *
 * Spawns `pi -p --no-session [@files...] <prompt>` to process a single prompt.
 * Supports file attachments (images, documents) via the @file syntax.
 * Same pattern as pi-cron and pi-heartbeat.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { RunResult, IncomingAttachment } from "../types.ts";

export interface RunOptions {
	prompt: string;
	cwd: string;
	timeoutMs: number;
	model?: string | null;
	signal?: AbortSignal;
	/** File attachments to include via @file args. */
	attachments?: IncomingAttachment[];
	/** Explicit extension paths to load (with --no-extensions + -e for each). */
	extensions?: string[];
}

export function runPrompt(options: RunOptions): Promise<RunResult> {
	const { prompt, cwd, timeoutMs, model, signal, attachments, extensions } = options;

	return new Promise((resolve) => {
		const startTime = Date.now();

		const args = ["-p", "--no-session", "--no-extensions"];
		if (model) args.push("--model", model);

		// Explicitly load only bridge-safe extensions
		if (extensions?.length) {
			for (const ext of extensions) {
				args.push("-e", ext);
			}
		}

		// Add file attachments as @file args before the prompt
		if (attachments?.length) {
			for (const att of attachments) {
				args.push(`@${att.path}`);
			}
		}

		args.push(prompt);

		let child: ChildProcess;
		try {
			child = spawn("pi", args, {
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env },
				timeout: timeoutMs,
			});
		} catch (err: any) {
			resolve({
				ok: false, response: "", error: `Failed to spawn: ${err.message}`,
				durationMs: Date.now() - startTime, exitCode: 1,
			});
			return;
		}

		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
		child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

		const onAbort = () => {
			child.kill("SIGTERM");
			setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 3000);
		};

		if (signal) {
			if (signal.aborted) { onAbort(); }
			else { signal.addEventListener("abort", onAbort, { once: true }); }
		}

		child.on("close", (code) => {
			signal?.removeEventListener("abort", onAbort);
			const durationMs = Date.now() - startTime;
			const response = stdout.trim();
			const exitCode = code ?? 1;

			if (signal?.aborted) {
				resolve({ ok: false, response: response || "(aborted)", error: "Aborted by user", durationMs, exitCode: 130 });
			} else if (exitCode !== 0) {
				resolve({ ok: false, response, error: stderr.trim() || `Exit code ${exitCode}`, durationMs, exitCode });
			} else {
				resolve({ ok: true, response: response || "(no output)", durationMs, exitCode: 0 });
			}
		});

		child.on("error", (err) => {
			signal?.removeEventListener("abort", onAbort);
			resolve({ ok: false, response: "", error: err.message, durationMs: Date.now() - startTime, exitCode: 1 });
		});
	});
}
