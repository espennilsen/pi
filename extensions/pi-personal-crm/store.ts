/**
 * CRM store — unified async interface over multiple backends.
 *
 * Two backends:
 *   1. "sqlite" (default) — local better-sqlite3 via db.ts
 *   2. "kysely" — shared DB via pi-kysely event bus (db-kysely.ts)
 *
 * Consumers import `getCrmStore()` and get back the same async API
 * regardless of which backend is active.
 *
 * Backend selection is driven by `pi-personal-crm.useKysely` in settings.json.
 * The sqlite backend wraps synchronous calls in resolved promises.
 * The kysely backend is natively async.
 *
 * Lazy imports: better-sqlite3 is only loaded when the sqlite backend
 * is selected, so pi-personal-crm can run without it when using kysely.
 */

import type {
	CrmApi,
	Contact,
	CreateContactData,
	UpdateContactData,
	Company,
	CreateCompanyData,
	UpdateCompanyData,
	Interaction,
	CreateInteractionData,
	Reminder,
	CreateReminderData,
	Relationship,
	CreateRelationshipData,
	Group,
	CreateGroupData,
	ExtensionField,
	SetExtensionFieldData,
	SetCompanyExtensionFieldData,
	ImportResult,
} from "./types.ts";

// ── Async CRM Store interface ───────────────────────────────────

export interface CrmStore {
	// Contacts
	getContacts(search?: string, limit?: number): Promise<Contact[]>;
	getContact(id: number): Promise<Contact | null>;
	getContactsByCompany(companyId: number): Promise<Contact[]>;
	createContact(data: CreateContactData): Promise<Contact>;
	updateContact(id: number, data: UpdateContactData): Promise<Contact | null>;
	deleteContact(id: number): Promise<boolean>;

	// Companies
	getCompanies(search?: string): Promise<Company[]>;
	getCompany(id: number): Promise<Company | null>;
	createCompany(data: CreateCompanyData): Promise<Company>;
	updateCompany(id: number, data: UpdateCompanyData): Promise<Company | null>;
	deleteCompany(id: number): Promise<boolean>;

	// Interactions
	getInteractions(contactId: number): Promise<Interaction[]>;
	getAllInteractions(): Promise<Interaction[]>;
	createInteraction(data: CreateInteractionData): Promise<Interaction>;
	deleteInteraction(id: number): Promise<boolean>;

	// Reminders
	getReminders(contactId?: number): Promise<Reminder[]>;
	getAllReminders(): Promise<Reminder[]>;
	getUpcomingReminders(days?: number): Promise<Reminder[]>;
	createReminder(data: CreateReminderData): Promise<Reminder>;
	deleteReminder(id: number): Promise<boolean>;

	// Relationships
	getRelationships(contactId: number): Promise<Relationship[]>;
	createRelationship(data: CreateRelationshipData): Promise<Relationship>;
	deleteRelationship(id: number): Promise<boolean>;

	// Groups
	getGroups(): Promise<Group[]>;
	createGroup(data: CreateGroupData): Promise<Group>;
	deleteGroup(id: number): Promise<boolean>;

	// Group membership
	getGroupMembers(groupId: number): Promise<Contact[]>;
	getContactGroups(contactId: number): Promise<Group[]>;
	addGroupMember(groupId: number, contactId: number): Promise<boolean>;
	removeGroupMember(groupId: number, contactId: number): Promise<boolean>;

	// Extension fields — contacts
	getExtensionFields(contactId: number): Promise<ExtensionField[]>;
	getExtensionFieldsBySource(contactId: number, source: string): Promise<ExtensionField[]>;
	setExtensionField(data: SetExtensionFieldData): Promise<ExtensionField>;
	deleteExtensionFields(contactId: number, source: string): Promise<number>;

	// Extension fields — companies
	getCompanyExtensionFields(companyId: number): Promise<ExtensionField[]>;
	getCompanyExtensionFieldsBySource(companyId: number, source: string): Promise<ExtensionField[]>;
	setCompanyExtensionField(data: SetCompanyExtensionFieldData): Promise<ExtensionField>;
	deleteCompanyExtensionFields(companyId: number, source: string): Promise<number>;

	// Search
	searchContacts(query: string, limit?: number): Promise<Contact[]>;
	searchCompanies(query: string, limit?: number): Promise<Company[]>;

	// Duplicate detection
	findDuplicates(data: { email?: string; first_name: string; last_name?: string }): Promise<Contact[]>;

	// Import/Export
	exportContactsCsv(): Promise<string>;
	importContactsCsv(csv: string): Promise<ImportResult>;
}

// ── Singleton ───────────────────────────────────────────────────

let activeStore: CrmStore | null = null;

export function setCrmStore(store: CrmStore): void {
	activeStore = store;
}

export function getCrmStore(): CrmStore {
	if (!activeStore) throw new Error("CRM store not initialized");
	return activeStore;
}

export function isStoreReady(): boolean {
	return activeStore !== null;
}

// ── SQLite backend (better-sqlite3, synchronous) ────────────────

/**
 * Create a store backed by the local SQLite file via better-sqlite3.
 * Uses a dynamic import so better-sqlite3 isn't loaded when using kysely.
 */
export async function createSqliteStore(dbPath: string): Promise<CrmStore> {
	const db = await import("./db.ts");
	db.initDb(dbPath);

	const api = db.crmApi;
	return {
		// Contacts
		getContacts: (s, l) => Promise.resolve(api.getContacts(s, l)),
		getContact: (id) => Promise.resolve(api.getContact(id)),
		getContactsByCompany: (id) => Promise.resolve(api.getContactsByCompany(id)),
		createContact: (d) => Promise.resolve(api.createContact(d)),
		updateContact: (id, d) => Promise.resolve(api.updateContact(id, d)),
		deleteContact: (id) => Promise.resolve(api.deleteContact(id)),

		// Companies
		getCompanies: (s) => Promise.resolve(api.getCompanies(s)),
		getCompany: (id) => Promise.resolve(api.getCompany(id)),
		createCompany: (d) => Promise.resolve(api.createCompany(d)),
		updateCompany: (id, d) => Promise.resolve(api.updateCompany(id, d)),
		deleteCompany: (id) => Promise.resolve(api.deleteCompany(id)),

		// Interactions
		getInteractions: (id) => Promise.resolve(api.getInteractions(id)),
		getAllInteractions: () => Promise.resolve(api.getAllInteractions()),
		createInteraction: (d) => Promise.resolve(api.createInteraction(d)),
		deleteInteraction: (id) => Promise.resolve(api.deleteInteraction(id)),

		// Reminders
		getReminders: (id) => Promise.resolve(api.getReminders(id)),
		getAllReminders: () => Promise.resolve(api.getAllReminders()),
		getUpcomingReminders: (days) => Promise.resolve(api.getUpcomingReminders(days)),
		createReminder: (d) => Promise.resolve(api.createReminder(d)),
		deleteReminder: (id) => Promise.resolve(api.deleteReminder(id)),

		// Relationships
		getRelationships: (id) => Promise.resolve(api.getRelationships(id)),
		createRelationship: (d) => Promise.resolve(api.createRelationship(d)),
		deleteRelationship: (id) => Promise.resolve(api.deleteRelationship(id)),

		// Groups
		getGroups: () => Promise.resolve(api.getGroups()),
		createGroup: (d) => Promise.resolve(api.createGroup(d)),
		deleteGroup: (id) => Promise.resolve(api.deleteGroup(id)),

		// Group membership
		getGroupMembers: (id) => Promise.resolve(api.getGroupMembers(id)),
		getContactGroups: (id) => Promise.resolve(api.getContactGroups(id)),
		addGroupMember: (g, c) => Promise.resolve(api.addGroupMember(g, c)),
		removeGroupMember: (g, c) => Promise.resolve(api.removeGroupMember(g, c)),

		// Extension fields — contacts
		getExtensionFields: (id) => Promise.resolve(api.getExtensionFields(id)),
		getExtensionFieldsBySource: (id, s) => Promise.resolve(api.getExtensionFieldsBySource(id, s)),
		setExtensionField: (d) => Promise.resolve(api.setExtensionField(d)),
		deleteExtensionFields: (id, s) => Promise.resolve(api.deleteExtensionFields(id, s)),

		// Extension fields — companies
		getCompanyExtensionFields: (id) => Promise.resolve(api.getCompanyExtensionFields(id)),
		getCompanyExtensionFieldsBySource: (id, s) => Promise.resolve(api.getCompanyExtensionFieldsBySource(id, s)),
		setCompanyExtensionField: (d) => Promise.resolve(api.setCompanyExtensionField(d)),
		deleteCompanyExtensionFields: (id, s) => Promise.resolve(api.deleteCompanyExtensionFields(id, s)),

		// Search
		searchContacts: (q, l) => Promise.resolve(api.searchContacts(q, l)),
		searchCompanies: (q, l) => Promise.resolve(api.searchCompanies(q, l)),

		// Duplicate detection
		findDuplicates: (d) => Promise.resolve(api.findDuplicates(d)),

		// Import/Export
		exportContactsCsv: () => Promise.resolve(api.exportContactsCsv()),
		importContactsCsv: (csv) => Promise.resolve(api.importContactsCsv(csv)),
	};
}

// ── Kysely backend (pi-kysely event bus, async) ─────────────────

interface EventBus {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
}

/**
 * Create a store backed by pi-kysely's shared database.
 */
export async function createKyselyStore(eventBus: EventBus): Promise<CrmStore> {
	const db = await import("./db-kysely.ts");
	await db.initDb(eventBus);
	return db;
}
