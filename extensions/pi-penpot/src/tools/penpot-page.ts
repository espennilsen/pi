/**
 * pi-penpot — Page & shape tool.
 *
 * Handles page/shape read operations (get-page, list-shapes)
 * and write operations via Penpot's change-based update-file API.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { apiPost, apiPostTransit, isClientReady } from "../client.ts";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent";
import type {
	File,
	PageData,
	ShapeData,
	Change,
	ShapeType,
} from "../types.ts";
import { encodeUpdateFile } from "../transit.ts";
import { randomUUID } from "node:crypto";

/** Penpot's root frame always has this fixed UUID */
const ROOT_FRAME_ID = "00000000-0000-0000-0000-000000000000";

/** Cached file metadata for revision tracking */
const fileCache = new Map<string, { revn: number; vern: number }>();

/** Persistent session ID for update-file calls */
const sessionId = randomUUID();

const ACTIONS = [
	// Pages
	"get-page",
	"add-page",
	"rename-page",
	"delete-page",
	// Shapes — Read
	"list-shapes",
	"get-shape",
	// Shapes — Create
	"add-rectangle",
	"add-ellipse",
	"add-text",
	"add-frame",
	"add-group",
	"add-path",
	"add-image",
	// Shapes — Modify
	"modify-shape",
	"delete-shape",
	"move-shapes",
	// Components
	"add-component",
	"list-components",
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

export function registerPenpotPageTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "penpot_page",
		label: "Penpot Page",
		description:
			"Penpot page & shape operations — read pages, create/modify/delete shapes (rectangles, ellipses, text, frames, paths, images), manage components. " +
			"Use the main `penpot` tool for project/file operations first to get fileId and pageId.",
		promptSnippet:
			"Read Penpot pages and create/modify/delete shapes, frames, text, components",
		promptGuidelines: [
			"Always get the file first (`penpot get-file`) to learn pageIds before using penpot_page.",
			"Shape creation requires fileId + pageId. Most shapes need x, y, width, height.",
			"Use `modify-shape` with the `attrs` object to change any shape property (fills, strokes, opacity, etc.).",
			"Fills and strokes use Penpot's format: `[{\"fillColor\": \"#ff0000\", \"fillOpacity\": 1}]`.",
			"Frame IDs: use the root frame UUID (same as pageId) or an existing frame's ID as parentId.",
		],
		parameters: Type.Object({
			action: StringEnum(ACTIONS, { description: "Operation to perform" }),
			fileId: Type.String({ description: "File UUID (required for all actions)" }),
			pageId: Type.Optional(Type.String({ description: "Page UUID" })),
			shapeId: Type.Optional(Type.String({ description: "Shape UUID" })),
			parentId: Type.Optional(Type.String({ description: "Parent shape UUID (frame or group to nest under)" })),
			name: Type.Optional(Type.String({ description: "Name for page/shape/component" })),
			// Shape geometry
			x: Type.Optional(Type.Number({ description: "X position" })),
			y: Type.Optional(Type.Number({ description: "Y position" })),
			width: Type.Optional(Type.Number({ description: "Width" })),
			height: Type.Optional(Type.Number({ description: "Height" })),
			rotation: Type.Optional(Type.Number({ description: "Rotation in degrees" })),
			// Shape styling
			fills: Type.Optional(Type.Array(Type.Any(), { description: "Fill array: [{fillColor: '#hex', fillOpacity: 1}]" })),
			strokes: Type.Optional(Type.Array(Type.Any(), { description: "Stroke array: [{strokeColor: '#hex', strokeWidth: 1, strokeAlignment: 'center', strokeOpacity: 1}]" })),
			opacity: Type.Optional(Type.Number({ description: "Opacity (0-1)" })),
			// Text
			text: Type.Optional(Type.String({ description: "Text content (for add-text)" })),
			// Path
			pathContent: Type.Optional(Type.Any({ description: "SVG path content object (for add-path)" })),
			// Image
			imageUrl: Type.Optional(Type.String({ description: "Image URL (for add-image, will be fetched and uploaded)" })),
			// Modify
			attrs: Type.Optional(Type.Any({ description: "Key-value attributes to set on shape (for modify-shape). JSON object." })),
			// Move
			shapeIds: Type.Optional(Type.Array(Type.String(), { description: "Array of shape UUIDs (for move-shapes, delete multiple)" })),
			index: Type.Optional(Type.Number({ description: "Target index in parent (for move-shapes)" })),
			// Components
			componentId: Type.Optional(Type.String({ description: "Component UUID" })),
			// Filtering
			shapeType: Type.Optional(Type.String({ description: "Filter shapes by type: frame, rect, circle, text, path, image, group, bool" })),
		}),

		async execute(_toolCallId, params, signal) {
			if (!isClientReady()) {
				return text('❌ Penpot not configured. Add endpoint and accessToken to settings.json under "pi-penpot".');
			}

			try {
				switch (params.action) {
					// ── Pages ──
					case "get-page":
						return await handleGetPage(params, signal);
					case "add-page":
						return await handleAddPage(params, signal);
					case "rename-page":
						return await handleRenamePage(params, signal);
					case "delete-page":
						return await handleDeletePage(params, signal);

					// ── Shapes — Read ──
					case "list-shapes":
						return await handleListShapes(params, signal);
					case "get-shape":
						return await handleGetShape(params, signal);

					// ── Shapes — Create ──
					case "add-rectangle":
						return await handleAddShape(params, "rect", signal);
					case "add-ellipse":
						return await handleAddShape(params, "circle", signal);
					case "add-text":
						return await handleAddText(params, signal);
					case "add-frame":
						return await handleAddShape(params, "frame", signal);
					case "add-group":
						return await handleAddGroup(params, signal);
					case "add-path":
						return await handleAddPath(params, signal);
					case "add-image":
						return await handleAddImage(params, signal);

					// ── Shapes — Modify ──
					case "modify-shape":
						return await handleModifyShape(params, signal);
					case "delete-shape":
						return await handleDeleteShape(params, signal);
					case "move-shapes":
						return await handleMoveShapes(params, signal);

					// ── Components ──
					case "add-component":
						return await handleAddComponent(params, signal);
					case "list-components":
						return await handleListComponents(params, signal);

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
// File revision management
// ══════════════════════════════════════════════════════════════════

async function getFileRevision(fileId: string, signal?: AbortSignal): Promise<{ revn: number; vern: number }> {
	const cached = fileCache.get(fileId);
	if (cached) return cached;

	const file = await apiPost<File>("get-file", { id: fileId }, signal);
	const rev = { revn: file.revn, vern: file.vern };
	fileCache.set(fileId, rev);
	return rev;
}

async function updateFile(
	fileId: string,
	changes: Change[],
	signal?: AbortSignal,
): Promise<any> {
	const { revn, vern } = await getFileRevision(fileId, signal);

	// Encode as Transit+JSON — required because Penpot's backend uses
	// defrecords (Shape, Point, Rect, Matrix) that need Transit tagged
	// values to deserialize properly.
	const transitBody = encodeUpdateFile({
		id: fileId,
		sessionId,
		revn,
		vern,
		changes,
	});

	let result: any;
	try {
		result = await apiPostTransit("update-file", transitBody, signal);
	} catch (err) {
		// Invalidate cache so next attempt fetches a fresh revision
		invalidateFileCache(fileId);
		throw err;
	}

	// Update cached revision — prefer top-level revn (always present),
	// fall back to lagged array for concurrent-edit catch-up
	if (result && typeof result === "object") {
		const newRevn = (result as any).revn;
		const newVern = (result as any).vern;
		if (newRevn !== undefined) {
			fileCache.set(fileId, { revn: newRevn, vern: newVern ?? vern });
		}
		// Lagged changes from concurrent sessions may carry a higher revn
		const lagged = (result as any).lagged;
		if (Array.isArray(lagged) && lagged.length > 0) {
			const last = lagged[lagged.length - 1];
			if (last.revn !== undefined && (newRevn === undefined || last.revn > newRevn)) {
				fileCache.set(fileId, { revn: last.revn, vern: last.vern ?? newVern ?? vern });
			}
		}
	}

	return result;
}

/** Invalidate cache to force refresh on next write */
function invalidateFileCache(fileId: string) {
	fileCache.delete(fileId);
}

// ══════════════════════════════════════════════════════════════════
// Pages
// ══════════════════════════════════════════════════════════════════

async function handleGetPage(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");

	const body: Record<string, any> = { fileId: params.fileId };
	if (params.pageId) body.pageId = params.pageId;
	if (params.shapeId) body.objectId = params.shapeId;

	const page = await apiPost<PageData>("get-page", body, signal);

	const objects = page.objects ?? {};
	const objectCount = Object.keys(objects).length;

	const lines = [
		`**Page:** ${page.name}`,
		`- **ID:** \`${page.id}\``,
		`- **Objects:** ${objectCount}`,
	];

	// Show shape tree (summarized)
	if (objectCount > 0 && objectCount <= 500) {
		lines.push("", "**Shape Tree:**");
		const root = objects[ROOT_FRAME_ID];
		if (root && root.shapes) {
			buildShapeTree(objects, root.shapes, lines, 0);
		}
	} else if (objectCount > 500) {
		lines.push("", `_${objectCount} objects — use list-shapes with shapeType filter to narrow down_`);
	}

	return text(truncateOutput(lines.join("\n")));
}

function buildShapeTree(
	objects: Record<string, ShapeData>,
	shapeIds: string[],
	lines: string[],
	depth: number,
) {
	const indent = "  ".repeat(depth);
	for (const id of shapeIds) {
		const obj = objects[id];
		if (!obj) continue;
		const childCount = obj.shapes?.length ?? 0;
		const dims = obj.width && obj.height ? ` (${Math.round(obj.width)}×${Math.round(obj.height)})` : "";
		lines.push(`${indent}- \`${id}\` **${obj.name}** [${obj.type}]${dims}`);

		if (obj.shapes && depth < 4) {
			buildShapeTree(objects, obj.shapes, lines, depth + 1);
		} else if (obj.shapes && depth >= 4) {
			lines.push(`${indent}  _… ${childCount} children_`);
		}
	}
}

async function handleAddPage(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.name) return text("❌ 'name' is required");

	const pageId = randomUUID();
	await updateFile(params.fileId, [
		{ type: "add-page", id: pageId, name: params.name },
	], signal);

	return text(`✅ Page created: **${params.name}** (\`${pageId}\`)`);
}

async function handleRenamePage(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.pageId) return text("❌ 'pageId' is required");
	if (!params.name) return text("❌ 'name' is required");

	await updateFile(params.fileId, [
		{ type: "mod-page", id: params.pageId, name: params.name },
	], signal);

	return text(`✅ Page renamed to **${params.name}**`);
}

async function handleDeletePage(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.pageId) return text("❌ 'pageId' is required");

	await updateFile(params.fileId, [
		{ type: "del-page", id: params.pageId },
	], signal);

	return text(`✅ Page deleted`);
}

// ══════════════════════════════════════════════════════════════════
// Shapes — Read
// ══════════════════════════════════════════════════════════════════

async function handleListShapes(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.pageId) return text("❌ 'pageId' is required");

	const page = await apiPost<PageData>("get-page", {
		fileId: params.fileId,
		pageId: params.pageId,
	}, signal);

	const objects = page.objects ?? {};
	let shapes = Object.values(objects);

	// Filter by type if specified
	if (params.shapeType) {
		shapes = shapes.filter(s => s.type === params.shapeType);
	}

	// Exclude root frame
	shapes = shapes.filter(s => s.id !== page.id);

	if (shapes.length === 0) {
		return text(params.shapeType
			? `No shapes of type '${params.shapeType}' found on this page.`
			: "No shapes found on this page.");
	}

	const lines = [
		`**Shapes** — ${shapes.length} found`,
		"",
		"| Name | Type | ID | Position | Size |",
		"|------|------|----|----------|------|",
		...shapes.slice(0, 100).map(s =>
			`| ${s.name} | ${s.type} | \`${s.id}\` | ${s.x !== undefined ? `${Math.round(s.x)},${Math.round(s.y ?? 0)}` : "—"} | ${s.width ? `${Math.round(s.width)}×${Math.round(s.height ?? 0)}` : "—"} |`
		),
	];

	if (shapes.length > 100) lines.push(`\n_… and ${shapes.length - 100} more shapes_`);
	return text(truncateOutput(lines.join("\n")));
}

async function handleGetShape(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.shapeId) return text("❌ 'shapeId' is required");

	const page = await apiPost<PageData>("get-page", {
		fileId: params.fileId,
		pageId: params.pageId,
		objectId: params.shapeId,
	}, signal);

	const shape = page.objects?.[params.shapeId];
	if (!shape) return text(`❌ Shape \`${params.shapeId}\` not found`);

	return text(truncateOutput(
		`**Shape:** ${shape.name} [${shape.type}]\n\n\`\`\`json\n${JSON.stringify(shape, null, 2)}\n\`\`\``
	));
}

// ══════════════════════════════════════════════════════════════════
// Shapes — Create
// ══════════════════════════════════════════════════════════════════

async function handleAddShape(params: any, shapeType: ShapeType, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.pageId) return text("❌ 'pageId' is required");

	const shapeId = randomUUID();
	const frameId = params.parentId ?? ROOT_FRAME_ID;
	const x = params.x ?? 0;
	const y = params.y ?? 0;
	const width = params.width ?? 100;
	const height = params.height ?? 100;

	const obj: Record<string, any> = {
		id: shapeId,
		type: shapeType,
		name: params.name ?? `${shapeType}-${shapeId.slice(0, 6)}`,
		x,
		y,
		width,
		height,
		parentId: frameId,
		frameId: shapeType === "frame" ? shapeId : frameId,
		selrect: { x, y, width, height, x1: x, y1: y, x2: x + width, y2: y + height },
		points: [
			{ x, y },
			{ x: x + width, y },
			{ x: x + width, y: y + height },
			{ x, y: y + height },
		],
		transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		transformInverse: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		rotation: params.rotation ?? 0,
		opacity: params.opacity ?? 1,
	};

	// Frame shapes require a :shapes vector (can be empty)
	if (shapeType === "frame") {
		obj.shapes = [];
	}

	if (params.fills) obj.fills = params.fills;
	if (params.strokes) obj.strokes = params.strokes;

	// Default fill for rect and circle if not specified
	if (!params.fills && (shapeType === "rect" || shapeType === "circle")) {
		obj.fills = [{ fillColor: "#B1B2B5", fillOpacity: 1 }];
	}
	// Default white fill for frame
	if (!params.fills && shapeType === "frame") {
		obj.fills = [{ fillColor: "#FFFFFF", fillOpacity: 1 }];
	}

	const change: Change = {
		type: "add-obj",
		id: shapeId,
		obj,
		pageId: params.pageId,
		frameId,
		parentId: frameId,
	};

	await updateFile(params.fileId, [change], signal);

	return text(`✅ ${shapeType} created: **${obj.name}** (\`${shapeId}\`) at (${x}, ${y}) ${width}×${height}`);
}

async function handleAddText(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.pageId) return text("❌ 'pageId' is required");

	const shapeId = randomUUID();
	const frameId = params.parentId ?? ROOT_FRAME_ID;
	const x = params.x ?? 0;
	const y = params.y ?? 0;
	const width = params.width ?? 200;
	const height = params.height ?? 50;
	const textContent = params.text ?? "Text";

	const obj: Record<string, any> = {
		id: shapeId,
		type: "text",
		name: params.name ?? `text-${shapeId.slice(0, 6)}`,
		x,
		y,
		width,
		height,
		parentId: frameId,
		frameId,
		selrect: { x, y, width, height, x1: x, y1: y, x2: x + width, y2: y + height },
		points: [
			{ x, y },
			{ x: x + width, y },
			{ x: x + width, y: y + height },
			{ x, y: y + height },
		],
		transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		transformInverse: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		rotation: params.rotation ?? 0,
		opacity: params.opacity ?? 1,
		content: {
			type: "root",
			children: [
				{
					type: "paragraph-set",
					children: [
						{
							type: "paragraph",
							children: [
								{
									text: textContent,
									fontFamily: "sourcesanspro",
									fontSize: "14",
									fontWeight: "400",
									fontStyle: "normal",
									fillColor: "#000000",
									fillOpacity: 1,
								},
							],
						},
					],
				},
			],
		},
		growType: "auto-height",
	};

	if (params.fills) obj.fills = params.fills;
	if (params.strokes) obj.strokes = params.strokes;

	const change: Change = {
		type: "add-obj",
		id: shapeId,
		obj,
		pageId: params.pageId,
		frameId,
		parentId: frameId,
	};

	await updateFile(params.fileId, [change], signal);

	return text(`✅ Text created: **${obj.name}** (\`${shapeId}\`) — "${textContent}"`);
}

async function handleAddGroup(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.pageId) return text("❌ 'pageId' is required");
	if (!params.shapeIds || params.shapeIds.length === 0) return text("❌ 'shapeIds' is required (shapes to group)");

	const groupId = randomUUID();
	const frameId = params.parentId ?? ROOT_FRAME_ID;

	// Compute bounding box from child shapes
	const page = await apiPost<PageData>("get-page", {
		fileId: params.fileId,
		pageId: params.pageId,
	}, signal);
	const objects = page.objects ?? {};

	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const sid of params.shapeIds) {
		const s = objects[sid];
		if (!s) continue;
		const sx = s.x ?? 0, sy = s.y ?? 0;
		const sw = s.width ?? 0, sh = s.height ?? 0;
		if (sx < minX) minX = sx;
		if (sy < minY) minY = sy;
		if (sx + sw > maxX) maxX = sx + sw;
		if (sy + sh > maxY) maxY = sy + sh;
	}
	if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0.01; maxY = 0.01; }
	const gw = maxX - minX;
	const gh = maxY - minY;

	const obj: Record<string, any> = {
		id: groupId,
		type: "group",
		name: params.name ?? `group-${groupId.slice(0, 6)}`,
		x: minX,
		y: minY,
		width: gw,
		height: gh,
		parentId: frameId,
		frameId,
		shapes: params.shapeIds,
		selrect: { x: minX, y: minY, width: gw, height: gh, x1: minX, y1: minY, x2: maxX, y2: maxY },
		points: [
			{ x: minX, y: minY },
			{ x: maxX, y: minY },
			{ x: maxX, y: maxY },
			{ x: minX, y: maxY },
		],
		transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		transformInverse: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		rotation: 0,
		opacity: 1,
	};

	// Add the group and move shapes into it
	const changes: Change[] = [
		{
			type: "add-obj",
			id: groupId,
			obj,
			pageId: params.pageId,
			frameId,
			parentId: frameId,
		},
		{
			type: "mov-objects",
			pageId: params.pageId,
			parentId: groupId,
			shapes: params.shapeIds,
		},
	];

	await updateFile(params.fileId, changes, signal);

	return text(`✅ Group created: **${obj.name}** (\`${groupId}\`) with ${params.shapeIds.length} shapes`);
}

async function handleAddPath(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.pageId) return text("❌ 'pageId' is required");
	if (!params.pathContent) return text("❌ 'pathContent' is required (SVG path content object)");

	const shapeId = randomUUID();
	const frameId = params.parentId ?? ROOT_FRAME_ID;
	const x = params.x ?? 0;
	const y = params.y ?? 0;
	const width = params.width ?? 100;
	const height = params.height ?? 100;

	const obj: Record<string, any> = {
		id: shapeId,
		type: "path",
		name: params.name ?? `path-${shapeId.slice(0, 6)}`,
		x,
		y,
		width,
		height,
		parentId: frameId,
		frameId,
		content: params.pathContent,
		selrect: { x, y, width, height, x1: x, y1: y, x2: x + width, y2: y + height },
		transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		transformInverse: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		rotation: params.rotation ?? 0,
		opacity: params.opacity ?? 1,
	};

	if (params.fills) obj.fills = params.fills;
	else obj.fills = [{ fillColor: "#000000", fillOpacity: 1 }];
	if (params.strokes) obj.strokes = params.strokes;

	const change: Change = {
		type: "add-obj",
		id: shapeId,
		obj,
		pageId: params.pageId,
		frameId,
		parentId: frameId,
	};

	await updateFile(params.fileId, [change], signal);

	return text(`✅ Path created: **${obj.name}** (\`${shapeId}\`)`);
}

async function handleAddImage(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.pageId) return text("❌ 'pageId' is required");
	if (!params.imageUrl) return text("❌ 'imageUrl' is required");

	// First, create the media object from URL
	const media = await apiPost<any>("create-file-media-object-from-url", {
		fileId: params.fileId,
		url: params.imageUrl,
		name: params.name ?? "image",
		isLocal: true,
	}, signal);

	// Then create the image shape
	const shapeId = randomUUID();
	const frameId = params.parentId ?? ROOT_FRAME_ID;
	const x = params.x ?? 0;
	const y = params.y ?? 0;
	const width = params.width ?? media.width ?? 200;
	const height = params.height ?? media.height ?? 200;

	const obj: Record<string, any> = {
		id: shapeId,
		type: "image",
		name: params.name ?? `image-${shapeId.slice(0, 6)}`,
		x,
		y,
		width,
		height,
		parentId: frameId,
		frameId,
		metadata: {
			id: media.id,
			width: media.width,
			height: media.height,
			mtype: media.mtype,
		},
		selrect: { x, y, width, height, x1: x, y1: y, x2: x + width, y2: y + height },
		points: [
			{ x, y },
			{ x: x + width, y },
			{ x: x + width, y: y + height },
			{ x, y: y + height },
		],
		transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		transformInverse: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		rotation: params.rotation ?? 0,
		opacity: params.opacity ?? 1,
	};

	const change: Change = {
		type: "add-obj",
		id: shapeId,
		obj,
		pageId: params.pageId,
		frameId,
		parentId: frameId,
	};

	await updateFile(params.fileId, [change], signal);

	return text(`✅ Image created: **${obj.name}** (\`${shapeId}\`) from ${params.imageUrl}`);
}

// ══════════════════════════════════════════════════════════════════
// Shapes — Modify
// ══════════════════════════════════════════════════════════════════

async function handleModifyShape(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.pageId) return text("❌ 'pageId' is required");
	if (!params.shapeId) return text("❌ 'shapeId' is required");

	// Build operations from explicit params and attrs
	const operations: Array<{ type: "set"; attr: string; val: any }> = [];

	// Geometry
	if (params.x !== undefined) operations.push({ type: "set", attr: "x", val: params.x });
	if (params.y !== undefined) operations.push({ type: "set", attr: "y", val: params.y });
	if (params.width !== undefined) operations.push({ type: "set", attr: "width", val: params.width });
	if (params.height !== undefined) operations.push({ type: "set", attr: "height", val: params.height });
	if (params.rotation !== undefined) operations.push({ type: "set", attr: "rotation", val: params.rotation });

	// Styling
	if (params.fills) operations.push({ type: "set", attr: "fills", val: params.fills });
	if (params.strokes) operations.push({ type: "set", attr: "strokes", val: params.strokes });
	if (params.opacity !== undefined) operations.push({ type: "set", attr: "opacity", val: params.opacity });

	// Name
	if (params.name) operations.push({ type: "set", attr: "name", val: params.name });

	// Generic attrs (any key-value pairs)
	if (params.attrs && typeof params.attrs === "object") {
		for (const [attr, val] of Object.entries(params.attrs)) {
			operations.push({ type: "set", attr, val });
		}
	}

	if (operations.length === 0) return text("❌ No modifications specified. Use x, y, width, height, fills, strokes, opacity, name, or attrs.");

	// Recalculate selrect if geometry changed
	const hasGeomChange = operations.some(op =>
		["x", "y", "width", "height"].includes(op.attr)
	);

	if (hasGeomChange) {
		// We need current shape data to compute selrect
		const page = await apiPost<PageData>("get-page", {
			fileId: params.fileId,
			pageId: params.pageId,
			objectId: params.shapeId,
		}, signal);

		const shape = page.objects?.[params.shapeId];
		if (shape) {
			const x = params.x ?? shape.x ?? 0;
			const y = params.y ?? shape.y ?? 0;
			const w = params.width ?? shape.width ?? 100;
			const h = params.height ?? shape.height ?? 100;

			operations.push({
				type: "set",
				attr: "selrect",
				val: { x, y, width: w, height: h, x1: x, y1: y, x2: x + w, y2: y + h },
			});
			operations.push({
				type: "set",
				attr: "points",
				val: [
					{ x, y },
					{ x: x + w, y },
					{ x: x + w, y: y + h },
					{ x, y: y + h },
				],
			});
		}
	}

	const change: Change = {
		type: "mod-obj",
		id: params.shapeId,
		pageId: params.pageId,
		operations,
	};

	await updateFile(params.fileId, [change], signal);

	const modifiedAttrs = operations.map(op => op.attr).filter(a => a !== "selrect" && a !== "points");
	return text(`✅ Shape \`${params.shapeId}\` modified: ${modifiedAttrs.join(", ")}`);
}

async function handleDeleteShape(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.pageId) return text("❌ 'pageId' is required");

	const ids = params.shapeIds ?? (params.shapeId ? [params.shapeId] : null);
	if (!ids || ids.length === 0) return text("❌ 'shapeId' or 'shapeIds' is required");

	const changes: Change[] = ids.map((id: string) => ({
		type: "del-obj" as const,
		id,
		pageId: params.pageId,
	}));

	await updateFile(params.fileId, changes, signal);

	return text(`✅ Deleted ${ids.length} shape(s)`);
}

async function handleMoveShapes(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.pageId) return text("❌ 'pageId' is required");
	if (!params.shapeIds || params.shapeIds.length === 0) return text("❌ 'shapeIds' is required");
	if (!params.parentId) return text("❌ 'parentId' (target parent) is required");

	const change: Change = {
		type: "mov-objects",
		pageId: params.pageId,
		parentId: params.parentId,
		shapes: params.shapeIds,
		index: params.index,
	};

	await updateFile(params.fileId, [change], signal);

	return text(`✅ Moved ${params.shapeIds.length} shape(s) to parent \`${params.parentId}\``);
}

// ══════════════════════════════════════════════════════════════════
// Components
// ══════════════════════════════════════════════════════════════════

async function handleAddComponent(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");
	if (!params.shapeId) return text("❌ 'shapeId' is required (shape to turn into component)");
	if (!params.name) return text("❌ 'name' is required");

	const componentId = randomUUID();

	const change: Change = {
		type: "add-component",
		id: componentId,
		name: params.name,
		mainInstanceId: params.shapeId,
		mainInstancePage: params.pageId,
	};

	await updateFile(params.fileId, [change], signal);

	return text(`✅ Component created: **${params.name}** (\`${componentId}\`) from shape \`${params.shapeId}\``);
}

async function handleListComponents(params: any, signal?: AbortSignal) {
	if (!params.fileId) return text("❌ 'fileId' is required");

	// Get file data which includes components
	const file = await apiPost<File>("get-file", { id: params.fileId }, signal);

	const data = file.data as any;
	const components = data?.components ?? {};
	const entries = Object.entries(components);

	if (entries.length === 0) return text("No components found in this file.");

	const lines = [
		`**Components** — ${entries.length} found`,
		"",
		"| Name | ID | Path |",
		"|------|----|------|",
		...entries.map(([id, comp]: [string, any]) =>
			`| ${comp.name ?? "—"} | \`${id}\` | ${comp.path ?? "—"} |`
		),
	];

	return text(truncateOutput(lines.join("\n")));
}
