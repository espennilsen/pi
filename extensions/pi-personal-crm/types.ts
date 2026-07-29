/**
 * pi-personal-crm — Core types and interfaces.
 */

// ── Labeled Value ───────────────────────────────────────────────

/**
 * A value with an optional free-form label.
 * Used for emails and phones: `[{"value":"x@y.com","label":"Work"}]`
 */
export interface LabeledValue {
	value: string;
	label?: string; // "Work", "Personal", "Mobile", etc. — free-form text
}

// ── Contact ─────────────────────────────────────────────────────

export interface Contact {
	id: number;
	first_name: string;
	last_name?: string;
	nickname?: string;
	email?: string; // Primary email (first entry or legacy plain string)
	phone?: string; // Primary phone (first entry or legacy plain string)
	emails?: LabeledValue[]; // All emails with labels (parsed from DB column)
	phones?: LabeledValue[]; // All phones with labels (parsed from DB column)
	company_id?: number;
	company_name?: string; // Denormalized for display
	birthday?: string; // YYYY-MM-DD
	anniversary?: string; // YYYY-MM-DD
	notes?: string;
	avatar_url?: string;
	tags?: string; // Comma-separated
	custom_fields?: string; // JSON
	created_at: string; // ISO timestamp
	updated_at: string; // ISO timestamp
}

export interface CreateContactData {
	first_name: string;
	last_name?: string;
	nickname?: string;
	email?: string; // Primary email or JSON array of LabeledValue
	phone?: string; // Primary phone or JSON array of LabeledValue
	emails?: LabeledValue[]; // Alternative: pass structured array (serialized to JSON for storage)
	phones?: LabeledValue[]; // Alternative: pass structured array (serialized to JSON for storage)
	company_id?: number;
	birthday?: string;
	anniversary?: string;
	notes?: string;
	avatar_url?: string;
	tags?: string;
	custom_fields?: string;
}

export interface UpdateContactData extends Partial<CreateContactData> {
	id?: never; // ID is passed separately, not in the data object
}

// ── Company ─────────────────────────────────────────────────────

export interface Company {
	id: number;
	name: string;
	website?: string;
	industry?: string;
	notes?: string;
	created_at: string;
	updated_at: string;
}

export interface CreateCompanyData {
	name: string;
	website?: string;
	industry?: string;
	notes?: string;
}

export interface UpdateCompanyData extends Partial<CreateCompanyData> {}

// ── Interaction ─────────────────────────────────────────────────

export type InteractionType = "call" | "meeting" | "note" | "email" | "message" | string;

export interface Interaction {
	id: number;
	contact_id: number;
	interaction_type: InteractionType;
	summary: string;
	notes?: string;
	happened_at: string; // ISO timestamp
	created_at: string;
}

export interface CreateInteractionData {
	contact_id: number;
	interaction_type: InteractionType;
	summary: string;
	notes?: string;
	happened_at?: string; // Defaults to now if omitted
}

// ── Reminder ────────────────────────────────────────────────────

export interface Reminder {
	id: number;
	contact_id: number;
	reminder_type: "birthday" | "anniversary" | "custom";
	reminder_date: string; // YYYY-MM-DD
	message?: string;
	created_at: string;
	// Joined from crm_contacts (present when fetched via getUpcomingReminders)
	first_name?: string;
	last_name?: string;
}

export interface CreateReminderData {
	contact_id: number;
	reminder_type: "birthday" | "anniversary" | "custom";
	reminder_date: string;
	message?: string;
}

// ── Relationship ────────────────────────────────────────────────

export interface Relationship {
	id: number;
	contact_id: number;
	related_contact_id: number;
	relationship_type: string; // "spouse", "child", "parent", "colleague", etc.
	notes?: string;
	created_at: string;
	// Joined from crm_contacts (present when fetched via getRelationships)
	first_name?: string;
	last_name?: string;
}

export interface CreateRelationshipData {
	contact_id: number;
	related_contact_id: number;
	relationship_type: string;
	notes?: string;
}

// ── Group/Tag ───────────────────────────────────────────────────

export interface Group {
	id: number;
	name: string;
	description?: string;
	created_at: string;
}

export interface CreateGroupData {
	name: string;
	description?: string;
}

// ── Extension Fields ────────────────────────────────────────────

/**
 * Third-party fields added by external extensions (e.g. LinkedIn scraper).
 * Read-only in the CRM UI — extensions write via the API.
 */
export interface ExtensionField {
	id: number;
	contact_id?: number;
	company_id?: number;
	source: string; // Extension identifier (e.g. "linkedin", "clearbit")
	field_name: string; // Field key (e.g. "headline", "profile_url")
	field_value: string; // Field value
	label?: string; // Display label (e.g. "LinkedIn Headline")
	field_type: string; // "text" | "url" | "date" | "number" | "json"
	updated_at: string;
}

export const VALID_EXTENSION_FIELD_TYPES = ["text", "url", "date", "number", "json"] as const;
export type ExtensionFieldType = (typeof VALID_EXTENSION_FIELD_TYPES)[number];

export interface SetExtensionFieldData {
	contact_id: number;
	source: string;
	field_name: string;
	field_value: string;
	label?: string;
	field_type?: ExtensionFieldType; // Defaults to "text"
}

export interface SetCompanyExtensionFieldData {
	company_id: number;
	source: string;
	field_name: string;
	field_value: string;
	label?: string;
	field_type?: ExtensionFieldType; // Defaults to "text"
}

// ── Custom Field Definition ─────────────────────────────────────

export interface CustomFieldDef {
	name: string; // Unique key
	label: string; // Display name
	type: "text" | "number" | "date" | "boolean" | "select" | string;
	options?: string[]; // For select type
	required?: boolean;
}

// ── CRM API ─────────────────────────────────────────────────────

/**
 * Main CRM API — access via crmApi singleton from db.ts
 */
export interface CrmApi {
	// Contacts
	getContacts(search?: string, limit?: number): Contact[];
	getContact(id: number): Contact | null;
	getContactsByCompany(companyId: number): Contact[];
	createContact(data: CreateContactData): Contact;
	updateContact(id: number, data: UpdateContactData): Contact | null;
	deleteContact(id: number): boolean;

	// Companies
	getCompanies(search?: string): Company[];
	getCompany(id: number): Company | null;
	createCompany(data: CreateCompanyData): Company;
	updateCompany(id: number, data: UpdateCompanyData): Company | null;
	deleteCompany(id: number): boolean;

	// Interactions
	getInteractions(contactId: number): Interaction[];
	getAllInteractions(): Interaction[];
	createInteraction(data: CreateInteractionData): Interaction;
	deleteInteraction(id: number): boolean;

	// Reminders
	getReminders(contactId?: number): Reminder[];
	getAllReminders(): Reminder[];
	getUpcomingReminders(days?: number): Reminder[];
	createReminder(data: CreateReminderData): Reminder;
	deleteReminder(id: number): boolean;

	// Relationships
	getRelationships(contactId: number): Relationship[];
	createRelationship(data: CreateRelationshipData): Relationship;
	deleteRelationship(id: number): boolean;

	// Groups
	getGroups(): Group[];
	createGroup(data: CreateGroupData): Group;
	deleteGroup(id: number): boolean;

	// Group membership
	getGroupMembers(groupId: number): Contact[];
	getContactGroups(contactId: number): Group[];
	addGroupMember(groupId: number, contactId: number): boolean;
	removeGroupMember(groupId: number, contactId: number): boolean;

	// Extension fields — contacts (third-party, read-only in UI)
	getExtensionFields(contactId: number): ExtensionField[];
	getExtensionFieldsBySource(contactId: number, source: string): ExtensionField[];
	setExtensionField(data: SetExtensionFieldData): ExtensionField;
	deleteExtensionFields(contactId: number, source: string): number;

	// Extension fields — companies (third-party, read-only in UI)
	getCompanyExtensionFields(companyId: number): ExtensionField[];
	getCompanyExtensionFieldsBySource(companyId: number, source: string): ExtensionField[];
	setCompanyExtensionField(data: SetCompanyExtensionFieldData): ExtensionField;
	deleteCompanyExtensionFields(companyId: number, source: string): number;

	// Search
	searchContacts(query: string, limit?: number): Contact[];
	searchCompanies(query: string, limit?: number): Company[];

	// Duplicate detection
	findDuplicates(data: { email?: string; first_name: string; last_name?: string }): Contact[];

	// Import/Export
	exportContactsCsv(): string;
	importContactsCsv(csv: string): ImportResult;
}

// ── Import Result ───────────────────────────────────────────────

export interface ImportResult {
	created: number;
	skipped: number;
	errors: string[];
	duplicates: { row: number; existing: Contact; incoming: string }[];
}

// ── Labeled Value Helpers ───────────────────────────────────────

/**
 * Parse a DB column value into an array of labeled values.
 * Handles:
 *   - JSON array: `[{"value":"x","label":"Work"}]`
 *   - Plain string: `"x@y.com"` → `[{"value":"x@y.com"}]`
 *   - Empty/null: `[]`
 */
export function parseLabeledValues(raw?: string | null): LabeledValue[] {
	if (!raw) return [];
	const trimmed = raw.trim();
	if (!trimmed) return [];
	if (trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed.filter(
					(item: any) => item && typeof item.value === "string" && item.value.trim(),
				);
			}
		} catch {
			// Fall through to plain string
		}
	}
	return [{ value: trimmed }];
}

/**
 * Serialize an array of labeled values to a JSON string for DB storage.
 * Returns undefined if the array is empty (stores NULL in DB).
 */
export function serializeLabeledValues(values: LabeledValue[]): string | undefined {
	const filtered = values.filter((v) => v.value.trim());
	if (filtered.length === 0) return undefined;
	// Single unlabeled value — store as plain string for backward compat
	if (filtered.length === 1 && !filtered[0].label) return filtered[0].value;
	return JSON.stringify(filtered);
}

/**
 * Get the primary (first) value from a labeled values column.
 * Used to populate the backward-compat `email` / `phone` fields.
 */
export function primaryValue(raw?: string | null): string | undefined {
	const values = parseLabeledValues(raw);
	return values.length > 0 ? values[0].value : undefined;
}

/**
 * Hydrate a contact row from the DB: parse email/phone JSON into
 * `emails`/`phones` arrays and set primary `email`/`phone` values.
 */
export function hydrateContact(row: Contact): Contact {
	const emailsRaw = row.email;
	const phonesRaw = row.phone;
	row.emails = parseLabeledValues(emailsRaw);
	row.phones = parseLabeledValues(phonesRaw);
	row.email = row.emails.length > 0 ? row.emails[0].value : undefined;
	row.phone = row.phones.length > 0 ? row.phones[0].value : undefined;
	return row;
}

/**
 * Prepare email/phone fields for DB storage from CreateContactData / UpdateContactData.
 * If `emails`/`phones` arrays are provided, serialize them to JSON.
 * If plain `email`/`phone` strings are provided, use them directly (backward compat).
 */
export function prepareContactFields(data: CreateContactData | UpdateContactData): {
	email?: string;
	phone?: string;
} {
	const result: { email?: string; phone?: string } = {};

	if (data.emails && data.emails.length > 0) {
		result.email = serializeLabeledValues(data.emails);
	} else if (data.email !== undefined) {
		result.email = data.email;
	}

	if (data.phones && data.phones.length > 0) {
		result.phone = serializeLabeledValues(data.phones);
	} else if (data.phone !== undefined) {
		result.phone = data.phone;
	}

	return result;
}
