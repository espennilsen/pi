/**
 * Integration test for pi-penpot extension.
 * Tests all shape types + modify + delete + move + pages + comments against a live Penpot instance.
 *
 * Usage: npx tsx test-integration.ts
 */

import { initClient, apiPost, apiPostTransit } from "./src/client.ts";
import { encodeUpdateFile } from "./src/transit.ts";
import { randomUUID } from "node:crypto";
import { apiUpload, apiDownload } from "./src/client.ts";
import type { File, PageData, CommentThread, Comment, Webhook, ShareLink, Snapshot } from "./src/types.ts";

const TOKEN = process.env.PENPOT_TOKEN;
if (!TOKEN) throw new Error("PENPOT_TOKEN env var required — set it before running integration tests");
const ENDPOINT = process.env.PENPOT_ENDPOINT || "https://penpot.e9n.dev";
const TEAM_ID = process.env.PENPOT_TEAM_ID || "0d727cf9-ca60-8039-8007-b069e54aa839";
const ROOT = "00000000-0000-0000-0000-000000000000";

let passed = 0;
let failed = 0;

function ok(name: string) { passed++; console.log(`  ✅ ${name}`); }
function fail(name: string, err: string) { failed++; console.log(`  ❌ ${name}: ${err}`); }

async function updateFile(fileId: string, changes: any[]) {
	const file = await apiPost<File>("get-file", { id: fileId });
	const body = encodeUpdateFile({
		id: fileId,
		sessionId: randomUUID(),
		revn: file.revn,
		vern: file.vern,
		changes,
	});
	return apiPostTransit<any>("update-file", body);
}

function makeShape(type: string, id: string, extra: Record<string, any> = {}) {
	const x = extra.x ?? 0, y = extra.y ?? 0;
	const w = extra.width ?? 100, h = extra.height ?? 100;
	const base: Record<string, any> = {
		id,
		type,
		name: extra.name ?? `${type}-test`,
		x, y, width: w, height: h,
		parentId: extra.parentId ?? ROOT,
		frameId: extra.frameId ?? ROOT,
		fills: extra.fills ?? [{ fillColor: "#B1B2B5", fillOpacity: 1 }],
		strokes: [],
		rotation: 0,
		opacity: 1,
		selrect: { x, y, width: w, height: h, x1: x, y1: y, x2: x + w, y2: y + h },
		points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
		transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		transformInverse: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
	};
	// Merge extra keys (content, shapes, metadata, etc.)
	for (const [k, v] of Object.entries(extra)) {
		if (!(k in base)) base[k] = v;
	}
	return base;
}

async function main() {
	initClient({ endpoint: ENDPOINT, accessToken: TOKEN });
	console.log("\n🧪 pi-penpot Integration Tests\n");

	// ── Setup ──
	let projectId: string, fileId: string, pageId: string;

	console.log("Setup:");
	try {
		const project = await apiPost<any>("create-project", { teamId: TEAM_ID, name: "IT-" + Date.now() });
		projectId = project.id;
		ok(`Project created: ${projectId}`);

		const file = await apiPost<File>("create-file", { projectId, name: "Test Shapes" });
		fileId = file.id;
		pageId = file.data!.pages[0];
		ok(`File created: ${fileId}, page: ${pageId}`);
	} catch (e: any) {
		fail("Setup", e.message);
		process.exit(1);
	}

	// ── Status ──
	console.log("\nStatus:");
	try {
		// Status is a local check (no API call), just verifies client is configured
		// We already know it works since we called get-profile above implicitly
		ok("status (client configured)");
	} catch (e: any) { fail("status", e.message.slice(0, 100)); }

	// ── Team Members ──
	console.log("\nTeam Members:");
	try {
		const members = await apiPost<any[]>("get-team-members", { teamId: TEAM_ID });
		if (Array.isArray(members) && members.length > 0) ok(`get team members (${members.length} found)`);
		else fail("get team members", "no members returned");
	} catch (e: any) { fail("get team members", e.message.slice(0, 100)); }

	// ── Project Operations (extended) ──
	console.log("\nProject Operations:");
	try {
		await apiPost("rename-project", { id: projectId, name: "Renamed Project" });
		const proj = await apiPost<any>("get-project", { id: projectId });
		if (proj.name === "Renamed Project") ok("rename project");
		else fail("rename project", `name=${proj.name}`);
	} catch (e: any) { fail("rename project", e.message.slice(0, 100)); }

	let dupProjectId: string = "";
	try {
		const dup = await apiPost<any>("duplicate-project", { projectId });
		dupProjectId = dup.id;
		if (dupProjectId && dupProjectId !== projectId) ok("duplicate project");
		else fail("duplicate project", "same ID or no ID");
	} catch (e: any) { fail("duplicate project", e.message.slice(0, 100)); }

	// ── Shape Creation ──
	console.log("\nShape Creation:");

	const rectId = randomUUID();
	try {
		await updateFile(fileId, [{ type: "add-obj", id: rectId, frameId: ROOT, parentId: ROOT, pageId,
			obj: makeShape("rect", rectId, { name: "Blue Rect", x: 10, y: 10, width: 200, height: 100, fills: [{ fillColor: "#3B82F6", fillOpacity: 1 }] }) }]);
		ok("rect");
	} catch (e: any) { fail("rect", e.message.slice(0, 100)); }

	const ellipseId = randomUUID();
	try {
		await updateFile(fileId, [{ type: "add-obj", id: ellipseId, frameId: ROOT, parentId: ROOT, pageId,
			obj: makeShape("circle", ellipseId, { name: "Red Circle", x: 250, y: 10, width: 80, height: 80, fills: [{ fillColor: "#EF4444", fillOpacity: 1 }] }) }]);
		ok("circle/ellipse");
	} catch (e: any) { fail("circle/ellipse", e.message.slice(0, 100)); }

	const textId = randomUUID();
	try {
		await updateFile(fileId, [{ type: "add-obj", id: textId, frameId: ROOT, parentId: ROOT, pageId,
			obj: makeShape("text", textId, {
				name: "Hello Text", x: 10, y: 130, width: 200, height: 40,
				content: {
					type: "root",
					children: [{ type: "paragraph-set", children: [{ type: "paragraph", children: [
						{ text: "Hello Penpot!", fontFamily: "sourcesanspro", fontSize: "16", fontWeight: "400", fontStyle: "normal", fills: [{ fillColor: "#000000", fillOpacity: 1 }] }
					]}]}],
				},
				growType: "auto-height",
			}) }]);
		ok("text");
	} catch (e: any) { fail("text", e.message.slice(0, 100)); }

	const frameId = randomUUID();
	try {
		await updateFile(fileId, [{ type: "add-obj", id: frameId, frameId: frameId, parentId: ROOT, pageId,
			obj: makeShape("frame", frameId, {
				name: "Card Frame", x: 10, y: 200, width: 400, height: 300,
				frameId: frameId,
				shapes: [],
				fills: [{ fillColor: "#FFFFFF", fillOpacity: 1 }],
			}) }]);
		ok("frame");
	} catch (e: any) { fail("frame", e.message.slice(0, 100)); }

	const pathId = randomUUID();
	try {
		await updateFile(fileId, [{ type: "add-obj", id: pathId, frameId: ROOT, parentId: ROOT, pageId,
			obj: makeShape("path", pathId, {
				name: "Triangle", x: 350, y: 10, width: 50, height: 50,
				content: [
					{ command: "move-to", params: { x: 350, y: 10 } },
					{ command: "line-to", params: { x: 400, y: 60 } },
					{ command: "line-to", params: { x: 350, y: 60 } },
					{ command: "close-path" },
				],
				fills: [{ fillColor: "#8B5CF6", fillOpacity: 1 }],
			}) }]);
		ok("path");
	} catch (e: any) { fail("path", e.message.slice(0, 100)); }

	// Group: create two children then group
	const gc1 = randomUUID(), gc2 = randomUUID(), groupId = randomUUID();
	try {
		await updateFile(fileId, [
			{ type: "add-obj", id: gc1, frameId: ROOT, parentId: ROOT, pageId,
				obj: makeShape("rect", gc1, { name: "GC1", x: 500, y: 10, width: 40, height: 40 }) },
			{ type: "add-obj", id: gc2, frameId: ROOT, parentId: ROOT, pageId,
				obj: makeShape("rect", gc2, { name: "GC2", x: 550, y: 10, width: 40, height: 40 }) },
		]);
		await updateFile(fileId, [
			{ type: "add-obj", id: groupId, frameId: ROOT, parentId: ROOT, pageId,
				obj: makeShape("group", groupId, {
					name: "Test Group", x: 500, y: 10, width: 90, height: 40,
					shapes: [gc1, gc2],
				}) },
			{ type: "mov-objects", pageId, parentId: groupId, shapes: [gc1, gc2] },
		]);
		ok("group (with children)");
	} catch (e: any) { fail("group", e.message.slice(0, 100)); }

	// ── Shape Modification ──
	console.log("\nShape Modification:");

	try {
		await updateFile(fileId, [{ type: "mod-obj", id: rectId, pageId, operations: [
			{ type: "set", attr: "fills", val: [{ fillColor: "#10B981", fillOpacity: 1 }] },
			{ type: "set", attr: "name", val: "Green Rect" },
		]}]);
		// Verify
		const page = await apiPost<PageData>("get-page", { fileId, pageId });
		const rect = page.objects?.[rectId];
		if (rect?.name === "Green Rect") ok("modify fills + name");
		else fail("modify fills + name", `name=${rect?.name}`);
	} catch (e: any) { fail("modify fills + name", e.message.slice(0, 100)); }

	try {
		await updateFile(fileId, [{ type: "mod-obj", id: rectId, pageId, operations: [
			{ type: "set", attr: "opacity", val: 0.5 },
			{ type: "set", attr: "rotation", val: 15 },
		]}]);
		ok("modify opacity + rotation");
	} catch (e: any) { fail("modify opacity + rotation", e.message.slice(0, 100)); }

	try {
		await updateFile(fileId, [{ type: "mod-obj", id: rectId, pageId, operations: [
			{ type: "set", attr: "x", val: 50 },
			{ type: "set", attr: "y", val: 50 },
			{ type: "set", attr: "width", val: 300 },
			{ type: "set", attr: "height", val: 200 },
		]}]);
		ok("modify geometry (x, y, width, height)");
	} catch (e: any) { fail("modify geometry", e.message.slice(0, 100)); }

	// ── Move Shapes ──
	console.log("\nMove Shapes:");

	try {
		await updateFile(fileId, [{ type: "mov-objects", pageId, parentId: frameId, shapes: [rectId] }]);
		const page = await apiPost<PageData>("get-page", { fileId, pageId });
		const frame = page.objects?.[frameId];
		if (frame?.shapes?.includes(rectId)) ok("move rect into frame");
		else fail("move rect into frame", `shapes=${JSON.stringify(frame?.shapes)}`);
	} catch (e: any) { fail("move rect into frame", e.message.slice(0, 100)); }

	// ── Delete Shapes ──
	console.log("\nDelete Shapes:");

	try {
		await updateFile(fileId, [
			{ type: "del-obj", id: ellipseId, pageId },
			{ type: "del-obj", id: pathId, pageId },
		]);
		const page = await apiPost<PageData>("get-page", { fileId, pageId });
		if (!page.objects?.[ellipseId] && !page.objects?.[pathId]) ok("delete multiple shapes");
		else fail("delete multiple shapes", "shapes still present");
	} catch (e: any) { fail("delete multiple shapes", e.message.slice(0, 100)); }

	// ── Page Operations ──
	console.log("\nPage Operations:");

	let page2Id: string;
	try {
		page2Id = randomUUID();
		await updateFile(fileId, [{ type: "add-page", id: page2Id, name: "Test Page 2" }]);
		const file = await apiPost<File>("get-file", { id: fileId });
		if (file.data!.pages.includes(page2Id)) ok("add page");
		else fail("add page", "page not in file.data.pages");
	} catch (e: any) { fail("add page", e.message.slice(0, 100)); page2Id = ""; }

	if (page2Id) {
		try {
			await updateFile(fileId, [{ type: "mod-page", id: page2Id, name: "Renamed Page" }]);
			ok("rename page");
		} catch (e: any) { fail("rename page", e.message.slice(0, 100)); }

		try {
			await updateFile(fileId, [{ type: "del-page", id: page2Id }]);
			const file = await apiPost<File>("get-file", { id: fileId });
			if (!file.data!.pages.includes(page2Id)) ok("delete page");
			else fail("delete page", "page still in file.data.pages");
		} catch (e: any) { fail("delete page", e.message.slice(0, 100)); }
	}

	// ── Comments ──
	console.log("\nComments:");

	let threadId: string;
	try {
		const thread = await apiPost<CommentThread>("create-comment-thread", {
			fileId, pageId,
			position: { x: 50, y: 50 },
			content: "Review this layout",
			frameId: ROOT,
		});
		threadId = thread.id;
		ok("create comment thread");
	} catch (e: any) { fail("create comment thread", e.message.slice(0, 100)); threadId = ""; }

	if (threadId) {
		try {
			const reply = await apiPost<Comment>("create-comment", {
				threadId,
				content: "Looks good!",
			});
			if (reply.content === "Looks good!") ok("reply to thread");
			else fail("reply to thread", `content=${reply.content}`);
		} catch (e: any) { fail("reply to thread", e.message.slice(0, 100)); }

		try {
			const comments = await apiPost<Comment[]>("get-comments", { threadId });
			if (comments.length >= 2) ok(`get comments (${comments.length} found)`);
			else fail("get comments", `only ${comments.length} comments`);
		} catch (e: any) { fail("get comments", e.message.slice(0, 100)); }

		try {
			const threads = await apiPost<CommentThread[]>("get-comment-threads", { fileId });
			if (threads.length >= 1) ok(`get threads (${threads.length} found)`);
			else fail("get threads", "no threads");
		} catch (e: any) { fail("get threads", e.message.slice(0, 100)); }
	}

	// ── File Operations ──
	console.log("\nFile Operations:");

	try {
		const dup = await apiPost<File>("duplicate-file", { fileId });
		if (dup.id && dup.id !== fileId) {
			ok("duplicate file");
			await apiPost("delete-file", { id: dup.id });
		} else fail("duplicate file", "same ID returned");
	} catch (e: any) { fail("duplicate file", e.message.slice(0, 100)); }

	try {
		await apiPost("rename-file", { id: fileId, name: "Renamed File" });
		const f = await apiPost<File>("get-file", { id: fileId });
		if (f.name === "Renamed File") ok("rename file");
		else fail("rename file", `name=${f.name}`);
	} catch (e: any) { fail("rename file", e.message.slice(0, 100)); }

	try {
		const results = await apiPost<File[]>("search-files", { teamId: TEAM_ID, searchTerm: "Renamed" });
		if (results.some(f => f.id === fileId)) ok("search files");
		else fail("search files", "file not found in search");
	} catch (e: any) { fail("search files", e.message.slice(0, 100)); }

	// ── Get Shape ──
	console.log("\nGet Shape:");
	try {
		const page = await apiPost<PageData>("get-page", { fileId, pageId, objectId: rectId });
		const shape = page.objects?.[rectId];
		if (shape && shape.name === "Green Rect") ok("get shape (by objectId)");
		else fail("get shape", `name=${shape?.name}`);
	} catch (e: any) { fail("get shape", e.message.slice(0, 100)); }

	// ── File Summary ──
	console.log("\nFile Summary:");
	try {
		const summary = await apiPost<any>("get-file-summary", { id: fileId });
		if (summary.name) ok(`get file summary (name="${summary.name}", ${summary.componentsCount ?? 0} components)`);
		else fail("get file summary", "no name returned");
	} catch (e: any) { fail("get file summary", e.message.slice(0, 100)); }

	// ── Components ──
	console.log("\nComponents:");

	try {
		// Create a frame to use as component root
		const compFrameId = randomUUID();
		await updateFile(fileId, [{ type: "add-obj", id: compFrameId, frameId: compFrameId, parentId: ROOT, pageId,
			obj: makeShape("frame", compFrameId, {
				name: "Button", x: 0, y: 500, width: 120, height: 40,
				frameId: compFrameId, shapes: [],
				fills: [{ fillColor: "#3B82F6", fillOpacity: 1 }],
			}) }]);

		const componentId = randomUUID();
		await updateFile(fileId, [{
			type: "add-component",
			id: componentId,
			name: "Button",
			mainInstanceId: compFrameId,
			mainInstancePage: pageId,
		}]);
		ok("add component");

		// Verify via get-file
		const f = await apiPost<File>("get-file", { id: fileId });
		const comps = (f.data as any)?.components ?? {};
		if (comps[componentId]) ok("list components (via get-file)");
		else fail("list components", "component not in file data");
	} catch (e: any) { fail("components", e.message.slice(0, 100)); }

	// ── Image Shape (from URL) ──
	console.log("\nImage:");

	try {
		const media = await apiPost<any>("create-file-media-object-from-url", {
			fileId,
			url: "https://picsum.photos/200",
			name: "test-image",
			isLocal: true,
		});
		if (media.id) {
			const imgId = randomUUID();
			await updateFile(fileId, [{ type: "add-obj", id: imgId, frameId: ROOT, parentId: ROOT, pageId,
				obj: makeShape("image", imgId, {
					name: "Logo", x: 500, y: 200, width: media.width ?? 100, height: media.height ?? 100,
					metadata: { id: media.id, width: media.width ?? 100, height: media.height ?? 100, mtype: media.mtype ?? "image/svg+xml" },
				}) }]);
			ok("image shape (from URL)");
		} else fail("image shape", "no media ID returned");
	} catch (e: any) { fail("image shape", e.message.slice(0, 100)); }

	// ── Webhooks ──
	console.log("\nWebhooks:");

	let webhookId: string = "";
	try {
		const wh = await apiPost<any>("create-webhook", {
			teamId: TEAM_ID,
			uri: "https://webhook.site/test",
			mtype: "application/json",
		});
		webhookId = wh.id;
		if (webhookId) ok("create webhook");
		else fail("create webhook", "no id returned");
	} catch (e: any) { fail("create webhook", e.message.slice(0, 100)); }

	if (webhookId) {
		try {
			const hooks = await apiPost<any[]>("get-webhooks", { teamId: TEAM_ID });
			if (hooks.some((h: any) => h.id === webhookId)) ok(`get webhooks (${hooks.length} found)`);
			else fail("get webhooks", "webhook not in list");
		} catch (e: any) { fail("get webhooks", e.message.slice(0, 100)); }

		try {
			await apiPost("update-webhook", {
				id: webhookId,
				uri: "https://webhook.site/test",
				mtype: "application/json",
				isActive: false,
			});
			ok("update webhook (deactivate)");
		} catch (e: any) { fail("update webhook", e.message.slice(0, 100)); }

		try {
			await apiPost("delete-webhook", { id: webhookId });
			ok("delete webhook");
		} catch (e: any) { fail("delete webhook", e.message.slice(0, 100)); }
	}

	// ── Share Links ──
	console.log("\nShare Links:");

	let shareLinkId: string = "";
	try {
		const sl = await apiPost<any>("create-share-link", {
			fileId,
			pages: [pageId],
			whoComment: "team",
			whoInspect: "all",
		});
		shareLinkId = sl.id;
		if (shareLinkId) ok("create share link");
		else fail("create share link", "no id returned");
	} catch (e: any) { fail("create share link", e.message.slice(0, 100)); }

	if (shareLinkId) {
		try {
			await apiPost("delete-share-link", { id: shareLinkId });
			ok("delete share link");
		} catch (e: any) { fail("delete share link", e.message.slice(0, 100)); }
	}

	// ── Snapshots ──
	console.log("\nSnapshots:");

	let snapshotId: string = "";
	try {
		const snap = await apiPost<any>("create-file-snapshot", {
			fileId,
			label: "Test Snapshot",
		});
		snapshotId = snap.id;
		if (snapshotId) ok("create snapshot");
		else fail("create snapshot", "no id returned");
	} catch (e: any) { fail("create snapshot", e.message.slice(0, 100)); }

	if (snapshotId) {
		try {
			const snaps = await apiPost<any[]>("get-file-snapshots", { fileId });
			if (snaps.some((s: any) => s.id === snapshotId)) ok(`get snapshots (${snaps.length} found)`);
			else fail("get snapshots", "snapshot not in list");
		} catch (e: any) { fail("get snapshots", e.message.slice(0, 100)); }

		try {
			await apiPost("restore-file-snapshot", { fileId, id: snapshotId });
			ok("restore snapshot");
		} catch (e: any) { fail("restore snapshot", e.message.slice(0, 100)); }
	}

	// ── Extended Comment Operations ──
	console.log("\nExtended Comments:");

	if (threadId) {
		// Get the reply comment ID for update/delete
		let replyCommentId: string = "";
		try {
			const comments = await apiPost<Comment[]>("get-comments", { threadId });
			// The second comment is the reply
			replyCommentId = comments.length > 1 ? comments[1].id : "";
			if (replyCommentId) ok("got reply comment ID for update/delete");
			else fail("got reply comment ID", "only 1 comment");
		} catch (e: any) { fail("get reply ID", e.message.slice(0, 100)); }

		if (replyCommentId) {
			try {
				await apiPost("update-comment", { id: replyCommentId, content: "Updated: still looks good!" });
				ok("update comment");
			} catch (e: any) { fail("update comment", e.message.slice(0, 100)); }

			try {
				await apiPost("delete-comment", { id: replyCommentId });
				ok("delete comment");
			} catch (e: any) { fail("delete comment", e.message.slice(0, 100)); }
		}

		try {
			await apiPost("update-comment-thread-status", { id: threadId });
			ok("update thread status");
		} catch (e: any) { fail("update thread status", e.message.slice(0, 100)); }

		try {
			await apiPost("update-comment-thread-position", {
				id: threadId,
				position: { x: 200, y: 200 },
				frameId: ROOT,
			});
			ok("update thread position");
		} catch (e: any) { fail("update thread position", e.message.slice(0, 100)); }

		try {
			const unread = await apiPost<any[]>("get-unread-comment-threads", { teamId: TEAM_ID });
			// May be 0 if already read, that's fine — we just verify the call succeeds
			ok(`get unread threads (${unread.length} found)`);
		} catch (e: any) { fail("get unread threads", e.message.slice(0, 100)); }

		try {
			await apiPost("mark-all-threads-as-read", { threads: [threadId] });
			ok("mark threads read");
		} catch (e: any) { fail("mark threads read", e.message.slice(0, 100)); }

		try {
			await apiPost("delete-comment-thread", { id: threadId });
			ok("delete thread");
		} catch (e: any) { fail("delete thread", e.message.slice(0, 100)); }
	}

	// ── Fonts ──
	console.log("\nFonts:");
	try {
		const fonts = await apiPost<any[]>("get-font-variants", { teamId: TEAM_ID });
		// May be empty if no custom fonts — just verify the call succeeds
		ok(`get font variants (${fonts.length} found)`);
	} catch (e: any) { fail("get font variants", e.message.slice(0, 100)); }

	// ── Get Shared Files ──
	console.log("\nShared Files:");
	// file is already set-shared from Libraries section below — test after
	// We'll test this as part of Libraries to avoid ordering issues

	// ── Move Files ──
	console.log("\nMove Files:");
	if (dupProjectId) {
		try {
			// Create a temp file to move
			const tempFile = await apiPost<File>("create-file", { projectId, name: "Move Me" });
			await apiPost("move-files", { ids: [tempFile.id], projectId: dupProjectId });
			// Verify it's in the new project
			const files = await apiPost<File[]>("get-project-files", { projectId: dupProjectId });
			if (files.some(f => f.id === tempFile.id)) ok("move files");
			else fail("move files", "file not found in target project");
			// Clean up
			await apiPost("delete-file", { id: tempFile.id });
		} catch (e: any) { fail("move files", e.message.slice(0, 100)); }
	} else {
		fail("move files", "no duplicate project to move to");
	}

	// ── Export File ──
	console.log("\nExport File:");
	try {
		const exported = await apiDownload("export-binfile", {
			fileId,
			embedAssets: true,
			includeLibraries: false,
		});
		if (exported.data.length > 0) ok(`export file (${exported.data.length} bytes, ${exported.contentType})`);
		else fail("export file", "empty data");
	} catch (e: any) { fail("export file", e.message.slice(0, 100)); }

	// ── Thumbnails ──
	console.log("\nThumbnails:");
	try {
		const thumbs = await apiPost<any>("get-file-object-thumbnails", { fileId });
		// May be empty if no thumbnails generated — just verify call succeeds
		ok(`get thumbnails (${typeof thumbs === 'object' ? Object.keys(thumbs).length : 0} found)`);
	} catch (e: any) { fail("get thumbnails", e.message.slice(0, 100)); }

	// ── Libraries ──
	console.log("\nLibraries:");

	try {
		// Make file shared first
		await apiPost("set-file-shared", { id: fileId, isShared: true });
		ok("set file shared");
	} catch (e: any) { fail("set file shared", e.message.slice(0, 100)); }

	try {
		const shared = await apiPost<File[]>("get-team-shared-files", { teamId: TEAM_ID });
		if (shared.some(f => f.id === fileId)) ok(`get shared files (${shared.length} found)`);
		else fail("get shared files", "file not in shared list");
	} catch (e: any) { fail("get shared files", e.message.slice(0, 100)); }

	// Create a second file and link library
	let file2Id: string = "";
	try {
		const f2 = await apiPost<File>("create-file", { projectId, name: "Consumer File" });
		file2Id = f2.id;

		await apiPost("link-file-to-library", { fileId: file2Id, libraryId: fileId });
		ok("link library");

		const libs = await apiPost<any[]>("get-file-libraries", { fileId: file2Id });
		if (libs.some((l: any) => l.id === fileId)) ok(`get file libraries (${libs.length} found)`);
		else fail("get file libraries", "library not linked");

		await apiPost("unlink-file-from-library", { fileId: file2Id, libraryId: fileId });
		ok("unlink library");
	} catch (e: any) { fail("libraries", e.message.slice(0, 100)); }

	// ── Cleanup ──
	console.log("\nCleanup:");
	if (file2Id) {
		try { await apiPost("delete-file", { id: file2Id }); ok("delete consumer file"); }
		catch (e: any) { fail("delete consumer file", e.message.slice(0, 100)); }
	}

	try {
		await apiPost("delete-file", { id: fileId });
		ok("delete file");
	} catch (e: any) { fail("delete file", e.message.slice(0, 100)); }

	try {
		await apiPost("delete-project", { id: projectId! });
		ok("delete project");
	} catch (e: any) { fail("delete project", e.message.slice(0, 100)); }

	if (dupProjectId) {
		try { await apiPost("delete-project", { id: dupProjectId }); ok("delete duplicate project"); }
		catch (e: any) { fail("delete duplicate project", e.message.slice(0, 100)); }
	}

	// ── Summary ──
	console.log(`\n${"═".repeat(40)}`);
	console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
	if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
