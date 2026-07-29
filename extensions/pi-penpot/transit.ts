/**
 * pi-penpot — Transit+JSON encoding for Penpot's update-file endpoint.
 *
 * Penpot's backend uses Clojure defrecords for Shape, Point, Rect, and Matrix.
 * The REST API's JSON decoder does NOT convert plain maps into these records.
 * The only way to create shapes via the REST API is to use Transit+JSON encoding
 * with custom tagged values that map to Penpot's Transit read handlers:
 *
 *   - "shape"  → app.common.types.shape/Shape record
 *   - "point"  → app.common.geom.point/Point record
 *   - "rect"   → app.common.geom.rect/Rect record
 *   - "matrix" → app.common.geom.matrix/Matrix record
 *
 * This module provides:
 *   1. A Transit writer that encodes these tagged types
 *   2. Helper functions to build Transit-compatible change payloads
 *   3. camelCase → kebab-case key conversion for shape properties
 */

// @ts-expect-error — transit-js has no TypeScript types
import transit from "transit-js";

// ══════════════════════════════════════════════════════════════════
// Tagged wrapper classes — these exist so the Transit writer can
// identify which tag handler to apply.
// ══════════════════════════════════════════════════════════════════

export class TransitShape {
	constructor(public data: Record<string, any>) {}
}
export class TransitPoint {
	constructor(
		public x: number,
		public y: number,
	) {}
}
export class TransitRect {
	constructor(public data: Record<string, number>) {}
}
export class TransitMatrix {
	constructor(public data: Record<string, number>) {}
}

// ══════════════════════════════════════════════════════════════════
// Transit writer with Penpot custom write handlers
// ══════════════════════════════════════════════════════════════════

const writer = transit.writer("json", {
	handlers: transit.map([
		TransitShape,
		transit.makeWriteHandler({
			tag: () => "shape",
			rep: (v: TransitShape) => v.data,
		}),
		TransitPoint,
		transit.makeWriteHandler({
			tag: () => "point",
			rep: (v: TransitPoint) => transit.map([transit.keyword("x"), v.x, transit.keyword("y"), v.y]),
		}),
		TransitRect,
		transit.makeWriteHandler({
			tag: () => "rect",
			rep: (v: TransitRect) => {
				const d = v.data;
				return transit.map([
					transit.keyword("x"),
					d.x,
					transit.keyword("y"),
					d.y,
					transit.keyword("width"),
					d.width,
					transit.keyword("height"),
					d.height,
					transit.keyword("x1"),
					d.x1,
					transit.keyword("y1"),
					d.y1,
					transit.keyword("x2"),
					d.x2,
					transit.keyword("y2"),
					d.y2,
				]);
			},
		}),
		TransitMatrix,
		transit.makeWriteHandler({
			tag: () => "matrix",
			rep: (v: TransitMatrix) => {
				const d = v.data;
				return transit.map([
					transit.keyword("a"),
					d.a,
					transit.keyword("b"),
					d.b,
					transit.keyword("c"),
					d.c,
					transit.keyword("d"),
					d.d,
					transit.keyword("e"),
					d.e,
					transit.keyword("f"),
					d.f,
				]);
			},
		}),
	]),
});

// ══════════════════════════════════════════════════════════════════
// camelCase → kebab-case conversion for shape property keys
// ══════════════════════════════════════════════════════════════════

const KEBAB_CACHE = new Map<string, string>();

function camelToKebab(s: string): string {
	const cached = KEBAB_CACHE.get(s);
	if (cached !== undefined) return cached;
	const result = s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
	KEBAB_CACHE.set(s, result);
	return result;
}

// ══════════════════════════════════════════════════════════════════
// Shape property builders — convert our JSON-style camelCase shapes
// into Transit-ready objects with proper tagged types.
// ══════════════════════════════════════════════════════════════════

/** Keys whose values should be encoded as Transit keywords. */
const KEYWORD_VALUE_KEYS = new Set([
	"type", "growType", "layout", "layoutFlexDir", "layoutWrapType",
	"layoutAlignItems", "layoutAlignContent", "layoutJustifyItems",
	"layoutJustifyContent", "constraintsH", "constraintsV",
	"blendMode", "strokeStyle", "strokeAlignment",
	"strokeCapStart", "strokeCapEnd",
]);

/** Keys whose values are UUIDs. */
const UUID_KEYS = new Set([
	"id", "parentId", "frameId", "componentId", "componentFile",
	"shapeRef", "pageId",
]);

/** Convert a camelCase shape object into a Transit-tagged Shape with
 *  proper Point/Rect/Matrix sub-types and kebab-case keyword keys. */
export function buildTransitShape(obj: Record<string, any>): TransitShape {
	const transitMap = transit.map([]);
	const shapeType = obj.type;

	// Frame shapes REQUIRE a :shapes vector (can be empty)
	if (shapeType === "frame" && !obj.shapes) {
		obj = { ...obj, shapes: [] };
	}

	// Group shapes REQUIRE a :shapes vector
	if (shapeType === "group" && !obj.shapes) {
		obj = { ...obj, shapes: [] };
	}

	for (const [key, value] of Object.entries(obj)) {
		if (value === undefined) continue;

		const kw = transit.keyword(camelToKebab(key));

		if (key === "selrect" && value && typeof value === "object") {
			transitMap.set(kw, new TransitRect(ensureFloats(value)));
		} else if (key === "points" && Array.isArray(value)) {
			transitMap.set(
				kw,
				value.map((p: any) => new TransitPoint(toFloat(p.x), toFloat(p.y))),
			);
		} else if ((key === "transform" || key === "transformInverse") && value && typeof value === "object") {
			transitMap.set(kw, new TransitMatrix(ensureFloats(value)));
		} else if (KEYWORD_VALUE_KEYS.has(key) && typeof value === "string") {
			transitMap.set(kw, transit.keyword(camelToKebab(value)));
		} else if (UUID_KEYS.has(key)) {
			transitMap.set(kw, value != null ? transit.uuid(value) : null);
		} else if (key === "shapes" && Array.isArray(value)) {
			transitMap.set(kw, value.map((id: string) => transit.uuid(id)));
		} else if (key === "fills" || key === "strokes" || key === "shadow") {
			transitMap.set(kw, convertArrayOfMaps(value));
		} else if (key === "blur" && value && typeof value === "object") {
			transitMap.set(kw, convertMap(value));
		} else if (key === "content" && value && typeof value === "object") {
			if (shapeType === "path" && Array.isArray(value)) {
				// Path content: array of segments with :command keywords
				transitMap.set(kw, convertPathContent(value));
			} else {
				// Text content: type values are STRINGS not keywords
				transitMap.set(kw, convertTextContent(value));
			}
		} else if (key === "metadata" && value && typeof value === "object") {
			// Image metadata: id is a UUID
			transitMap.set(kw, convertImageMetadata(value));
		} else if (typeof value === "number") {
			transitMap.set(kw, toFloat(value));
		} else if (typeof value === "boolean" || value === null) {
			transitMap.set(kw, value);
		} else {
			transitMap.set(kw, value);
		}
	}

	return new TransitShape(transitMap);
}

/** Build a complete Transit-encoded update-file request body. */
export function encodeUpdateFile(params: {
	id: string;
	sessionId: string;
	revn: number;
	vern: number;
	changes: any[];
	skipValidate?: boolean;
}): string {
	const data = transit.map([
		transit.keyword("id"),
		transit.uuid(params.id),
		transit.keyword("session-id"),
		transit.uuid(params.sessionId),
		transit.keyword("revn"),
		params.revn,
		transit.keyword("vern"),
		params.vern,
		transit.keyword("changes"),
		params.changes.map((change: any) => encodeChange(change)),
	]);

	if (params.skipValidate) {
		data.set(transit.keyword("skip-validate"), true);
	}

	return writer.write(data);
}

/** Encode a single change (add-obj, mod-obj, del-obj, mov-objects, etc.) */
function encodeChange(change: Record<string, any>): any {
	const m = transit.map([]);

	for (const [key, value] of Object.entries(change)) {
		if (value === undefined) continue;
		const kw = transit.keyword(camelToKebab(key));

		if (key === "type" && typeof value === "string") {
			m.set(kw, transit.keyword(camelToKebab(value)));
		} else if (
			key === "id" ||
			key === "pageId" ||
			key === "frameId" ||
			key === "parentId" ||
			key === "componentId"
		) {
			m.set(kw, value != null ? transit.uuid(value) : null);
		} else if (key === "obj" && value && typeof value === "object") {
			m.set(kw, buildTransitShape(value));
		} else if (key === "shapes" && Array.isArray(value)) {
			m.set(kw, value.map((id: string) => transit.uuid(id)));
		} else if (key === "operations" && Array.isArray(value)) {
			m.set(kw, value.map((op: any) => encodeOperation(op)));
		} else if (typeof value === "number") {
			m.set(kw, value);
		} else if (typeof value === "boolean") {
			m.set(kw, value);
		} else {
			m.set(kw, value);
		}
	}

	return m;
}

/** Encode a mod-obj operation (set, assign, set-touched). */
function encodeOperation(op: Record<string, any>): any {
	const m = transit.map([]);

	for (const [key, value] of Object.entries(op)) {
		if (value === undefined) continue;
		const kw = transit.keyword(camelToKebab(key));

		if (key === "type") {
			m.set(kw, transit.keyword(value));
		} else if (key === "attr") {
			m.set(kw, transit.keyword(camelToKebab(value)));
		} else if (key === "val") {
			m.set(kw, convertOperationValue(op.attr, value));
		} else if (key === "value" && typeof value === "object") {
			m.set(kw, convertMap(value));
		} else if (key === "touched") {
			m.set(kw, value === null ? null : value.map((t: string) => transit.keyword(t)));
		} else {
			m.set(kw, value);
		}
	}

	return m;
}

/** Convert an operation value based on the attribute being set. */
function convertOperationValue(attr: string, value: any): any {
	if (value === null || value === undefined) return value;

	// Geometry-related attributes that need record wrapping
	if (attr === "selrect" && typeof value === "object") {
		return new TransitRect(ensureFloats(value));
	}
	if (attr === "points" && Array.isArray(value)) {
		return value.map((p: any) => new TransitPoint(toFloat(p.x), toFloat(p.y)));
	}
	if ((attr === "transform" || attr === "transformInverse") && typeof value === "object") {
		return new TransitMatrix(ensureFloats(value));
	}

	// Type keyword
	if (attr === "type" && typeof value === "string") {
		return transit.keyword(value);
	}

	// UUID fields
	if (
		(attr === "parentId" || attr === "frameId" || attr === "componentId" || attr === "componentFile" || attr === "shapeRef") &&
		typeof value === "string"
	) {
		return transit.uuid(value);
	}

	// Arrays of maps (fills, strokes, shadow)
	if ((attr === "fills" || attr === "strokes" || attr === "shadow") && Array.isArray(value)) {
		return convertArrayOfMaps(value);
	}

	// Blur — object with id (uuid) and type (keyword)
	if (attr === "blur" && typeof value === "object" && !Array.isArray(value)) {
		return convertMap(value);
	}

	// Text content — uses convertTextContent (type values stay as strings)
	if (attr === "content" && typeof value === "object") {
		return convertTextContent(value);
	}

	// Grow type keyword
	if (attr === "growType" && typeof value === "string") {
		return transit.keyword(camelToKebab(value));
	}

	// Object values
	if (typeof value === "object" && !Array.isArray(value)) {
		return convertMap(value);
	}

	if (Array.isArray(value)) {
		return value.map((v: any) => (typeof v === "object" ? convertDeep(v) : v));
	}

	return value;
}

// ══════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════

/** Convert path content — command values are keywords, params contain float coordinates. */
function convertPathContent(segments: any[]): any[] {
	return segments.map((seg: any) => {
		const pairs: any[] = [];
		for (const [key, value] of Object.entries(seg as Record<string, any>)) {
			if (value === undefined) continue;
			const kw = transit.keyword(camelToKebab(key));

			if (key === "command" && typeof value === "string") {
				pairs.push(kw, transit.keyword(camelToKebab(value)));
			} else if (key === "params" && typeof value === "object" && value !== null) {
				// Params contain x/y coordinates as floats
				const paramPairs: any[] = [];
				for (const [pk, pv] of Object.entries(value as Record<string, any>)) {
					paramPairs.push(transit.keyword(camelToKebab(pk)));
					paramPairs.push(typeof pv === "number" ? toFloat(pv as number) : pv);
				}
				pairs.push(kw, transit.map(paramPairs));
			} else {
				pairs.push(kw, value);
			}
		}
		return transit.map(pairs);
	});
}

/** Convert text content — type values stay as STRINGS (not keywords).
 *  Keys are kebab-cased keywords. */
function convertTextContent(obj: any): any {
	if (obj === null || obj === undefined) return obj;
	if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") return obj;

	if (Array.isArray(obj)) {
		return obj.map(convertTextContent);
	}

	// It's a map — convert keys to keywords but keep "type" values as strings
	const pairs: any[] = [];
	for (const [key, value] of Object.entries(obj as Record<string, any>)) {
		if (value === undefined) continue;
		const kw = transit.keyword(camelToKebab(key));

		if (key === "fills" && Array.isArray(value)) {
			pairs.push(kw, convertArrayOfMaps(value));
		} else {
			pairs.push(kw, convertTextContent(value));
		}
	}
	return transit.map(pairs);
}

/** Convert image metadata — id is a UUID, dimensions are numbers. */
function convertImageMetadata(obj: Record<string, any>): any {
	const pairs: any[] = [];
	for (const [key, value] of Object.entries(obj)) {
		if (value === undefined) continue;
		const kw = transit.keyword(camelToKebab(key));

		if (key === "id" && typeof value === "string") {
			pairs.push(kw, transit.uuid(value));
		} else if (typeof value === "number") {
			pairs.push(kw, value);  // width/height are integers
		} else {
			pairs.push(kw, value);
		}
	}
	return transit.map(pairs);
}

/** Ensure all number values in an object are floats (not integers). */
function ensureFloats(obj: Record<string, any>): Record<string, any> {
	const result: Record<string, any> = {};
	for (const [k, v] of Object.entries(obj)) {
		result[k] = typeof v === "number" ? toFloat(v) : v;
	}
	return result;
}

/** Convert integer to float for Transit encoding. */
function toFloat(n: number): number {
	return Number.isInteger(n) ? n + 0.0 : n;
}

/** Keys whose values are UUIDs inside style maps (shadow, blur, stroke). */
const MAP_UUID_KEYS = new Set(["id"]);

/** Keys whose values are keywords inside style maps (shadow, blur, stroke, fills). */
const MAP_KEYWORD_KEYS = new Set([
	"style",              // shadow: drop-shadow, inner-shadow
	"type",               // blur: layer-blur, background-blur
	"strokeStyle",        // stroke: solid, dotted, dashed, mixed, none
	"strokeAlignment",    // stroke: inner, center, outer
	"fillColorRefFile",   // fill reference
	"growType",           // text: auto-height, auto-width, fixed
]);

/** Convert a camelCase map to a Transit map with keyword keys.
 *  Handles UUIDs and keywords for special keys (shadow, blur, stroke). */
function convertMap(obj: Record<string, any>): any {
	const pairs: any[] = [];
	for (const [key, value] of Object.entries(obj)) {
		if (value === undefined) continue;
		const kebabKey = camelToKebab(key);
		pairs.push(transit.keyword(kebabKey));

		if (MAP_UUID_KEYS.has(key) && typeof value === "string") {
			pairs.push(transit.uuid(value));
		} else if (MAP_KEYWORD_KEYS.has(key) && typeof value === "string") {
			pairs.push(transit.keyword(camelToKebab(value)));
		} else {
			pairs.push(convertDeep(value));
		}
	}
	return transit.map(pairs);
}

/** Convert an array of camelCase maps to Transit. */
function convertArrayOfMaps(arr: any[]): any[] {
	return arr.map((item: any) => (typeof item === "object" && item !== null ? convertMap(item) : item));
}

/** Deep-convert any value to Transit-ready form. */
function convertDeep(value: any): any {
	if (value === null || value === undefined) return value;
	if (typeof value === "string") return value;
	if (typeof value === "number") return value;
	if (typeof value === "boolean") return value;

	if (Array.isArray(value)) {
		return value.map(convertDeep);
	}

	if (typeof value === "object") {
		return convertMap(value);
	}

	return value;
}
