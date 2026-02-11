/**
 * CRM Plugin Registry — allows other extensions to extend the CRM.
 *
 * Usage:
 *   import { crmRegistry } from "pi-personal-crm/registry";
 *
 *   // Register a custom entity type
 *   crmRegistry.registerEntityType({ name: "deal", ... });
 *
 *   // Listen to events
 *   crmRegistry.on("contact.created", async (contact) => { ... });
 */

import type { Contact, Interaction, CustomFieldDef } from "./types.ts";

// ── Event System ────────────────────────────────────────────────

export type CrmEvent =
	| "contact.created"
	| "contact.updated"
	| "contact.deleted"
	| "interaction.logged"
	| "reminder.triggered"
	| "entity.created"
	| "entity.updated"
	| "entity.deleted";

export type CrmEventHandler = (data: unknown) => void | Promise<void>;

// ── Custom Entity Types ─────────────────────────────────────────

/**
 * Allows plugins to register new entity types (Deals, Tickets, Invoices, etc.)
 * that link to contacts and integrate with the CRM.
 */
export interface CrmEntityType {
	name: string; // Unique key (e.g. "deal", "ticket")
	label: string; // Display name (e.g. "Deals", "Tickets")
	icon: string; // Emoji or icon class
	fields: CustomFieldDef[]; // Schema for this entity
	dbInitFn?: (dbPath: string) => void; // Self-contained DB initialization
	contactRelation: "one-to-many" | "many-to-many"; // How it links to contacts
}

// ── Custom Field Types ──────────────────────────────────────────

/**
 * Allows plugins to register new field types (currency, date-range, etc.)
 */
export interface CrmFieldType {
	name: string; // Unique key (e.g. "currency", "date-range")
	label: string; // Display name
	render: string; // HTML template or component ID
	validate?: (value: unknown) => boolean;
}

// ── Custom Interaction Types ────────────────────────────────────

/**
 * Allows plugins to register new interaction types (SMS, LinkedIn, etc.)
 */
export interface CrmInteractionType {
	name: string; // Unique key (e.g. "sms", "linkedin-message")
	label: string; // Display name
	icon: string; // Emoji or icon class
}

// ── Dashboard Widgets ───────────────────────────────────────────

/**
 * Allows plugins to add widgets to the CRM dashboard.
 */
export interface CrmWidget {
	name: string; // Unique key
	label: string; // Display name
	position: "sidebar" | "main" | "contact-detail";
	priority: number; // Sort order
	getData(): Promise<unknown>; // Data provider
	render: string; // HTML template or component ID
}

// ── Contact Card Sections ───────────────────────────────────────

/**
 * Allows plugins to add extra sections to the contact detail page.
 */
export interface CrmCardSection {
	name: string; // Unique key
	label: string; // Section heading
	priority: number; // Sort order
	getData(contactId: number): Promise<unknown>;
	render: string; // HTML template
}

// ── Pipeline Stages ─────────────────────────────────────────────

/**
 * Allows plugins to register deal/opportunity pipelines.
 */
export interface CrmPipeline {
	name: string; // Unique key
	label: string; // Display name
	stages: {
		name: string;
		label: string;
		order: number;
	}[];
}

// ── Search Providers ────────────────────────────────────────────

/**
 * Allows plugins to contribute to federated search.
 */
export interface CrmSearchProvider {
	name: string; // Unique key
	search(query: string): Promise<CrmSearchResult[]>;
}

export interface CrmSearchResult {
	type: string; // "contact", "deal", "ticket", etc.
	id: number;
	title: string;
	subtitle?: string;
	url: string; // Detail page URL
}

// ── Sub Pages ───────────────────────────────────────────────────

/**
 * Allows plugins to add additional tabs/pages under /crm.
 */
export interface CrmSubPage {
	name: string; // Unique key
	label: string; // Tab label
	icon: string;
	path: string; // Route path (e.g. "/crm/deals")
	html: string; // Page HTML content
}

// ── API Route Registration ──────────────────────────────────────

export type CrmApiHandler = () => void;

// ── Registry Implementation ─────────────────────────────────────

class CrmRegistry {
	private entityTypes: CrmEntityType[] = [];
	private fieldTypes: CrmFieldType[] = [];
	private interactionTypes: CrmInteractionType[] = [];
	private widgets: CrmWidget[] = [];
	private cardSections: CrmCardSection[] = [];
	private pipelines: CrmPipeline[] = [];
	private searchProviders: CrmSearchProvider[] = [];
	private subPages: CrmSubPage[] = [];
	private eventHandlers: Map<CrmEvent, CrmEventHandler[]> = new Map();

	// ── Entity Types ────────────────────────────────────────────

	registerEntityType(type: CrmEntityType): void {
		if (this.entityTypes.find((t) => t.name === type.name)) {
			throw new Error(`Entity type "${type.name}" is already registered`);
		}
		this.entityTypes.push(type);
	}

	getEntityTypes(): CrmEntityType[] {
		return [...this.entityTypes];
	}

	// ── Field Types ─────────────────────────────────────────────

	registerFieldType(type: CrmFieldType): void {
		if (this.fieldTypes.find((t) => t.name === type.name)) {
			throw new Error(`Field type "${type.name}" is already registered`);
		}
		this.fieldTypes.push(type);
	}

	getFieldTypes(): CrmFieldType[] {
		return [...this.fieldTypes];
	}

	// ── Interaction Types ───────────────────────────────────────

	registerInteractionType(type: CrmInteractionType): void {
		if (this.interactionTypes.find((t) => t.name === type.name)) {
			throw new Error(`Interaction type "${type.name}" is already registered`);
		}
		this.interactionTypes.push(type);
	}

	getInteractionTypes(): CrmInteractionType[] {
		return [...this.interactionTypes];
	}

	// ── Widgets ─────────────────────────────────────────────────

	registerWidget(widget: CrmWidget): void {
		if (this.widgets.find((w) => w.name === widget.name)) {
			throw new Error(`Widget "${widget.name}" is already registered`);
		}
		this.widgets.push(widget);
	}

	getWidgets(): CrmWidget[] {
		return [...this.widgets].sort((a, b) => a.priority - b.priority);
	}

	// ── Card Sections ───────────────────────────────────────────

	registerCardSection(section: CrmCardSection): void {
		if (this.cardSections.find((s) => s.name === section.name)) {
			throw new Error(`Card section "${section.name}" is already registered`);
		}
		this.cardSections.push(section);
	}

	getCardSections(): CrmCardSection[] {
		return [...this.cardSections].sort((a, b) => a.priority - b.priority);
	}

	// ── Pipelines ───────────────────────────────────────────────

	registerPipeline(pipeline: CrmPipeline): void {
		if (this.pipelines.find((p) => p.name === pipeline.name)) {
			throw new Error(`Pipeline "${pipeline.name}" is already registered`);
		}
		this.pipelines.push(pipeline);
	}

	getPipelines(): CrmPipeline[] {
		return [...this.pipelines];
	}

	// ── Search Providers ────────────────────────────────────────

	registerSearchProvider(provider: CrmSearchProvider): void {
		if (this.searchProviders.find((p) => p.name === provider.name)) {
			throw new Error(`Search provider "${provider.name}" is already registered`);
		}
		this.searchProviders.push(provider);
	}

	async search(query: string): Promise<CrmSearchResult[]> {
		const results = await Promise.all(
			this.searchProviders.map((p) =>
				p.search(query).catch((err) => {
					console.error(`Search provider "${p.name}" failed:`, err);
					return [];
				}),
			),
		);
		return results.flat();
	}

	// ── Sub Pages ───────────────────────────────────────────────

	registerSubPage(page: CrmSubPage): void {
		if (this.subPages.find((p) => p.name === page.name)) {
			throw new Error(`Sub page "${page.name}" is already registered`);
		}
		this.subPages.push(page);
	}

	getSubPages(): CrmSubPage[] {
		return [...this.subPages];
	}

	// ── Event Hooks ─────────────────────────────────────────────

	on(event: CrmEvent, handler: CrmEventHandler): void {
		if (!this.eventHandlers.has(event)) {
			this.eventHandlers.set(event, []);
		}
		this.eventHandlers.get(event)!.push(handler);
	}

	async emit(event: CrmEvent, data: unknown): Promise<void> {
		const handlers = this.eventHandlers.get(event) || [];
		// Run all handlers concurrently but catch errors individually
		await Promise.all(
			handlers.map((handler) =>
				Promise.resolve(handler(data)).catch((err) => {
					console.error(`Event handler for "${event}" failed:`, err);
				}),
			),
		);
	}
}

// ── Singleton Export ────────────────────────────────────────────

export const crmRegistry = new CrmRegistry();
