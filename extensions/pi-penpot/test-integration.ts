/**
 * Integration test for pi-penpot extension.
 * Tests all shape types + modify + delete + move + pages + comments against a live Penpot instance.
 *
 * Usage: npx tsx test-integration.ts
 */

import { initClient, apiPost, apiPostTransit } from "./src/client.ts";
import { encodeUpdateFile } from "./src/transit.ts";
import { randomUUID } from "node:crypto";
import type { File, PageData, CommentThread, Comment } from "./src/types.ts";

const TOKEN = process.env.PENPOT_TOKEN || "eyJhbGciOiJBMjU2S1ciLCJlbmMiOiJBMjU2R0NNIn0.SZn_qmfyLqXQ2UNZt58Ou8kwndoU5N0PTM-mVOPUh8mBToX34c9Q8w.RbcmTL4_vi8WtCJD.EMpPXlpt8pBEG9Z2Ah21ktoYLBCxo9iGkMnMaOapUFecfCuE_dUOm2mDzgFnE1mul1UorekZX44PwuqeNPBjJI_O_n_KY2QCcpdEBkG54tNy-I_t6WolN_-1kl7WUgPGDhZvadKz3bc.MTwcv8YV8Pe0V9yeS01cBg";
const ENDPOINT = process.env.PENPOT_ENDPOINT || "https://penpot.e9n.dev";
const TEAM_ID = "0d727cf9-ca60-8039-8007-b069e54aa839";
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

	// ── Cleanup ──
	console.log("\nCleanup:");
	try {
		await apiPost("delete-file", { id: fileId });
		ok("delete file");
	} catch (e: any) { fail("delete file", e.message.slice(0, 100)); }

	try {
		await apiPost("delete-project", { id: projectId! });
		ok("delete project");
	} catch (e: any) { fail("delete project", e.message.slice(0, 100)); }

	// ── Summary ──
	console.log(`\n${"═".repeat(40)}`);
	console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
	if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
