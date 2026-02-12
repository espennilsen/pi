/**
 * pi-npm — NPM workflow extension for pi.
 *
 * Exposes a single `npm` tool with common actions:
 *   - init, install, uninstall, update, outdated
 *   - run, test, build
 *   - publish, pack, version
 *   - info, list, audit, link
 *
 * All commands run in the current working directory by default.
 * An optional `path` parameter lets you target a different directory.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { spawn } from "node:child_process";
import path from "node:path";
import { createLogger } from "./logger.ts";

const ACTIONS = [
	"init",
	"install",
	"uninstall",
	"update",
	"outdated",
	"run",
	"test",
	"build",
	"publish",
	"pack",
	"version",
	"info",
	"list",
	"audit",
	"link",
] as const;

type Action = (typeof ACTIONS)[number];

interface NpmParams {
	action: Action;
	args?: string;
	path?: string;
	dry_run?: boolean;
}

/** Map our action names to the actual npm commands */
function toNpmCommand(action: Action): string {
	if (action === "build") return "run build";
	return action;
}

function runNpm(cmd: string, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn("npm", cmd.split(/\s+/), {
			cwd,
			shell: true,
			env: { ...process.env },
		});

		let stdout = "";
		let stderr = "";

		child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
		child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));

		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
		child.on("error", (err) => resolve({ code: 1, stdout: "", stderr: err.message }));
	});
}

function truncate(text: string, max = 8000): string {
	if (text.length <= max) return text;
	return text.slice(0, max) + `\n…(truncated, ${text.length} chars total)`;
}

export default function (pi: ExtensionAPI) {
	const log = createLogger(pi);
	let cwd = process.cwd();

	pi.on("session_start", async (_event, ctx) => {
		cwd = ctx.cwd;
	});

	pi.registerTool({
		name: "npm",
		label: "NPM",
		description:
			"Run common npm commands. " +
			"Actions: init, install, uninstall, update, outdated, run, test, build, publish, pack, version, info, list, audit, link. " +
			"Use `args` for extra arguments (e.g. package names, script names, semver bumps). " +
			"Use `dry_run: true` with publish/version for a safe preview.",
		parameters: Type.Object({
			action: StringEnum(ACTIONS, {
				description: "npm action to perform",
			}) as any,
			args: Type.Optional(
				Type.String({
					description:
						"Additional arguments passed to the npm command. " +
						"Examples: package names for install/uninstall, script name for run, semver bump for version, --tag for publish",
				}),
			),
			path: Type.Optional(
				Type.String({
					description: "Working directory (defaults to current project root)",
				}),
			),
			dry_run: Type.Optional(
				Type.Boolean({
					description: "If true, adds --dry-run to publish/pack/version commands",
				}),
			),
		}) as any,

		async execute(_toolCallId, _params) {
			const params = _params as NpmParams;
			const workDir = params.path ? path.resolve(cwd, params.path) : cwd;

			// Build the command string
			let cmd = toNpmCommand(params.action);
			if (params.args) cmd += ` ${params.args}`;

			// Inject --dry-run for destructive commands when requested
			if (params.dry_run && ["publish", "pack", "version"].includes(params.action)) {
				cmd += " --dry-run";
			}

			const { code, stdout, stderr } = await runNpm(cmd, workDir);

			log("run", { action: params.action, args: params.args, cwd: workDir, exitCode: code }, code === 0 ? "INFO" : "ERROR");

			const output = [
				`\`npm ${cmd}\` in \`${workDir}\``,
				code === 0 ? "**Exit: 0 ✓**" : `**Exit: ${code} ✗**`,
			];

			if (stdout.trim()) output.push("```\n" + truncate(stdout.trim()) + "\n```");
			if (stderr.trim()) output.push("**stderr:**\n```\n" + truncate(stderr.trim()) + "\n```");

			return {
				content: [{ type: "text" as const, text: output.join("\n\n") }],
				details: { exitCode: code, cwd: workDir },
			};
		},
	});
}
