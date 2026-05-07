import path from "node:path";

import type {
	BashOperations,
	EditOperations,
	ExtensionAPI,
	ExtensionContext,
	ReadOperations,
	WriteOperations,
} from "@mariozechner/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createReadTool,
	createWriteTool,
	getAgentDir,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { RealFSProvider, VM } from "@earendil-works/gondolin";

interface MountConfig {
	host: string;
	guest: string;
}

interface GondolinSettings {
	enabled: boolean;
	eagerStart: boolean;
	mounts: MountConfig[];
}

const SETTINGS_KEY = "pi-gondolin";

const DEFAULT_SETTINGS: GondolinSettings = {
	enabled: true,
	eagerStart: true,
	mounts: [],
};

function shQuote(value: string): string {
	return "'" + value.replace(/'/g, "'\\''") + "'";
}

function isInsideOrEqual(parent: string, child: string): boolean {
	const rel = path.relative(parent, child);
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function toPosixPath(value: string): string {
	return value.split(path.sep).join(path.posix.sep);
}

function normalizeAbsoluteHostPath(value: string, cwd: string): string {
	const expanded = value.startsWith("~")
		? path.join(process.env.HOME ?? "", value.slice(1))
		: value;
	return path.resolve(cwd, expanded);
}

function normalizeGuestPath(value: string): string {
	if (!path.posix.isAbsolute(value)) {
		throw new Error(`Gondolin guest mount path must be absolute: ${value}`);
	}
	return path.posix.normalize(toPosixPath(value));
}

function parseMountString(value: string, cwd: string): MountConfig | null {
	const trimmed = value.trim();
	if (!trimmed) return null;

	const separator = trimmed.indexOf(":");
	if (separator > 0) {
		const host = normalizeAbsoluteHostPath(trimmed.slice(0, separator), cwd);
		const guest = normalizeGuestPath(trimmed.slice(separator + 1));
		return { host, guest };
	}

	const host = normalizeAbsoluteHostPath(trimmed, cwd);
	return { host, guest: normalizeGuestPath(host) };
}

function parseMountArray(value: unknown, cwd: string): MountConfig[] {
	if (!Array.isArray(value)) return [];

	const mounts: MountConfig[] = [];
	for (const entry of value) {
		if (typeof entry === "string") {
			const mount = parseMountString(entry, cwd);
			if (mount) mounts.push(mount);
			continue;
		}

		if (!entry || typeof entry !== "object") continue;
		const obj = entry as { host?: unknown; guest?: unknown };
		if (typeof obj.host !== "string") continue;
		const host = normalizeAbsoluteHostPath(obj.host, cwd);
		const guest = typeof obj.guest === "string" ? normalizeGuestPath(obj.guest) : normalizeGuestPath(host);
		mounts.push({ host, guest });
	}
	return mounts;
}

function parseCliMounts(value: unknown, cwd: string): MountConfig[] {
	if (typeof value !== "string" || value.trim() === "") return [];
	return value
		.split(",")
		.map((part) => parseMountString(part, cwd))
		.filter((mount): mount is MountConfig => mount !== null);
}

function dedupeMounts(mounts: MountConfig[]): MountConfig[] {
	const seen = new Set<string>();
	const out: MountConfig[] = [];
	for (const mount of mounts) {
		const key = `${mount.guest}\0${mount.host}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(mount);
	}
	return out;
}

function resolveSettings(cwd: string): GondolinSettings {
	try {
		const sm = SettingsManager.create(cwd, getAgentDir());
		const global = sm.getGlobalSettings() as Record<string, unknown>;
		const project = sm.getProjectSettings() as Record<string, unknown>;
		const cfg = {
			...((global?.[SETTINGS_KEY] as Record<string, unknown> | undefined) ?? {}),
			...((project?.[SETTINGS_KEY] as Record<string, unknown> | undefined) ?? {}),
		};

		return {
			enabled: typeof cfg.enabled === "boolean" ? cfg.enabled : DEFAULT_SETTINGS.enabled,
			eagerStart: typeof cfg.eagerStart === "boolean" ? cfg.eagerStart : DEFAULT_SETTINGS.eagerStart,
			mounts: parseMountArray(cfg.mounts, cwd),
		};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

function toGuestPath(mounts: MountConfig[], localPath: string): string {
	const absolute = path.resolve(localPath);
	const candidates = mounts
		.filter((mount) => isInsideOrEqual(mount.host, absolute))
		.sort((a, b) => b.host.length - a.host.length);

	const mount = candidates[0];
	if (!mount) {
		throw new Error(`path is not mounted in Gondolin VM: ${localPath}`);
	}

	const rel = path.relative(mount.host, absolute);
	if (rel === "") return mount.guest;
	return path.posix.join(mount.guest, toPosixPath(rel));
}

function createGondolinReadOps(vm: VM, mounts: MountConfig[]): ReadOperations {
	return {
		readFile: async (p) => {
			const guestPath = toGuestPath(mounts, p);
			const r = await vm.exec(["/bin/cat", guestPath]);
			if (!r.ok) {
				throw new Error(`cat failed (${r.exitCode}): ${r.stderr}`);
			}
			return r.stdoutBuffer;
		},
		access: async (p) => {
			const guestPath = toGuestPath(mounts, p);
			const r = await vm.exec(["/bin/sh", "-lc", `test -r ${shQuote(guestPath)}`]);
			if (!r.ok) {
				throw new Error(`not readable: ${p}`);
			}
		},
		detectImageMimeType: async (p) => {
			const guestPath = toGuestPath(mounts, p);
			try {
				const r = await vm.exec(["/bin/sh", "-lc", `file --mime-type -b ${shQuote(guestPath)}`]);
				if (!r.ok) return null;
				const mime = r.stdout.trim();
				return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime) ? mime : null;
			} catch {
				return null;
			}
		},
	};
}

function createGondolinWriteOps(vm: VM, mounts: MountConfig[]): WriteOperations {
	return {
		writeFile: async (p, content) => {
			const guestPath = toGuestPath(mounts, p);
			const dir = path.posix.dirname(guestPath);
			const b64 = Buffer.from(content, "utf8").toString("base64");
			const script = [
				"set -eu",
				`mkdir -p ${shQuote(dir)}`,
				`printf %s ${shQuote(b64)} | base64 -d > ${shQuote(guestPath)}`,
			].join("\n");

			const r = await vm.exec(["/bin/sh", "-lc", script]);
			if (!r.ok) {
				throw new Error(`write failed (${r.exitCode}): ${r.stderr}`);
			}
		},
		mkdir: async (dir) => {
			const guestDir = toGuestPath(mounts, dir);
			const r = await vm.exec(["/bin/mkdir", "-p", guestDir]);
			if (!r.ok) {
				throw new Error(`mkdir failed (${r.exitCode}): ${r.stderr}`);
			}
		},
	};
}

function createGondolinEditOps(vm: VM, mounts: MountConfig[]): EditOperations {
	const r = createGondolinReadOps(vm, mounts);
	const w = createGondolinWriteOps(vm, mounts);
	return { readFile: r.readFile, access: r.access, writeFile: w.writeFile };
}

function sanitizeEnv(env?: NodeJS.ProcessEnv): Record<string, string> | undefined {
	if (!env) return undefined;
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (typeof value === "string") out[key] = value;
	}
	return out;
}

function createGondolinBashOps(vm: VM, mounts: MountConfig[]): BashOperations {
	return {
		exec: async (command, cwd, { onData, signal, timeout, env }) => {
			const guestCwd = toGuestPath(mounts, cwd);
			const ac = new AbortController();
			const onAbort = () => ac.abort();
			signal?.addEventListener("abort", onAbort, { once: true });

			let timedOut = false;
			const timer = timeout && timeout > 0
				? setTimeout(() => {
					timedOut = true;
					ac.abort();
				}, timeout * 1000)
				: undefined;

			try {
				const proc = vm.exec(["/bin/bash", "-lc", command], {
					cwd: guestCwd,
					signal: ac.signal,
					env: sanitizeEnv(env),
					stdout: "pipe",
					stderr: "pipe",
				});

				for await (const chunk of proc.output()) {
					onData(chunk.data);
				}

				const r = await proc;
				return { exitCode: r.exitCode };
			} catch (err) {
				if (signal?.aborted) throw new Error("aborted");
				if (timedOut) throw new Error(`timeout:${timeout}`);
				throw err;
			} finally {
				if (timer) clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
			}
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("no-gondolin", {
		description: "Disable Gondolin VM sandboxing for this Pi session",
		type: "boolean",
		default: false,
	});

	pi.registerFlag("gondolin-mounts", {
		description: "Comma-separated extra Gondolin mounts. Use /host/path or /host/path:/guest/path",
		type: "string",
	});

	const hostCwd = process.cwd();
	const localRead = createReadTool(hostCwd);
	const localWrite = createWriteTool(hostCwd);
	const localEdit = createEditTool(hostCwd);
	const localBash = createBashTool(hostCwd);

	let enabled = true;
	let settings: GondolinSettings = { ...DEFAULT_SETTINGS };
	let mounts: MountConfig[] = [{ host: hostCwd, guest: normalizeGuestPath(hostCwd) }];
	let vm: VM | null = null;
	let vmStarting: Promise<VM> | null = null;

	function refreshRuntimeConfig(cwd: string): void {
		settings = resolveSettings(cwd);
		enabled = settings.enabled && !(pi.getFlag("no-gondolin") as boolean | undefined);
		mounts = dedupeMounts([
			{ host: normalizeAbsoluteHostPath(cwd, cwd), guest: normalizeGuestPath(cwd) },
			...settings.mounts,
			...parseCliMounts(pi.getFlag("gondolin-mounts"), cwd),
		]);
	}

	async function ensureVm(ctx?: ExtensionContext): Promise<VM> {
		if (!enabled) {
			throw new Error("Gondolin sandbox is disabled");
		}
		if (vm) return vm;
		if (vmStarting) return vmStarting;

		vmStarting = (async () => {
			try {
				ctx?.ui.setStatus(
					"gondolin",
					ctx.ui.theme.fg("accent", `Gondolin: starting (${mounts.length} mount${mounts.length === 1 ? "" : "s"})`),
				);

				const vfsMounts: Record<string, RealFSProvider> = {};
				for (const mount of mounts) {
					vfsMounts[mount.guest] = new RealFSProvider(mount.host);
				}

				const created = await VM.create({
					vfs: {
						mounts: vfsMounts,
					},
				});

				vm = created;
				ctx?.ui.setStatus(
					"gondolin",
					ctx.ui.theme.fg("accent", `Gondolin: running (${hostCwd})`),
				);
				ctx?.ui.notify(`Gondolin VM ready. cwd mounted at ${hostCwd}`, "info");
				return created;
			} catch (err) {
				vmStarting = null;
				ctx?.ui.setStatus("gondolin", ctx.ui.theme.fg("error", "Gondolin: failed"));
				throw err;
			}
		})();

		return vmStarting;
	}

	pi.on("session_start", async (_event, ctx) => {
		refreshRuntimeConfig(ctx.cwd);

		if (!enabled) {
			ctx.ui.setStatus("gondolin", ctx.ui.theme.fg("muted", "Gondolin: disabled"));
			return;
		}

		ctx.ui.setStatus("gondolin", ctx.ui.theme.fg("accent", "Gondolin: enabled"));
		if (settings.eagerStart) {
			await ensureVm(ctx);
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!vm) return;
		ctx.ui.setStatus("gondolin", ctx.ui.theme.fg("muted", "Gondolin: stopping"));
		try {
			await vm.close();
		} finally {
			vm = null;
			vmStarting = null;
			ctx.ui.setStatus("gondolin", undefined);
		}
	});

	pi.registerTool({
		...localRead,
		label: "read (Gondolin)",
		async execute(id, params, signal, onUpdate, ctx) {
			if (!enabled) return localRead.execute(id, params, signal, onUpdate);
			const activeVm = await ensureVm(ctx);
			const tool = createReadTool(hostCwd, { operations: createGondolinReadOps(activeVm, mounts) });
			return tool.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localWrite,
		label: "write (Gondolin)",
		async execute(id, params, signal, onUpdate, ctx) {
			if (!enabled) return localWrite.execute(id, params, signal, onUpdate);
			const activeVm = await ensureVm(ctx);
			const tool = createWriteTool(hostCwd, { operations: createGondolinWriteOps(activeVm, mounts) });
			return tool.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localEdit,
		label: "edit (Gondolin)",
		async execute(id, params, signal, onUpdate, ctx) {
			if (!enabled) return localEdit.execute(id, params, signal, onUpdate);
			const activeVm = await ensureVm(ctx);
			const tool = createEditTool(hostCwd, { operations: createGondolinEditOps(activeVm, mounts) });
			return tool.execute(id, params, signal, onUpdate);
		},
	});

	pi.registerTool({
		...localBash,
		label: "bash (Gondolin)",
		async execute(id, params, signal, onUpdate, ctx) {
			if (!enabled) return localBash.execute(id, params, signal, onUpdate);
			const activeVm = await ensureVm(ctx);
			const tool = createBashTool(hostCwd, { operations: createGondolinBashOps(activeVm, mounts) });
			return tool.execute(id, params, signal, onUpdate);
		},
	});

	pi.on("user_bash", async (_event, ctx) => {
		if (!enabled) return;
		const activeVm = await ensureVm(ctx);
		return { operations: createGondolinBashOps(activeVm, mounts) };
	});

	pi.on("before_agent_start", async (event) => {
		if (!enabled) return;
		return {
			systemPrompt: event.systemPrompt.replace(
				`Current working directory: ${hostCwd}`,
				`Current working directory: ${hostCwd} (Gondolin VM sandbox; host cwd mounted at same path)`,
			),
		};
	});
}
