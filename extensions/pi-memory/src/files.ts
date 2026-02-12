/**
 * pi-memory — File operations.
 *
 * Memory lives as plain Markdown on disk:
 *   MEMORY.md            — Curated long-term memory
 *   memory/YYYY-MM-DD.md — Append-only daily logs
 *
 * The base directory defaults to cwd but can be set via settings.json:
 *   { "pi-memory": { "path": "/custom/path" } }
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── State ───────────────────────────────────────────────────────

let basePath: string = process.cwd();

export function setBasePath(p: string): void {
	basePath = p;
}

export function getBasePath(): string {
	return basePath;
}

// ── Paths ───────────────────────────────────────────────────────

export function longTermPath(): string {
	return path.join(basePath, "MEMORY.md");
}

export function memoryDir(): string {
	return path.join(basePath, "memory");
}

export function dailyPath(date?: string): string {
	return path.join(memoryDir(), `${date ?? todayStr()}.md`);
}

// ── Date helpers ────────────────────────────────────────────────

export function todayStr(): string {
	return localDateStr(new Date());
}

export function yesterdayStr(): string {
	const d = new Date();
	d.setDate(d.getDate() - 1);
	return localDateStr(d);
}

function localDateStr(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ── File I/O ────────────────────────────────────────────────────

export function ensureDir(dir: string): void {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readFileOr(filePath: string, fallback = ""): string {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return fallback;
	}
}

export function writeFile(filePath: string, content: string): void {
	ensureDir(path.dirname(filePath));
	fs.writeFileSync(filePath, content, "utf-8");
}

export function appendToFile(filePath: string, content: string): void {
	ensureDir(path.dirname(filePath));
	const existing = readFileOr(filePath);
	const sep = existing && !existing.endsWith("\n") ? "\n" : "";
	fs.writeFileSync(filePath, existing + sep + content + "\n", "utf-8");
}

// ── Daily log listing ───────────────────────────────────────────

export function listDailyFiles(): string[] {
	const dir = memoryDir();
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir)
		.filter(f => f.endsWith(".md"))
		.sort()
		.reverse();
}

// ── All memory files (for search) ───────────────────────────────

export function allMemoryFiles(): Array<{ label: string; path: string }> {
	const files: Array<{ label: string; path: string }> = [];
	const ltm = longTermPath();
	if (fs.existsSync(ltm)) files.push({ label: "MEMORY.md", path: ltm });
	for (const f of listDailyFiles()) {
		files.push({ label: `memory/${f}`, path: path.join(memoryDir(), f) });
	}
	return files;
}
