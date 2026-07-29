/**
 * pi-penpot — TypeScript types for the Penpot REST API.
 *
 * Derived from:
 *   - OpenAPI spec at /api/openapi.json
 *   - Actual JSON responses from the /api/rpc/command/* endpoints
 *   - Penpot source code (app.common.files.changes, app.common.types.*)
 *
 * These are the shapes the REST API actually returns — NOT the browser
 * plugin-types (which define a runtime object model with methods).
 */

// ══════════════════════════════════════════════════════════════════
// Primitives
// ══════════════════════════════════════════════════════════════════

/** UUID formatted string */
export type Uuid = string;

/** ISO-8601 instant string (e.g. "2026-03-09T21:53:24.269156Z") */
export type Instant = string;

/** RGB color string (e.g. "#FF5733") */
export type RgbColor = string;

/** 2D point */
export interface Point {
	x: number;
	y: number;
}

/** Bounding rectangle (selrect in Penpot internals) */
export interface Selrect {
	x: number;
	y: number;
	width: number;
	height: number;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

/** 2D affine transform matrix */
export interface Matrix {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

// ══════════════════════════════════════════════════════════════════
// Permissions (appRpcPermissions$permissions)
// ══════════════════════════════════════════════════════════════════

export interface Permissions {
	type: string;
	isOwner: boolean;
	isAdmin: boolean;
	canEdit: boolean;
	canRead?: boolean;
	isLogged?: boolean;
}

// ══════════════════════════════════════════════════════════════════
// Profile
// ══════════════════════════════════════════════════════════════════

export interface Profile {
	id: Uuid;
	fullname: string;
	email?: string;
	isActive?: boolean;
	isBlocked?: boolean;
	isDemo?: boolean;
	isMuted?: boolean;
	createdAt?: Instant;
	modifiedAt?: Instant;
	defaultProjectId?: Uuid;
	defaultTeamId?: Uuid;
	props?: Record<string, any>;
}

// ══════════════════════════════════════════════════════════════════
// Teams
// ══════════════════════════════════════════════════════════════════

export interface Team {
	id: Uuid;
	name: string;
	isDefault: boolean;
	createdAt: Instant;
	modifiedAt: Instant;
	features: string[];
	permissions: Permissions;
}

export interface TeamMember {
	id: Uuid;
	email?: string;
	name?: string;
	fullname?: string;
	isOwner?: boolean;
	isAdmin?: boolean;
	canEdit?: boolean;
}

// ══════════════════════════════════════════════════════════════════
// Projects
// ══════════════════════════════════════════════════════════════════

export interface Project {
	id: Uuid;
	teamId: Uuid;
	name: string;
	isDefault: boolean;
	isPinned: boolean;
	createdAt: Instant;
	modifiedAt: Instant;
	count?: number;
}

// ══════════════════════════════════════════════════════════════════
// Files (from OpenAPI: File, PermissionsMixin, SimplifiedFile)
// ══════════════════════════════════════════════════════════════════

export interface File {
	id: Uuid;
	name: string;
	projectId: Uuid;
	teamId?: Uuid;
	isShared: boolean;
	hasMediaTrimmed: boolean;
	commentThreadSeqn: number;
	revn: number;
	vern: number;
	createdAt: Instant;
	modifiedAt: Instant;
	features: string[];
	data?: FileData;
	permissions?: Permissions;
	migrations?: number;
	version?: number;
}

export interface FileData {
	/** Ordered list of page UUIDs */
	pages: Uuid[];
	/** Map of pageId → full page data (with objects) */
	pagesIndex: Record<Uuid, PageData>;
	id?: Uuid;
	options?: Record<string, any>;
	components?: Record<Uuid, ComponentData>;
	typographies?: Record<Uuid, Typography>;
	colors?: Record<Uuid, ColorData>;
	media?: Record<Uuid, MediaObject>;
}

export interface SimplifiedFile {
	id: Uuid;
	name: string;
	createdAt: Instant;
	modifiedAt: Instant;
}

// ══════════════════════════════════════════════════════════════════
// Pages
// ══════════════════════════════════════════════════════════════════

export interface PageData {
	id: Uuid;
	name: string;
	objects: Record<Uuid, ShapeData>;
	options?: Record<string, any>;
}

// ══════════════════════════════════════════════════════════════════
// Shapes — the core shape data returned by get-page / get-file
//
// Every shape has a common set of fields; specific types add extras.
// The REST API returns them as plain JSON with these camelCase keys.
// ══════════════════════════════════════════════════════════════════

export type ShapeType =
	| "frame"
	| "rect"
	| "circle"
	| "path"
	| "text"
	| "image"
	| "svg-raw"
	| "bool"
	| "group";

export interface ShapeData {
	id: Uuid;
	name: string;
	type: ShapeType;

	// Geometry
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	rotation?: number;
	selrect?: Selrect;
	points?: Point[];
	transform?: Matrix;
	transformInverse?: Matrix;

	// Hierarchy
	parentId?: Uuid;
	frameId?: Uuid;
	shapes?: Uuid[];          // child shape IDs (for frames, groups, bools)

	// Visual
	opacity?: number;
	hidden?: boolean;
	blocked?: boolean;
	flipX?: boolean | null;
	flipY?: boolean | null;
	proportionLock?: boolean;
	proportion?: number;
	hideFillOnExport?: boolean;

	// Styling
	fills?: Fill[];
	strokes?: Stroke[];
	shadow?: Shadow[];
	blur?: Blur;

	// Border radius (for rect/frame)
	r1?: number;
	r2?: number;
	r3?: number;
	r4?: number;

	// Text-specific
	content?: TextContent;
	growType?: "fixed" | "auto-width" | "auto-height";

	// Image-specific
	metadata?: ImageMetadata;

	// Path-specific (content is also used for paths, but as path segments)

	// Layout (frame-specific)
	layout?: "flex" | "grid";
	layoutFlexDir?: "row" | "row-reverse" | "column" | "column-reverse";
	layoutWrapType?: "wrap" | "nowrap";
	layoutAlignItems?: "start" | "end" | "center" | "stretch";
	layoutAlignContent?: "start" | "end" | "center" | "space-between" | "space-around" | "space-evenly" | "stretch";
	layoutJustifyItems?: "start" | "end" | "center" | "stretch";
	layoutJustifyContent?: "start" | "center" | "end" | "space-between" | "space-around" | "space-evenly" | "stretch";
	layoutGap?: { rowGap: number; columnGap: number };
	layoutPadding?: { p1: number; p2: number; p3: number; p4: number };

	// Component instance
	componentId?: Uuid;
	componentFile?: Uuid;
	componentRoot?: boolean;
	shapeRef?: Uuid;

	// Exports
	exports?: ExportConfig[];

	// Interactions
	interactions?: Interaction[];

	// Constraints
	constraintsH?: "left" | "right" | "leftright" | "center" | "scale";
	constraintsV?: "top" | "bottom" | "topbottom" | "center" | "scale";

	// Blend mode
	blendMode?: string;

	// Plugin data
	pluginData?: Record<string, Record<string, string>>;

	// Catch-all for additional properties
	[key: string]: any;
}

// ── Fill ────────────────────────────────────────────────────────

export interface Fill {
	fillColor?: RgbColor;
	fillOpacity?: number;
	fillColorGradient?: Gradient;
	fillColorRefFile?: Uuid;
	fillColorRefId?: Uuid;
	fillImage?: ImageMetadata;
}

// ── Stroke ──────────────────────────────────────────────────────

export interface Stroke {
	strokeColor?: RgbColor;
	strokeOpacity?: number;
	strokeWidth?: number;
	strokeStyle?: "solid" | "dotted" | "dashed" | "mixed" | "none" | "svg";
	strokeAlignment?: "center" | "inner" | "outer";
	strokeCapStart?: StrokeCap;
	strokeCapEnd?: StrokeCap;
	strokeColorGradient?: Gradient;
	strokeColorRefFile?: Uuid;
	strokeColorRefId?: Uuid;
}

export type StrokeCap =
	| "round"
	| "square"
	| "line-arrow"
	| "triangle-arrow"
	| "square-marker"
	| "circle-marker"
	| "diamond-marker";

// ── Shadow ──────────────────────────────────────────────────────

export interface Shadow {
	id?: Uuid;
	style?: "drop-shadow" | "inner-shadow";
	offsetX?: number;
	offsetY?: number;
	blur?: number;
	spread?: number;
	hidden?: boolean;
	color?: ColorValue;
}

// ── Blur ────────────────────────────────────────────────────────

export interface Blur {
	id?: Uuid;
	type?: "layer-blur";
	value?: number;
	hidden?: boolean;
}

// ── Gradient ────────────────────────────────────────────────────

export interface Gradient {
	type: "linear" | "radial";
	startX: number;
	startY: number;
	endX: number;
	endY: number;
	width: number;
	stops: GradientStop[];
}

export interface GradientStop {
	color: RgbColor;
	opacity?: number | null;
	offset: number;
}

// ── Color (library color / file color) ──────────────────────────

export interface ColorData {
	id?: Uuid;
	name?: string;
	path?: string | null;
	value?: string | null;
	color?: RgbColor | null;
	opacity?: number | null;
	modifiedAt?: Instant;
	refId?: Uuid;
	refFile?: Uuid;
	gradient?: Gradient | null;
	image?: ImageMetadata | null;
}

/** Color reference used in shadow.color etc. */
export interface ColorValue {
	color?: RgbColor;
	opacity?: number;
	id?: Uuid;
	fileId?: Uuid;
	gradient?: Gradient;
}

// ── Image metadata ──────────────────────────────────────────────

export interface ImageMetadata {
	id: Uuid;
	width: number;
	height: number;
	mtype?: string;
	name?: string;
	keepAspectRatio?: boolean;
}

// ── Export config ───────────────────────────────────────────────

export interface ExportConfig {
	type: "png" | "jpeg" | "svg" | "pdf";
	scale?: number;
	suffix?: string;
}

// ── Interaction ─────────────────────────────────────────────────

export interface Interaction {
	eventType?: string;
	actionType?: string;
	destination?: Uuid;
	preserveScroll?: boolean;
	animation?: AnimationData;
	url?: string;
	overlay?: Uuid;
}

export interface AnimationData {
	type: "dissolve" | "slide" | "push";
	duration?: number;
	easing?: "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";
	direction?: "right" | "left" | "up" | "down";
	way?: "in" | "out";
	offsetEffect?: boolean;
}

// ── Text content (Penpot's rich text model) ─────────────────────

export interface TextContent {
	type: "root";
	children: TextParagraphSet[];
}

export interface TextParagraphSet {
	type: "paragraph-set";
	children: TextParagraph[];
}

export interface TextParagraph {
	type: "paragraph";
	children: TextRun[];
	fills?: Fill[];
	fontId?: string;
	fontFamily?: string;
	fontSize?: string;
	fontWeight?: string;
	fontStyle?: string;
	lineHeight?: string;
	letterSpacing?: string;
	textAlign?: string;
	textDecoration?: string;
	textTransform?: string;
	direction?: string;
}

export interface TextRun {
	text: string;
	fills?: Fill[];
	fontId?: string;
	fontFamily?: string;
	fontVariantId?: string;
	fontSize?: string;
	fontWeight?: string;
	fontStyle?: string;
	lineHeight?: string;
	letterSpacing?: string;
	textAlign?: string;
	textDecoration?: string;
	textTransform?: string;
	fillColor?: RgbColor;
	fillOpacity?: number;
}

// ══════════════════════════════════════════════════════════════════
// Typography (appCommonTypesTypography$typography)
// ══════════════════════════════════════════════════════════════════

export interface Typography {
	id: Uuid;
	name: string;
	fontId: string;
	fontFamily: string;
	fontVariantId: string;
	fontSize: string;
	fontWeight: string;
	fontStyle: string;
	lineHeight: string;
	letterSpacing: string;
	textTransform: string;
	modifiedAt?: Instant;
	path?: string | null;
}

// ══════════════════════════════════════════════════════════════════
// Components
// ══════════════════════════════════════════════════════════════════

export interface ComponentData {
	id: Uuid;
	name: string;
	path?: string;
	mainInstanceId?: Uuid;
	mainInstancePage?: Uuid;
	modifiedAt?: Instant;
}

// ══════════════════════════════════════════════════════════════════
// Media objects (appCommonTypesFile$media-object)
// ══════════════════════════════════════════════════════════════════

export interface MediaObject {
	id: Uuid;
	name: string;
	width: number;
	height: number;
	mtype: string;
	createdAt?: Instant;
	deletedAt?: Instant;
	fileId?: Uuid;
	mediaId?: Uuid;
	thumbnailId?: Uuid;
	isLocal?: boolean;
}

// ══════════════════════════════════════════════════════════════════
// Font variants
// ══════════════════════════════════════════════════════════════════

export interface FontVariant {
	id: Uuid;
	teamId: Uuid;
	fontId: string;
	fontFamily: string;
	fontWeight: number;
	fontStyle: string;
}

// ══════════════════════════════════════════════════════════════════
// Comments
// ══════════════════════════════════════════════════════════════════

export interface CommentThread {
	id: Uuid;
	fileId: Uuid;
	pageId: Uuid;
	position: Point;
	seqn: number;
	content: string;
	createdAt: Instant;
	modifiedAt: Instant;
	ownerId?: Uuid;
	countComments?: number;
	frameId?: Uuid;
}

export interface Comment {
	id: Uuid;
	threadId: Uuid;
	content: string;
	createdAt: Instant;
	modifiedAt: Instant;
	ownerId?: Uuid;
}

// ══════════════════════════════════════════════════════════════════
// Webhooks
// ══════════════════════════════════════════════════════════════════

export interface Webhook {
	id: Uuid;
	teamId: Uuid;
	uri: string;
	mtype: string;
	isActive: boolean;
	errorCode?: string;
	errorCount?: number;
}

// ══════════════════════════════════════════════════════════════════
// Share Links
// ══════════════════════════════════════════════════════════════════

export interface ShareLink {
	id: Uuid;
	fileId: Uuid;
	flags: string[];
	pages: Uuid[];
	whoComment?: string;
	whoInspect?: string;
}

// ══════════════════════════════════════════════════════════════════
// Snapshots
// ══════════════════════════════════════════════════════════════════

export interface Snapshot {
	id: Uuid;
	fileId: Uuid;
	label?: string;
	revn: number;
	createdAt: Instant;
	profileId?: Uuid;
}

// ══════════════════════════════════════════════════════════════════
// Flow (appCommonTypesPage$flow)
// ══════════════════════════════════════════════════════════════════

export interface Flow {
	id: Uuid;
	name: string;
	startingFrame: Uuid;
}

// ══════════════════════════════════════════════════════════════════
// Guide (appCommonTypesPage$guide)
// ══════════════════════════════════════════════════════════════════

export interface Guide {
	id: Uuid;
	axis: "x" | "y";
	position: number;
	frameId?: Uuid | null;
}

// ══════════════════════════════════════════════════════════════════
// Design Tokens (appCommonTypesToken$token)
// ══════════════════════════════════════════════════════════════════

export interface Token {
	name: string;
	type: string;
	value: any;
	description?: string | null;
	modifiedAt?: Instant;
}

export interface TokenSet {
	name: string;
	description?: string | null;
	modifiedAt?: Instant;
	tokens?: Record<string, Token>;
}

export interface TokenTheme {
	name: string;
	group: string;
	description: string | null;
	isSource: boolean;
	id: string;
	modifiedAt?: Instant;
	sets?: Record<string, any>;
}

// ══════════════════════════════════════════════════════════════════
// Library refs (response from get-file-libraries)
// ══════════════════════════════════════════════════════════════════

export interface LibraryRef {
	id: Uuid;
	name: string;
	isShared: boolean;
	synced?: boolean;
}

// ══════════════════════════════════════════════════════════════════
// Changes (for update-file command)
// Derived from OpenAPI appCommonFilesChanges$change
// ══════════════════════════════════════════════════════════════════

export type Change =
	| AddObjChange
	| ModObjChange
	| DelObjChange
	| MovObjChange
	| AddPageChange
	| ModPageChange
	| DelPageChange
	| AddComponentChange
	| DelComponentChange;

export interface AddObjChange {
	type: "add-obj";
	id: Uuid;
	obj: Record<string, any>;
	pageId?: Uuid;
	componentId?: Uuid;
	frameId: Uuid;
	parentId?: Uuid | null;
	index?: number | null;
	ignoreTouched?: boolean;
}

export interface ModObjChange {
	type: "mod-obj";
	id: Uuid;
	pageId?: Uuid;
	componentId?: Uuid;
	operations: Operation[];
}

export interface DelObjChange {
	type: "del-obj";
	id: Uuid;
	pageId?: Uuid;
	componentId?: Uuid;
	ignoreDefault?: boolean;
}

export interface MovObjChange {
	type: "mov-objects";
	pageId?: Uuid;
	parentId: Uuid;
	shapes: Uuid[];
	index?: number;
	ignoreTouched?: boolean;
}

export interface AddPageChange {
	type: "add-page";
	id: Uuid;
	name: string;
	page?: any;
}

export interface ModPageChange {
	type: "mod-page";
	id: Uuid;
	name: string;
}

export interface DelPageChange {
	type: "del-page";
	id: Uuid;
}

export interface AddComponentChange {
	type: "add-component";
	id: Uuid;
	name: string;
	mainInstanceId?: Uuid;
	mainInstancePage?: Uuid;
	path?: string;
}

export interface DelComponentChange {
	type: "del-component";
	id: Uuid;
	skipUndelete?: boolean;
}

// ── Operations (for mod-obj changes) ────────────────────────────

export type Operation =
	| SetOperation
	| AssignOperation
	| SetTouchedOperation;

export interface SetOperation {
	type: "set";
	attr: string;
	val: any;
	ignoreTouched?: boolean;
	ignoreGeometry?: boolean;
}

export interface AssignOperation {
	type: "assign";
	value: Record<string, any>;
	ignoreTouched?: boolean;
	ignoreGeometry?: boolean;
}

export interface SetTouchedOperation {
	type: "set-touched";
	touched: string[] | null;
}

// ══════════════════════════════════════════════════════════════════
// update-file response
// ══════════════════════════════════════════════════════════════════

export interface UpdateFileResponse {
	changes: Change[];
	fileId: Uuid;
	id: Uuid;
	revn: number;
	sessionId: Uuid;
}
