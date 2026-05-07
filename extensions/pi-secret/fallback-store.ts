import { chmod, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

interface FallbackFilePayload {
	version: 1;
	updatedAt: string;
	secrets: Record<string, string>;
}

export class FallbackStoreError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FallbackStoreError";
	}
}

/**
 * JSON fallback for environments where the OS keychain is unavailable.
 *
 * This backend is intentionally strict: the file lives outside the project cwd,
 * symlinked files are rejected, writes are atomic, and mode is forced to 0600.
 * It is still less secure than the OS keychain because plaintext exists on disk.
 */
export class FallbackSecretStore {
	readonly filePath: string;
	private readonly rootDir: string;

	constructor(rootOrFilePath: string = join(homedir(), ".pi", "agents", "secret.json")) {
		const expanded = expandHome(rootOrFilePath);
		const resolved = resolve(expanded);
		this.filePath = resolved.toLowerCase().endsWith(".json") ? resolved : resolve(resolved, "secret.json");
		this.rootDir = dirname(this.filePath);
		this.assertStrictPath();
	}

	async get(account: string): Promise<string | null> {
		const payload = await this.readPayload();
		return payload.secrets[account] ?? null;
	}

	async set(account: string, value: string): Promise<void> {
		const payload = await this.readPayload();
		payload.secrets[account] = value;
		payload.updatedAt = new Date().toISOString();
		await this.writePayload(payload);
	}

	async delete(account: string): Promise<void> {
		const payload = await this.readPayload();
		if (payload.secrets[account] === undefined) return;
		delete payload.secrets[account];
		payload.updatedAt = new Date().toISOString();
		await this.writePayload(payload);
	}

	async has(account: string): Promise<boolean> {
		return (await this.get(account)) !== null;
	}

	private async readPayload(): Promise<FallbackFilePayload> {
		await this.ensureDirectory();
		if (!(await pathExistsNoFollow(this.filePath))) {
			return emptyPayload();
		}
		await this.assertRegularFileNoSymlink();
		const mode = (await stat(this.filePath)).mode & 0o777;
		if (mode !== 0o600) await chmod(this.filePath, 0o600);

		const raw = await readFile(this.filePath, "utf8");
		if (raw.trim() === "") return emptyPayload();
		const parsed = JSON.parse(raw) as Partial<FallbackFilePayload>;
		if (parsed.version !== 1 || !parsed.secrets || typeof parsed.secrets !== "object") {
			throw new FallbackStoreError("Invalid pi-secret fallback file format");
		}
		return {
			version: 1,
			updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
			secrets: Object.fromEntries(
				Object.entries(parsed.secrets).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
			),
		};
	}

	private async writePayload(payload: FallbackFilePayload): Promise<void> {
		await this.ensureDirectory();
		if (await pathExistsNoFollow(this.filePath)) await this.assertRegularFileNoSymlink();

		const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
		const body = `${JSON.stringify(payload, null, 2)}\n`;
		try {
			await writeFile(tempPath, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
			await chmod(tempPath, 0o600);
			const handle = await open(tempPath, "r");
			try {
				await handle.sync();
			} finally {
				await handle.close();
			}
			await rename(tempPath, this.filePath);
			await chmod(this.filePath, 0o600);
			await fsyncDirectory(this.rootDir);
		} catch (error) {
			await rm(tempPath, { force: true }).catch(() => undefined);
			throw error;
		}
	}

	private async ensureDirectory(): Promise<void> {
		await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
		await chmod(this.rootDir, 0o700).catch(() => undefined);
		const stats = await lstat(this.rootDir);
		if (!stats.isDirectory() || stats.isSymbolicLink()) {
			throw new FallbackStoreError("pi-secret fallback directory must be a real directory, not a symlink");
		}
	}

	private async assertRegularFileNoSymlink(): Promise<void> {
		const stats = await lstat(this.filePath);
		if (stats.isSymbolicLink()) {
			throw new FallbackStoreError("Refusing to use symlinked pi-secret fallback file");
		}
		if (!stats.isFile()) {
			throw new FallbackStoreError("pi-secret fallback path must be a regular file");
		}
	}

	private assertStrictPath(): void {
		if (!isAbsolute(this.filePath)) {
			throw new FallbackStoreError("pi-secret fallback path must resolve to an absolute path");
		}
		if (this.filePath.includes(`${sep}..${sep}`)) {
			throw new FallbackStoreError("pi-secret fallback path must not contain traversal segments");
		}
	}
}

export function resolveFallbackFilePath(pathFromSettings?: string): string {
	return new FallbackSecretStore(pathFromSettings).filePath;
}

function emptyPayload(): FallbackFilePayload {
	return { version: 1, updatedAt: new Date(0).toISOString(), secrets: {} };
}

function expandHome(input: string): string {
	if (input === "~") return homedir();
	if (input.startsWith(`~${sep}`) || input.startsWith("~/")) return join(homedir(), input.slice(2));
	return input;
}

async function pathExistsNoFollow(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

async function fsyncDirectory(path: string): Promise<void> {
	try {
		const handle = await open(path, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	} catch {
		// Directory fsync is best-effort across platforms.
	}
}
