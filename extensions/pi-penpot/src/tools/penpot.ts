/**
 * pi-penpot — Main tool for project/file/team/library/media/webhook operations.
 *
 * Covers the organizational layer of the Penpot API.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { apiGet, apiPost, apiDownload, isClientReady, getEndpoint } from "../client.ts";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@earendil-works/pi-coding-agent";
import type {
	Profile,
	Team,
	Project,
	File,
	Webhook,
	Snapshot,
	FontVariant,
} from "../types.ts";

const ACTIONS = [
	// Profile & Teams
	"get-profile",
	"get-teams",
	"get-team-members",
	// Projects
	"get-projects",
	"create-project",
	"rename-project",
	"delete-project",
	"duplicate-project",
	// Files
	"get-project-files",
	"get-file",
	"get-file-summary",
	"create-file",
	"rename-file",
	"delete-file",
	"duplicate-file",
	"move-files",
	"search-files",
	"export-file",
	// Libraries
	"get-file-libraries",
	"get-shared-files",
	"link-library",
	"unlink-library",
	"set-file-shared",
	// Media
	"get-thumbnails",
	// Fonts
	"get-fonts",
	// Webhooks
	"get-webhooks",
	"create-webhook",
	"update-webhook",
	"delete-webhook",
	// Share Links
	"create-share-link",
	"delete-share-link",
	// Snapshots
	"get-snapshots",
	"create-snapshot",
	"restore-snapshot",
	// Misc
	"status",
] as const;

function text(s: string) {
	return { content: [{ type: "text" as const, text: s }], details: {} };
}

function truncateOutput(s: string): string {
	const result = truncateHead(s, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
	if (result.truncated) {
		return result.content + `\n\n[Output truncated: ${result.outputLines}/${result.totalLines} lines, ${formatSize(result.outputBytes)}/${formatSize(result.totalBytes)}]`;
	}
	return result.content;
}

export function registerPenpotTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "penpot",
		label: "Penpot",
		description:
			"Penpot design tool — manage projects, files, teams, libraries, media, webhooks, snapshots, and share links. " +
			"Use penpot_page for page/shape operations and penpot_comment for comments.",
		promptSnippet:
			"Manage Penpot projects, files, teams, libraries, webhooks, snapshots, and share links",
		promptGuidelines: [
			"Use the `penpot` tool for organizational operations (projects, files, teams, libraries, webhooks).",
			"Use `penpot_page` for page content and shape creation/modification.",
			"Use `penpot_comment` for comment threads and collaboration.",
			"Most actions require IDs (teamId, projectId, fileId) — use get-teams/get-projects/get-project-files to discover them.",
		],
		parameters: Type.Object({
			action: StringEnum(ACTIONS, { description: "Operation to perform" }),
			teamId: Type.Optional(Type.String({ description: "Team UUID" })),
			projectId: Type.Optional(Type.String({ description: "Project UUID" })),
			fileId: Type.Optional(Type.String({ description: "File UUID" })),
			id: Type.Optional(Type.String({ description: "Entity UUID (for delete/update by ID)" })),
			name: Type.Optional(Type.String({ description: "Name for create/rename" })),
			searchTerm: Type.Optional(Type.String({ description: "Search term (for search-files)" })),
			uri: Type.Optional(Type.String({ description: "Webhook callback URL" })),
			mtype: Type.Optional(Type.String({ description: "Webhook content type: 'application/json' or 'application/transit+json'" })),
			isActive: Type.Optional(Type.Boolean({ description: "Webhook active state" })),
			isShared: Type.Optional(Type.Boolean({ description: "Whether file is shared as library" })),
			libraryId: Type.Optional(Type.String({ description: "Library file UUID (for link/unlink)" })),
			targetProjectId: Type.Optional(Type.String({ description: "Target project UUID (for move-files)" })),
			fileIds: Type.Optional(Type.Array(Type.String(), { description: "Array of file UUIDs (for move-files)" })),
			label: Type.Optional(Type.String({ description: "Label for snapshot" })),
			includeLibraries: Type.Optional(Type.Boolean({ description: "Include libraries in export (default: false)" })),
			embedAssets: Type.Optional(Type.Boolean({ description: "Embed assets in export (default: true)" })),
			pages: Type.Optional(Type.Array(Type.String(), { description: "Page UUIDs (for share-link)" })),
			whoComment: Type.Optional(Type.String({ description: "Who can comment on share link: 'all' or 'team'" })),
			whoInspect: Type.Optional(Type.String({ description: "Who can inspect on share link: 'all' or 'team'" })),
		}),

		async execute(_toolCallId, params, signal) {
			if (!isClientReady()) {
				return text('❌ Penpot not configured. Add endpoint and accessToken to settings.json under "pi-penpot".');
			}

			try {
				switch (params.action) {
					// ── Profile & Teams ──
					case "get-profile":
						return await handleGetProfile(signal);
					case "get-teams":
						return await handleGetTeams(signal);
					case "get-team-members":
						return await handleGetTeamMembers(params, signal);

					// ── Projects ──
					case "get-projects":
						return await handleGetProjects(params, signal);
					case "create-project":
						return await handleCreateProject(params, signal);
					case "rename-project":
						return await handleRenameProject(params, signal);
					case "delete-project":
						return await handleDeleteProject(params, signal);
					case "duplicate-project":
						return await handleDuplicateProject(params, signal);

					// ── Files ──
					case "get-project-files":
						return await handleGetProjectFiles(params, signal);
					case "get-file":
						return await handleGetFile(params, signal);
					case "get-file-summary":
						return await handleGetFileSummary(params, signal);
					case "create-file":
						return await handleCreateFile(params, signal);
					case "rename-file":
						return await handleRenameFile(params, signal);
					case "delete-file":
						return await handleDeleteFile(params, signal);
					case "duplicate-file":
						return await handleDuplicateFile(params, signal);
					case "move-files":
						return await handleMoveFiles(params, signal);
					case "search-files":
						return await handleSearchFiles(params, signal);
					case "export-file":
						return await handleExportFile(params, signal);

					// ── Libraries ──
					case "get-file-libraries":
						return await handleGetFileLibraries(params, signal);
					case "get-shared-files":
						return await handleGetSharedFiles(params, signal);
					case "link-library":
						return await handleLinkLibrary(params, signal);
					case "unlink-library":
						return await handleUnlinkLibrary(params, signal);
					case "set-file-shared":
						return await handleSetFileShared(params, signal);

					// ── Media ──
					case "get-thumbnails":
						return await handleGetThumbnails(params, signal);

					// ── Fonts ──
					case "get-fonts":
						return await handleGetFonts(params, signal);

					// ── Webhooks ──
					case "get-webhooks":
						return await handleGetWebhooks(params, signal);
					case "create-webhook":
						return await handleCreateWebhook(params, signal);
					case "update-webhook":
						return await handleUpdateWebhook(params, signal);
					case "delete-webhook":
						return await handleDeleteWebhook(params, signal);

					// ── Share Links ──
					case "create-share-link":
						return await handleCreateShareLink(params, signal);
					case "delete-share-link":
						return await handleDeleteShareLink(params, signal);

					// ── Snapshots ──
					case "get-snapshots":
						return await handleGetSnapshots(params, signal);
					case "create-snapshot":
						return await handleCreateSnapshot(params, signal);
					case "restore-snapshot":
						return await handleRestoreSnapshot(params, signal);

					// ── Misc ──
					case "status":
						return handleStatus();

					default:
						return text(`Unknown action: ${(params as any).action}`);
				}
			} catch (err: any) {
				return text(`❌ Penpot error: ${err.message}`);
			}
		},
	});
}

// ══════════════════════════════════════════════════════════════════
// Profile & Teams
// ══════════════════════════════════════════════════════════════════

async function handleGetProfile(signal?: AbortSignal) {
	const profile = await apiGet<Profile>("get-profile", {}, signal);
	const lines = [
		`**Profile**`,
		`- **Name:** ${profile.fullname}`,
		`- **Email:** ${profile.email ?? "—"}`,
		`- **ID:** \`${profile.id}\``,
		`- **Default Team:** \`${profile.defaultTeamId ?? "—"}\``,
		`- **Default Project:** \`${profile.defaultProjectId ?? "—"}\``,
	];
	return text(lines.join("\n"));
}

async function handleGetTeams(signal?: AbortSignal) {
	const teams = await apiGet<Team[]>("get-teams", {}, signal);
	if (teams.length === 0) return text("No teams found.");

	const lines = [
		`**Teams** — ${teams.length} found`,
		"",
		"| Name | ID | Default | Permissions |",
		"|------|-----|---------|-------------|",
		...teams.map(t =>
			`| ${t.name} | \`${t.id}\` | ${t.isDefault ? "✓" : ""} | ${t.permissions.isOwner ? "owner" : t.permissions.isAdmin ? "admin" : t.permissions.canEdit ? "editor" : "viewer"} |`
		),
	];
	return text(lines.join("\n"));
}

async function handleGetTeamMembers(params: any, signal?: AbortSignal) {
	if (!params.teamId) return text("❌ 'teamId' is required");
	const members = await apiPost<any[]>("get-team-members", { teamId: params.teamId }, signal);
	if (members.length === 0) return text("No members found.");

	const lines = [
		`**Team Members** — ${members.length} found`,
		"",
		"| Name | Email | ID | Role |",
		"|------|-------|----|------|",
		...members.map((m: any) =>
			`| ${m.name ?? m.fullname ?? "—"} | ${m.email ?? "—"} | \`${m.id}\` | ${m.isOwner ? "owner" : m.isAdmin ? "admin" : m.canEdit ? "editor" : "viewer"} |`
		),
	];
	return text(lines.join("\n"));
}

// ══════════════════════════════════════════════════════════════════
// Projects
// ══════════════════════════════════════════════════════════════════

async function handleGetProjects(params: any, signal?: AbortSignal) {
	if (!params.teamId) return text("❌ 'teamId' is required");
	const projects = await apiPost<Project[]>("get-projects", { teamId: params.teamId }, signal);
	if (projects.length === 0) return text("No projects found.");

	const lines = [
		`**Projects** — ${projects.length} found`,
		"",
		"| Name | ID | Files | Default | Pinned |",
		"|------|----|-------|---------|--------|",
		...projects.map(p =>
			`| ${p.name} | \`${p.id}\` | ${p.count ?? "—"} | ${p.isDefault ? "✓" : ""} | ${p.isPinned ? "📌" : ""} |`
		),
	];
	return text(lines.join("\n"));
}

async function handleCreateProject(params: any, signal?: AbortSignal) {
	if (!params.teamId) return text("❌ 'teamId' is required");
	if (!params.name) return text("❌ 'name' is required");
	const project = await apiPost<Project>("create-project", {
		teamId: params.teamId,
		name: params.name,
	}, signal);
	return text(`✅ Project created: **${project.name}** (\`${project.id}\`)`);
}

async function handleRenameProject(params: any, signal?: AbortSignal) {
	if (!params.id) return text("❌ 'id' is required");
	if (!params.name) return text("❌ 'name' is required");
	await apiPost("rename-project", { id: params.id, name: params.name }, signal);
	return text(`✅ Project renamed to **${params.name}**`);
}

async function handleDeleteProject(params: any, signal?: AbortSignal) {
	if (!params.id) return text("❌ 'id' is required");
	await apiPost("delete-project", { id: params.id }, signal);
	return text(`✅ Project deleted`);
}

async function handleDuplicateProject(params: any, signal?: AbortSignal) {
	if (!params.projectId) return text("❌ 'projectId' is required");
	const result = await apiPost<Project>("duplicate-project", { projectId: params.projectId }, signal);
	return text(`✅ Project duplicated: **${result.name}** (\`${result.id}\`)`);
}

// ══════════════════════════════════════════════════════════════════
// Files
// ══════════════════════════════════════════════════════════════════

async function handleGetProjectFiles(params: any, signal?: AbortSignal) {
	if (!params.projectId) return text("❌ 'projectId' is required");
	const files = await apiPost<File[]>("get-project-files", { projectId: params.projectId }, signal);
	if (files.length === 0) return text("No files found.");

	const lines = [
		`**Files** — ${files.length} found`,
		"",
		"| Name | ID | Shared | Rev | Modified |",
		"|------|----|--------|-----|----------|",
		...files.map(f =>
			`| ${f.name} | \`${f.id}\` | ${f.isShared ? "✓" : ""} | ${f.revn} | ${formatDate(f.modifiedAt)} |`
		),
	];
	return text(lines.join("\n"));
}

async function handleGetFile(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	const file = await apiPost<File>("get-file", { id: params.fileId }, signal);

	const lines = [
		`**File:** ${file.name}`,
		`- **ID:** \`${file.id}\``,
		`- **Project:** \`${file.projectId}\``,
		`- **Shared:** ${file.isShared ? "Yes" : "No"}`,
		`- **Revision:** ${file.revn} (v${file.vern})`,
		`- **Modified:** ${formatDate(file.modifiedAt)}`,
	];

	// List pages if data is present
	// data.pages = ordered list of page IDs, data.pagesIndex = map of pageId → page data
	if (file.data?.pages) {
		lines.push("", "**Pages:**");
		for (const pageId of file.data.pages) {
			const page = file.data.pagesIndex?.[pageId];
			if (page) {
				const objectCount = page.objects ? Object.keys(page.objects).length : 0;
				lines.push(`- \`${pageId}\` — **${page.name}** (${objectCount} objects)`);
			} else {
				lines.push(`- \`${pageId}\``);
			}
		}
	}

	return text(truncateOutput(lines.join("\n")));
}

async function handleGetFileSummary(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	const summary = await apiPost<any>("get-file-summary", { id: params.fileId }, signal);
	return text(truncateOutput(`**File Summary**\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``));
}

async function handleCreateFile(params: any, signal?: AbortSignal) {
	if (!params.projectId) return text("❌ 'projectId' is required");
	if (!params.name) return text("❌ 'name' is required");
	const file = await apiPost<File>("create-file", {
		projectId: params.projectId,
		name: params.name,
		isShared: params.isShared ?? false,
	}, signal);
	return text(`✅ File created: **${file.name}** (\`${file.id}\`)`);
}

async function handleRenameFile(params: any, signal?: AbortSignal) {
	if (!params.id) return text("❌ 'id' (fileId) is required");
	if (!params.name) return text("❌ 'name' is required");
	await apiPost("rename-file", { id: params.id, name: params.name }, signal);
	return text(`✅ File renamed to **${params.name}**`);
}

async function handleDeleteFile(params: any, signal?: AbortSignal) {
	if (!params.id) return text("❌ 'id' (fileId) is required");
	await apiPost("delete-file", { id: params.id }, signal);
	return text(`✅ File deleted`);
}

async function handleDuplicateFile(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	const result = await apiPost<File>("duplicate-file", { fileId: params.fileId }, signal);
	return text(`✅ File duplicated: **${result.name}** (\`${result.id}\`)`);
}

async function handleMoveFiles(params: any, signal?: AbortSignal) {
	if (!params.fileIds || params.fileIds.length === 0) return text("❌ 'fileIds' is required");
	if (!params.targetProjectId) return text("❌ 'targetProjectId' is required");
	await apiPost("move-files", {
		ids: params.fileIds,
		projectId: params.targetProjectId,
	}, signal);
	return text(`✅ Moved ${params.fileIds.length} file(s) to project \`${params.targetProjectId}\``);
}

async function handleSearchFiles(params: any, signal?: AbortSignal) {
	if (!params.teamId) return text("❌ 'teamId' is required");
	const files = await apiPost<File[]>("search-files", {
		teamId: params.teamId,
		searchTerm: params.searchTerm ?? "",
	}, signal);
	if (files.length === 0) return text("No files found matching search.");

	const lines = [
		`**Search Results** — ${files.length} found`,
		"",
		"| Name | ID | Project | Modified |",
		"|------|----|---------|----------|",
		...files.map(f =>
			`| ${f.name} | \`${f.id}\` | \`${f.projectId}\` | ${formatDate(f.modifiedAt)} |`
		),
	];
	return text(lines.join("\n"));
}

async function handleExportFile(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");

	const { data, contentType } = await apiDownload("export-binfile", {
		fileId: params.fileId,
		includeLibraries: params.includeLibraries ?? false,
		embedAssets: params.embedAssets ?? true,
	}, signal);

	// Save to temp file
	const path = await import("node:path");
	const os = await import("node:os");
	const fs = await import("node:fs");

	const tempDir = os.tmpdir();
	const filename = `penpot-export-${params.fileId.slice(0, 8)}.penpot`;
	const filePath = path.join(tempDir, filename);
	await fs.promises.writeFile(filePath, data);

	return text(`✅ File exported (${formatSize(data.length)}, ${contentType})\nSaved to: \`${filePath}\``);
}

// ══════════════════════════════════════════════════════════════════
// Libraries
// ══════════════════════════════════════════════════════════════════

async function handleGetFileLibraries(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	const libs = await apiPost<any[]>("get-file-libraries", { fileId: params.fileId }, signal);
	if (libs.length === 0) return text("No linked libraries.");

	const lines = [
		`**Libraries** — ${libs.length} linked`,
		"",
		"| Name | ID | Synced |",
		"|------|----|--------|",
		...libs.map((l: any) => `| ${l.name ?? "—"} | \`${l.id}\` | ${l.synced !== false ? "✓" : "✗"} |`),
	];
	return text(lines.join("\n"));
}

async function handleGetSharedFiles(params: any, signal?: AbortSignal) {
	if (!params.teamId) return text("❌ 'teamId' is required");
	const files = await apiPost<File[]>("get-team-shared-files", { teamId: params.teamId }, signal);
	if (files.length === 0) return text("No shared library files.");

	const lines = [
		`**Shared Files** — ${files.length} found`,
		"",
		"| Name | ID | Project |",
		"|------|----|---------|",
		...files.map(f => `| ${f.name} | \`${f.id}\` | \`${f.projectId}\` |`),
	];
	return text(lines.join("\n"));
}

async function handleLinkLibrary(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.libraryId) return text("❌ 'libraryId' is required");
	await apiPost("link-file-to-library", { fileId: params.fileId, libraryId: params.libraryId }, signal);
	return text(`✅ Library \`${params.libraryId}\` linked to file \`${params.fileId}\``);
}

async function handleUnlinkLibrary(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.libraryId) return text("❌ 'libraryId' is required");
	await apiPost("unlink-file-from-library", { fileId: params.fileId, libraryId: params.libraryId }, signal);
	return text(`✅ Library \`${params.libraryId}\` unlinked from file \`${params.fileId}\``);
}

async function handleSetFileShared(params: any, signal?: AbortSignal) {
	if (!params.id) return text("❌ 'id' (fileId) is required");
	const shared = params.isShared ?? true;
	await apiPost("set-file-shared", { id: params.id, isShared: shared }, signal);
	return text(`✅ File \`${params.id}\` is now ${shared ? "shared as library" : "not shared"}`);
}

// ══════════════════════════════════════════════════════════════════
// Media
// ══════════════════════════════════════════════════════════════════

async function handleGetThumbnails(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	const thumbs = await apiPost<Record<string, string>>("get-file-object-thumbnails", { fileId: params.fileId }, signal);
	const entries = Object.entries(thumbs);
	if (entries.length === 0) return text("No thumbnails found.");

	const lines = [
		`**Thumbnails** — ${entries.length} found`,
		"",
		...entries.slice(0, 50).map(([id, url]) => `- \`${id}\`: ${url}`),
	];
	if (entries.length > 50) lines.push(`\n… and ${entries.length - 50} more`);
	return text(lines.join("\n"));
}

// ══════════════════════════════════════════════════════════════════
// Fonts
// ══════════════════════════════════════════════════════════════════

async function handleGetFonts(params: any, signal?: AbortSignal) {
	if (!params.teamId) return text("❌ 'teamId' is required");
	const fonts = await apiPost<FontVariant[]>("get-font-variants", { teamId: params.teamId }, signal);
	if (fonts.length === 0) return text("No custom fonts found.");

	const lines = [
		`**Fonts** — ${fonts.length} variants`,
		"",
		"| Family | Weight | Style | ID |",
		"|--------|--------|-------|----|",
		...fonts.map(f =>
			`| ${f.fontFamily} | ${f.fontWeight} | ${f.fontStyle} | \`${f.id}\` |`
		),
	];
	return text(lines.join("\n"));
}

// ══════════════════════════════════════════════════════════════════
// Webhooks
// ══════════════════════════════════════════════════════════════════

async function handleGetWebhooks(params: any, signal?: AbortSignal) {
	if (!params.teamId) return text("❌ 'teamId' is required");
	const hooks = await apiPost<Webhook[]>("get-webhooks", { teamId: params.teamId }, signal);
	if (hooks.length === 0) return text("No webhooks configured.");

	const lines = [
		`**Webhooks** — ${hooks.length} found`,
		"",
		"| URI | Type | Active | ID |",
		"|-----|------|--------|----|",
		...hooks.map(h =>
			`| ${h.uri} | ${h.mtype} | ${h.isActive ? "✓" : "✗"} | \`${h.id}\` |`
		),
	];
	return text(lines.join("\n"));
}

async function handleCreateWebhook(params: any, signal?: AbortSignal) {
	if (!params.teamId) return text("❌ 'teamId' is required");
	if (!params.uri) return text("❌ 'uri' is required");
	const hook = await apiPost<Webhook>("create-webhook", {
		teamId: params.teamId,
		uri: params.uri,
		mtype: params.mtype ?? "application/json",
		isActive: params.isActive ?? true,
	}, signal);
	return text(`✅ Webhook created: \`${hook.id}\``);
}

async function handleUpdateWebhook(params: any, signal?: AbortSignal) {
	if (!params.id) return text("❌ 'id' is required");
	const body: Record<string, any> = { id: params.id };
	if (params.uri) body.uri = params.uri;
	if (params.mtype) body.mtype = params.mtype;
	if (params.isActive !== undefined) body.isActive = params.isActive;
	await apiPost("update-webhook", body, signal);
	return text(`✅ Webhook \`${params.id}\` updated`);
}

async function handleDeleteWebhook(params: any, signal?: AbortSignal) {
	if (!params.id) return text("❌ 'id' is required");
	await apiPost("delete-webhook", { id: params.id }, signal);
	return text(`✅ Webhook deleted`);
}

// ══════════════════════════════════════════════════════════════════
// Share Links
// ══════════════════════════════════════════════════════════════════

async function handleCreateShareLink(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");

	// pages is required by the API — if not provided, fetch all pages from the file
	let pages: string[] = params.pages;
	if (!pages || pages.length === 0) {
		const file = await apiPost<any>("get-file", { id: params.fileId }, signal);
		pages = file.data?.pages ?? [];
		if (pages.length === 0) return text("❌ File has no pages");
	}

	const body: Record<string, any> = {
		fileId: params.fileId,
		pages,
		whoComment: params.whoComment ?? "all",
		whoInspect: params.whoInspect ?? "all",
	};
	const link = await apiPost<any>("create-share-link", body, signal);
	const firstPage = pages[0];
	const shareUrl = `${getEndpoint()}/#/view?file-id=${params.fileId}&page-id=${firstPage}&section=interactions&index=0&share-id=${link.id}`;
	return text(`✅ Share link created\n- **URL:** ${shareUrl}\n- **Share ID:** \`${link.id}\`\n- **Pages:** ${pages.length}`);
}

async function handleDeleteShareLink(params: any, signal?: AbortSignal) {
	if (!params.id) return text("❌ 'id' is required");
	await apiPost("delete-share-link", { id: params.id }, signal);
	return text(`✅ Share link deleted`);
}

// ══════════════════════════════════════════════════════════════════
// Snapshots
// ══════════════════════════════════════════════════════════════════

async function handleGetSnapshots(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	const snaps = await apiPost<Snapshot[]>("get-file-snapshots", { fileId: params.fileId }, signal);
	if (snaps.length === 0) return text("No snapshots found.");

	const lines = [
		`**Snapshots** — ${snaps.length} found`,
		"",
		"| Label | Rev | Created | ID |",
		"|-------|-----|---------|-----|",
		...snaps.map(s =>
			`| ${s.label ?? "—"} | ${s.revn} | ${formatDate(s.createdAt)} | \`${s.id}\` |`
		),
	];
	return text(lines.join("\n"));
}

async function handleCreateSnapshot(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	const snap = await apiPost<Snapshot>("create-file-snapshot", {
		fileId: params.fileId,
		label: params.label ?? undefined,
	}, signal);
	return text(`✅ Snapshot created: \`${snap.id}\` (rev ${snap.revn})`);
}

async function handleRestoreSnapshot(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.id) return text("❌ 'id' (snapshot ID) is required");
	await apiPost("restore-file-snapshot", { fileId: params.fileId, id: params.id }, signal);
	return text(`✅ Snapshot \`${params.id}\` restored`);
}

// ══════════════════════════════════════════════════════════════════
// Misc
// ══════════════════════════════════════════════════════════════════

function handleStatus() {
	if (!isClientReady()) {
		return text("Penpot: ❌ Not configured");
	}
	return text(`Penpot: ✅ Connected to ${getEndpoint()}`);
}

// ── Helpers ─────────────────────────────────────────────────────

function formatDate(iso: string | undefined): string {
	if (!iso) return "—";
	try {
		const d = new Date(iso);
		return d.toISOString().replace("T", " ").slice(0, 16);
	} catch {
		return iso;
	}
}
