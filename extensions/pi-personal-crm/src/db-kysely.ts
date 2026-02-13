/**
 * pi-personal-crm — Database layer via pi-kysely event bus.
 *
 * Drop-in replacement for db.ts. No direct imports from pi-kysely,
 * no better-sqlite3 dependency. All DB access via events:
 *
 *   - kysely:info   — detect SQL dialect (sqlite/postgres/mysql)
 *   - kysely:schema:register — table creation (portable DDL)
 *   - kysely:query  — raw SQL for reads/writes
 *   - kysely:migration:apply — tracked migrations
 *
 * Dialect-aware: queries `kysely:info` on init to detect the active
 * driver and adapts dialect-specific SQL (e.g. upsert syntax).
 *
 * Requires pi-kysely extension to be loaded.
 */

import { readdirSync, readFileSync } from "node:fs";
import type { EventBus } from "@mariozechner/pi-coding-agent";
import type {
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
import {
	VALID_EXTENSION_FIELD_TYPES,
	hydrateContact,
	prepareContactFields,
	parseLabeledValues,
	serializeLabeledValues,
	type LabeledValue,
} from "./types.ts";

const ACTOR = "pi-personal-crm";

type Driver = "sqlite" | "postgres" | "mysql";

let events: EventBus;
let driver: Driver = "sqlite";
let hasLevenshteinUdf = false;

// ── Schema (portable DDL via Kysely schema builder) ─────────────

const SCHEMA = {
	actor: ACTOR,
	tables: {
		crm_companies: {
			columns: {
				id:         { type: "integer" as const, primaryKey: true, autoIncrement: true },
				name:       { type: "text" as const, notNull: true },
				website:    { type: "text" as const },
				industry:   { type: "text" as const },
				notes:      { type: "text" as const },
				created_at: { type: "text" as const, notNull: true },
				updated_at: { type: "text" as const, notNull: true },
			},
		},
		crm_contacts: {
			columns: {
				id:            { type: "integer" as const, primaryKey: true, autoIncrement: true },
				first_name:    { type: "text" as const, notNull: true },
				last_name:     { type: "text" as const },
				nickname:      { type: "text" as const },
				email:         { type: "text" as const },
				phone:         { type: "text" as const },
				company_id:    { type: "integer" as const, references: "crm_companies.id", onDelete: "set null" as const },
				birthday:      { type: "text" as const },
				anniversary:   { type: "text" as const },
				notes:         { type: "text" as const },
				avatar_url:    { type: "text" as const },
				tags:          { type: "text" as const },
				custom_fields: { type: "text" as const },
				created_at:    { type: "text" as const, notNull: true },
				updated_at:    { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["company_id"], name: "idx_contacts_company" },
				{ columns: ["email"], name: "idx_contacts_email" },
				{ columns: ["tags"], name: "idx_contacts_tags" },
			],
		},
		crm_interactions: {
			columns: {
				id:               { type: "integer" as const, primaryKey: true, autoIncrement: true },
				contact_id:       { type: "integer" as const, notNull: true, references: "crm_contacts.id", onDelete: "cascade" as const },
				interaction_type: { type: "text" as const, notNull: true },
				summary:          { type: "text" as const, notNull: true },
				notes:            { type: "text" as const },
				happened_at:      { type: "text" as const, notNull: true },
				created_at:       { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["contact_id"], name: "idx_interactions_contact" },
				{ columns: ["happened_at"], name: "idx_interactions_happened" },
			],
		},
		crm_reminders: {
			columns: {
				id:            { type: "integer" as const, primaryKey: true, autoIncrement: true },
				contact_id:    { type: "integer" as const, notNull: true, references: "crm_contacts.id", onDelete: "cascade" as const },
				reminder_type: { type: "text" as const, notNull: true },
				reminder_date: { type: "text" as const, notNull: true },
				message:       { type: "text" as const },
				created_at:    { type: "text" as const, notNull: true },
			},
			indexes: [
				{ columns: ["contact_id"], name: "idx_reminders_contact" },
				{ columns: ["reminder_date"], name: "idx_reminders_date" },
			],
		},
		crm_relationships: {
			columns: {
				id:                 { type: "integer" as const, primaryKey: true, autoIncrement: true },
				contact_id:         { type: "integer" as const, notNull: true, references: "crm_contacts.id", onDelete: "cascade" as const },
				related_contact_id: { type: "integer" as const, notNull: true, references: "crm_contacts.id", onDelete: "cascade" as const },
				relationship_type:  { type: "text" as const, notNull: true },
				notes:              { type: "text" as const },
				created_at:         { type: "text" as const, notNull: true },
			},
			unique: [["contact_id", "related_contact_id", "relationship_type"]],
			indexes: [
				{ columns: ["contact_id"], name: "idx_relationships_contact" },
				{ columns: ["related_contact_id"], name: "idx_relationships_related" },
			],
		},
		crm_groups: {
			columns: {
				id:          { type: "integer" as const, primaryKey: true, autoIncrement: true },
				name:        { type: "text" as const, notNull: true, unique: true },
				description: { type: "text" as const },
				created_at:  { type: "text" as const, notNull: true },
			},
		},
		crm_group_members: {
			columns: {
				group_id:   { type: "integer" as const, notNull: true, references: "crm_groups.id", onDelete: "cascade" as const },
				contact_id: { type: "integer" as const, notNull: true, references: "crm_contacts.id", onDelete: "cascade" as const },
				added_at:   { type: "text" as const, notNull: true },
			},
			unique: [["group_id", "contact_id"]],
			indexes: [
				{ columns: ["group_id"], name: "idx_group_members_group" },
				{ columns: ["contact_id"], name: "idx_group_members_contact" },
			],
		},
		crm_extension_fields: {
			columns: {
				id:          { type: "integer" as const, primaryKey: true, autoIncrement: true },
				contact_id:  { type: "integer" as const, notNull: true, references: "crm_contacts.id", onDelete: "cascade" as const },
				source:      { type: "text" as const, notNull: true },
				field_name:  { type: "text" as const, notNull: true },
				field_value: { type: "text" as const, notNull: true },
				label:       { type: "text" as const },
				field_type:  { type: "text" as const, notNull: true, default: "text" },
				updated_at:  { type: "text" as const, notNull: true },
			},
			unique: [["contact_id", "source", "field_name"]],
			indexes: [
				{ columns: ["contact_id"], name: "idx_ext_fields_contact" },
				{ columns: ["source"], name: "idx_ext_fields_source" },
			],
		},
		crm_company_extension_fields: {
			columns: {
				id:          { type: "integer" as const, primaryKey: true, autoIncrement: true },
				company_id:  { type: "integer" as const, notNull: true, references: "crm_companies.id", onDelete: "cascade" as const },
				source:      { type: "text" as const, notNull: true },
				field_name:  { type: "text" as const, notNull: true },
				field_value: { type: "text" as const, notNull: true },
				label:       { type: "text" as const },
				field_type:  { type: "text" as const, notNull: true, default: "text" },
				updated_at:  { type: "text" as const, notNull: true },
			},
			unique: [["company_id", "source", "field_name"]],
			indexes: [
				{ columns: ["company_id"], name: "idx_co_ext_fields_company" },
				{ columns: ["source"], name: "idx_co_ext_fields_source" },
			],
		},
	},
};

// ── Migrations ──────────────────────────────────────────────────

const migrationDir = new URL("../migrations", import.meta.url).pathname;

function loadMigrations(): Array<{ name: string; sql: string }> {
	try {
		return readdirSync(migrationDir)
			.filter((f) => f.endsWith(".sql"))
			.sort()
			.map((f) => ({
				name: f.replace(/\.sql$/, ""),
				sql: readFileSync(`${migrationDir}/${f}`, "utf-8"),
			}));
	} catch {
		return [];
	}
}

// ── Init ────────────────────────────────────────────────────────

export async function initDb(eventBus: EventBus): Promise<void> {
	events = eventBus;

	// Detect SQL dialect from pi-kysely
	events.emit("kysely:info", {
		reply: (info: { defaultDriver?: string }) => {
			if (info.defaultDriver === "postgres" || info.defaultDriver === "mysql") {
				driver = info.defaultDriver;
			}
		},
	});

	// Apply tracked migrations
	const migrations = loadMigrations();
	if (migrations.length > 0) {
		await new Promise<void>((resolve, reject) => {
			events.emit("kysely:migration:apply", {
				actor: ACTOR,
				migrations,
				reply: (result: { ok: boolean; applied: string[]; skipped: string[]; errors: string[] }) => {
					if (result.ok) resolve();
					else reject(new Error(`Migration failed: ${result.errors.join("; ")}`));
				},
			});
		});
	}

	// Schema:register as safety net
	await new Promise<void>((resolve, reject) => {
		events.emit("kysely:schema:register", {
			...SCHEMA,
			reply: (result: { ok: boolean; errors: string[] }) => {
				if (result.ok) resolve();
				else reject(new Error(`Schema register failed: ${result.errors.join("; ")}`));
			},
		});
	});

	// Register levenshtein UDF for fuzzy contact search.
	// For SQLite: registers a JS implementation via better-sqlite3's db.function().
	// For Postgres: levenshtein is available via the fuzzystrmatch extension;
	//   we try to enable it (harmless if already enabled or if permissions deny it).
	if (driver === "postgres") {
		try {
			await q("CREATE EXTENSION IF NOT EXISTS fuzzystrmatch");
			hasLevenshteinUdf = true;
		} catch {
			// Extension not available — fall back to LIKE-only search
		}
	} else {
		// SQLite / MySQL — register via kysely:function:register event
		await new Promise<void>((resolve) => {
			events.emit("kysely:function:register", {
				actor: ACTOR,
				functions: [
					{
						name: "levenshtein",
						implementation: levenshtein,
						deterministic: true,
					},
				],
				reply: (result: { ok: boolean; registered: string[]; errors: string[] }) => {
					hasLevenshteinUdf = result.registered.includes("levenshtein");
					resolve();
				},
			});
			// If no listener (pi-kysely not loaded yet), resolve immediately
			setTimeout(resolve, 100);
		});
	}
}

// ── Query helper ────────────────────────────────────────────────

interface QueryResult {
	rows: Record<string, unknown>[];
	numAffectedRows?: number;
	insertId?: number | bigint;
}

function q(sql: string, params: unknown[] = []): Promise<QueryResult> {
	return new Promise((resolve, reject) => {
		events.emit("kysely:query", {
			actor: ACTOR,
			input: { sql, params },
			reply: (result: QueryResult) => resolve(result),
			ack: (ack: { ok: boolean; error?: string }) => {
				if (!ack.ok) reject(new Error(ack.error));
			},
		});
	});
}

// ── Helpers ─────────────────────────────────────────────────────

function now(): string {
	return new Date().toISOString();
}

// ── Contacts ────────────────────────────────────────────────────

export async function getContacts(search?: string, limit: number = 100): Promise<Contact[]> {
	if (search) {
		const results = await smartSearch(search, limit);
		return results.map(hydrateContact);
	}
	const { rows } = await q(
		`SELECT c.*, co.name as company_name
		 FROM crm_contacts c
		 LEFT JOIN crm_companies co ON c.company_id = co.id
		 ORDER BY c.first_name, c.last_name
		 LIMIT ?`,
		[limit],
	);
	return (rows as unknown as Contact[]).map(hydrateContact);
}

export async function getContact(id: number): Promise<Contact | null> {
	const { rows } = await q(
		`SELECT c.*, co.name as company_name
		 FROM crm_contacts c
		 LEFT JOIN crm_companies co ON c.company_id = co.id
		 WHERE c.id = ?`,
		[id],
	);
	return rows.length > 0 ? hydrateContact(rows[0] as unknown as Contact) : null;
}

/** Internal: get raw row without hydration (for updateContact to read raw JSON). */
async function getContactRaw(id: number): Promise<Record<string, unknown> | null> {
	const { rows } = await q(
		`SELECT c.*, co.name as company_name
		 FROM crm_contacts c
		 LEFT JOIN crm_companies co ON c.company_id = co.id
		 WHERE c.id = ?`,
		[id],
	);
	return rows.length > 0 ? rows[0] : null;
}

export async function getContactsByCompany(companyId: number): Promise<Contact[]> {
	const { rows } = await q(
		`SELECT c.*, co.name as company_name
		 FROM crm_contacts c
		 LEFT JOIN crm_companies co ON c.company_id = co.id
		 WHERE c.company_id = ?
		 ORDER BY c.first_name, c.last_name`,
		[companyId],
	);
	return (rows as unknown as Contact[]).map(hydrateContact);
}

export async function createContact(data: CreateContactData): Promise<Contact> {
	const ts = now();
	const prepared = prepareContactFields(data);
	const { insertId } = await q(
		`INSERT INTO crm_contacts
		 (first_name, last_name, nickname, email, phone, company_id,
		  birthday, anniversary, notes, avatar_url, tags, custom_fields,
		  created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			data.first_name, data.last_name ?? null, data.nickname ?? null,
			prepared.email ?? data.email ?? null,
			prepared.phone ?? data.phone ?? null,
			data.company_id ?? null,
			data.birthday ?? null, data.anniversary ?? null, data.notes ?? null,
			data.avatar_url ?? null, data.tags ?? null, data.custom_fields ?? null,
			ts, ts,
		],
	);
	return (await getContact(Number(insertId)))!;
}

export async function updateContact(id: number, data: UpdateContactData): Promise<Contact | null> {
	const existing = await getContact(id);
	if (!existing) return null;

	const prepared = prepareContactFields(data);
	// Read raw DB value for email/phone (not the hydrated primary value)
	const rawRow = await getContactRaw(id);
	const existingEmailRaw = (rawRow?.email as string) ?? null;
	const existingPhoneRaw = (rawRow?.phone as string) ?? null;

	const ts = now();
	await q(
		`UPDATE crm_contacts SET
		 first_name = ?, last_name = ?, nickname = ?, email = ?, phone = ?,
		 company_id = ?, birthday = ?, anniversary = ?, notes = ?,
		 avatar_url = ?, tags = ?, custom_fields = ?, updated_at = ?
		 WHERE id = ?`,
		[
			data.first_name ?? existing.first_name,
			data.last_name ?? existing.last_name,
			data.nickname ?? existing.nickname,
			prepared.email ?? (data.email !== undefined ? data.email : existingEmailRaw),
			prepared.phone ?? (data.phone !== undefined ? data.phone : existingPhoneRaw),
			data.company_id !== undefined ? data.company_id : existing.company_id,
			data.birthday !== undefined ? data.birthday : existing.birthday,
			data.anniversary !== undefined ? data.anniversary : existing.anniversary,
			data.notes !== undefined ? data.notes : existing.notes,
			data.avatar_url !== undefined ? data.avatar_url : existing.avatar_url,
			data.tags !== undefined ? data.tags : existing.tags,
			data.custom_fields !== undefined ? data.custom_fields : existing.custom_fields,
			ts, id,
		],
	);
	return getContact(id);
}

export async function deleteContact(id: number): Promise<boolean> {
	const { numAffectedRows } = await q("DELETE FROM crm_contacts WHERE id = ?", [id]);
	return (numAffectedRows ?? 0) > 0;
}

// ── Companies ───────────────────────────────────────────────────

export async function getCompanies(search?: string): Promise<Company[]> {
	if (search) {
		const pattern = `%${search}%`;
		const { rows } = await q(
			`SELECT * FROM crm_companies
			 WHERE name LIKE ? OR industry LIKE ? OR website LIKE ?
			 ORDER BY name LIMIT 100`,
			[pattern, pattern, pattern],
		);
		return rows as unknown as Company[];
	}
	const { rows } = await q("SELECT * FROM crm_companies ORDER BY name");
	return rows as unknown as Company[];
}

export async function getCompany(id: number): Promise<Company | null> {
	const { rows } = await q("SELECT * FROM crm_companies WHERE id = ?", [id]);
	return rows.length > 0 ? (rows[0] as unknown as Company) : null;
}

export async function createCompany(data: CreateCompanyData): Promise<Company> {
	const ts = now();
	const { insertId } = await q(
		`INSERT INTO crm_companies (name, website, industry, notes, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		[data.name, data.website ?? null, data.industry ?? null, data.notes ?? null, ts, ts],
	);
	return (await getCompany(Number(insertId)))!;
}

export async function updateCompany(id: number, data: UpdateCompanyData): Promise<Company | null> {
	const existing = await getCompany(id);
	if (!existing) return null;

	const ts = now();
	await q(
		`UPDATE crm_companies SET name = ?, website = ?, industry = ?, notes = ?, updated_at = ?
		 WHERE id = ?`,
		[
			data.name ?? existing.name,
			data.website !== undefined ? data.website : existing.website,
			data.industry !== undefined ? data.industry : existing.industry,
			data.notes !== undefined ? data.notes : existing.notes,
			ts, id,
		],
	);
	return getCompany(id);
}

export async function deleteCompany(id: number): Promise<boolean> {
	const { numAffectedRows } = await q("DELETE FROM crm_companies WHERE id = ?", [id]);
	return (numAffectedRows ?? 0) > 0;
}

// ── Interactions ────────────────────────────────────────────────

export async function getInteractions(contactId: number): Promise<Interaction[]> {
	const { rows } = await q(
		"SELECT * FROM crm_interactions WHERE contact_id = ? ORDER BY happened_at DESC",
		[contactId],
	);
	return rows as unknown as Interaction[];
}

export async function getAllInteractions(): Promise<Interaction[]> {
	const { rows } = await q(
		`SELECT i.*, c.first_name, c.last_name
		 FROM crm_interactions i
		 JOIN crm_contacts c ON i.contact_id = c.id
		 ORDER BY i.happened_at DESC`,
	);
	return rows as unknown as Interaction[];
}

export async function createInteraction(data: CreateInteractionData): Promise<Interaction> {
	const happened_at = data.happened_at ?? now();
	const ts = now();
	const { insertId } = await q(
		`INSERT INTO crm_interactions (contact_id, interaction_type, summary, notes, happened_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		[data.contact_id, data.interaction_type, data.summary, data.notes ?? null, happened_at, ts],
	);
	const { rows } = await q("SELECT * FROM crm_interactions WHERE id = ?", [Number(insertId)]);
	return rows[0] as unknown as Interaction;
}

export async function deleteInteraction(id: number): Promise<boolean> {
	const { numAffectedRows } = await q("DELETE FROM crm_interactions WHERE id = ?", [id]);
	return (numAffectedRows ?? 0) > 0;
}

// ── Reminders ───────────────────────────────────────────────────

export async function getReminders(contactId?: number): Promise<Reminder[]> {
	if (contactId) {
		const { rows } = await q(
			`SELECT r.*, c.first_name, c.last_name
			 FROM crm_reminders r
			 JOIN crm_contacts c ON r.contact_id = c.id
			 WHERE r.contact_id = ?
			 ORDER BY r.reminder_date`,
			[contactId],
		);
		return rows as unknown as Reminder[];
	}
	const { rows } = await q(
		`SELECT r.*, c.first_name, c.last_name
		 FROM crm_reminders r
		 JOIN crm_contacts c ON r.contact_id = c.id
		 ORDER BY r.reminder_date`,
	);
	return rows as unknown as Reminder[];
}

export async function getAllReminders(): Promise<Reminder[]> {
	return getReminders();
}

export async function getUpcomingReminders(days: number = 7): Promise<Reminder[]> {
	const cutoffDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
	const { rows } = await q(
		`SELECT r.*, c.first_name, c.last_name
		 FROM crm_reminders r
		 JOIN crm_contacts c ON r.contact_id = c.id
		 WHERE r.reminder_date <= ?
		 ORDER BY r.reminder_date`,
		[cutoffDate],
	);
	return rows as unknown as Reminder[];
}

export async function createReminder(data: CreateReminderData): Promise<Reminder> {
	const ts = now();
	const { insertId } = await q(
		`INSERT INTO crm_reminders (contact_id, reminder_type, reminder_date, message, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		[data.contact_id, data.reminder_type, data.reminder_date, data.message ?? null, ts],
	);
	const { rows } = await q(
		`SELECT r.*, c.first_name, c.last_name
		 FROM crm_reminders r
		 JOIN crm_contacts c ON r.contact_id = c.id
		 WHERE r.id = ?`,
		[Number(insertId)],
	);
	return rows[0] as unknown as Reminder;
}

export async function deleteReminder(id: number): Promise<boolean> {
	const { numAffectedRows } = await q("DELETE FROM crm_reminders WHERE id = ?", [id]);
	return (numAffectedRows ?? 0) > 0;
}

// ── Relationships ───────────────────────────────────────────────

export async function getRelationships(contactId: number): Promise<Relationship[]> {
	const { rows } = await q(
		`SELECT r.*, c.first_name, c.last_name
		 FROM crm_relationships r
		 JOIN crm_contacts c ON r.related_contact_id = c.id
		 WHERE r.contact_id = ?`,
		[contactId],
	);
	return rows as unknown as Relationship[];
}

export async function createRelationship(data: CreateRelationshipData): Promise<Relationship> {
	const ts = now();
	const { insertId } = await q(
		`INSERT INTO crm_relationships (contact_id, related_contact_id, relationship_type, notes, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		[data.contact_id, data.related_contact_id, data.relationship_type, data.notes ?? null, ts],
	);
	const { rows } = await q(
		`SELECT r.*, c.first_name, c.last_name
		 FROM crm_relationships r
		 JOIN crm_contacts c ON r.related_contact_id = c.id
		 WHERE r.id = ?`,
		[Number(insertId)],
	);
	return rows[0] as unknown as Relationship;
}

export async function deleteRelationship(id: number): Promise<boolean> {
	const { numAffectedRows } = await q("DELETE FROM crm_relationships WHERE id = ?", [id]);
	return (numAffectedRows ?? 0) > 0;
}

// ── Groups ──────────────────────────────────────────────────────

export async function getGroups(): Promise<Group[]> {
	const { rows } = await q("SELECT * FROM crm_groups ORDER BY name");
	return rows as unknown as Group[];
}

export async function createGroup(data: CreateGroupData): Promise<Group> {
	const ts = now();
	const { insertId } = await q(
		"INSERT INTO crm_groups (name, description, created_at) VALUES (?, ?, ?)",
		[data.name, data.description ?? null, ts],
	);
	const { rows } = await q("SELECT * FROM crm_groups WHERE id = ?", [Number(insertId)]);
	return rows[0] as unknown as Group;
}

export async function deleteGroup(id: number): Promise<boolean> {
	const { numAffectedRows } = await q("DELETE FROM crm_groups WHERE id = ?", [id]);
	return (numAffectedRows ?? 0) > 0;
}

// ── Group Membership ────────────────────────────────────────────

export async function getGroupMembers(groupId: number): Promise<Contact[]> {
	const { rows } = await q(
		`SELECT c.*, co.name as company_name
		 FROM crm_group_members gm
		 JOIN crm_contacts c ON gm.contact_id = c.id
		 LEFT JOIN crm_companies co ON c.company_id = co.id
		 WHERE gm.group_id = ?
		 ORDER BY c.first_name, c.last_name`,
		[groupId],
	);
	return (rows as unknown as Contact[]).map(hydrateContact);
}

export async function getContactGroups(contactId: number): Promise<Group[]> {
	const { rows } = await q(
		`SELECT g.*
		 FROM crm_group_members gm
		 JOIN crm_groups g ON gm.group_id = g.id
		 WHERE gm.contact_id = ?
		 ORDER BY g.name`,
		[contactId],
	);
	return rows as unknown as Group[];
}

export async function addGroupMember(groupId: number, contactId: number): Promise<boolean> {
	const ts = now();
	const insertSql =
		driver === "postgres"
			? "INSERT INTO crm_group_members (group_id, contact_id, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING"
			: driver === "mysql"
				? "INSERT IGNORE INTO crm_group_members (group_id, contact_id, added_at) VALUES (?, ?, ?)"
				: "INSERT OR IGNORE INTO crm_group_members (group_id, contact_id, added_at) VALUES (?, ?, ?)";
	const { numAffectedRows } = await q(insertSql, [groupId, contactId, ts]);
	return (numAffectedRows ?? 0) > 0;
}

export async function removeGroupMember(groupId: number, contactId: number): Promise<boolean> {
	const { numAffectedRows } = await q(
		"DELETE FROM crm_group_members WHERE group_id = ? AND contact_id = ?",
		[groupId, contactId],
	);
	return (numAffectedRows ?? 0) > 0;
}

// ── Extension Fields (contacts) ─────────────────────────────────

export async function getExtensionFields(contactId: number): Promise<ExtensionField[]> {
	const { rows } = await q(
		"SELECT * FROM crm_extension_fields WHERE contact_id = ? ORDER BY source, field_name",
		[contactId],
	);
	return rows as unknown as ExtensionField[];
}

export async function getExtensionFieldsBySource(contactId: number, source: string): Promise<ExtensionField[]> {
	const { rows } = await q(
		"SELECT * FROM crm_extension_fields WHERE contact_id = ? AND source = ? ORDER BY field_name",
		[contactId, source],
	);
	return rows as unknown as ExtensionField[];
}

export async function setExtensionField(data: SetExtensionFieldData): Promise<ExtensionField> {
	const ft = data.field_type ?? "text";
	if (!VALID_EXTENSION_FIELD_TYPES.includes(ft)) {
		throw new Error(`Invalid field_type "${ft}" — must be one of: ${VALID_EXTENSION_FIELD_TYPES.join(", ")}`);
	}
	const ts = now();

	const upsertSql =
		driver === "postgres"
			? `INSERT INTO crm_extension_fields (contact_id, source, field_name, field_value, label, field_type, updated_at)
			   VALUES (?, ?, ?, ?, ?, ?, ?)
			   ON CONFLICT (contact_id, source, field_name) DO UPDATE SET
				 field_value = EXCLUDED.field_value,
				 label = COALESCE(EXCLUDED.label, crm_extension_fields.label),
				 field_type = EXCLUDED.field_type,
				 updated_at = EXCLUDED.updated_at`
			: `INSERT INTO crm_extension_fields (contact_id, source, field_name, field_value, label, field_type, updated_at)
			   VALUES (?, ?, ?, ?, ?, ?, ?)
			   ON CONFLICT(contact_id, source, field_name) DO UPDATE SET
				 field_value = excluded.field_value,
				 label = COALESCE(excluded.label, crm_extension_fields.label),
				 field_type = excluded.field_type,
				 updated_at = excluded.updated_at`;

	await q(upsertSql, [
		data.contact_id, data.source, data.field_name,
		data.field_value, data.label ?? null, ft, ts,
	]);

	const fields = await getExtensionFieldsBySource(data.contact_id, data.source);
	return fields.find(f => f.field_name === data.field_name)!;
}

export async function deleteExtensionFields(contactId: number, source: string): Promise<number> {
	const { numAffectedRows } = await q(
		"DELETE FROM crm_extension_fields WHERE contact_id = ? AND source = ?",
		[contactId, source],
	);
	return numAffectedRows ?? 0;
}

// ── Extension Fields (companies) ────────────────────────────────

export async function getCompanyExtensionFields(companyId: number): Promise<ExtensionField[]> {
	const { rows } = await q(
		"SELECT * FROM crm_company_extension_fields WHERE company_id = ? ORDER BY source, field_name",
		[companyId],
	);
	return rows as unknown as ExtensionField[];
}

export async function getCompanyExtensionFieldsBySource(companyId: number, source: string): Promise<ExtensionField[]> {
	const { rows } = await q(
		"SELECT * FROM crm_company_extension_fields WHERE company_id = ? AND source = ? ORDER BY field_name",
		[companyId, source],
	);
	return rows as unknown as ExtensionField[];
}

export async function setCompanyExtensionField(data: SetCompanyExtensionFieldData): Promise<ExtensionField> {
	const ft = data.field_type ?? "text";
	if (!VALID_EXTENSION_FIELD_TYPES.includes(ft)) {
		throw new Error(`Invalid field_type "${ft}" — must be one of: ${VALID_EXTENSION_FIELD_TYPES.join(", ")}`);
	}
	const ts = now();

	const upsertSql =
		driver === "postgres"
			? `INSERT INTO crm_company_extension_fields (company_id, source, field_name, field_value, label, field_type, updated_at)
			   VALUES (?, ?, ?, ?, ?, ?, ?)
			   ON CONFLICT (company_id, source, field_name) DO UPDATE SET
				 field_value = EXCLUDED.field_value,
				 label = COALESCE(EXCLUDED.label, crm_company_extension_fields.label),
				 field_type = EXCLUDED.field_type,
				 updated_at = EXCLUDED.updated_at`
			: `INSERT INTO crm_company_extension_fields (company_id, source, field_name, field_value, label, field_type, updated_at)
			   VALUES (?, ?, ?, ?, ?, ?, ?)
			   ON CONFLICT(company_id, source, field_name) DO UPDATE SET
				 field_value = excluded.field_value,
				 label = COALESCE(excluded.label, crm_company_extension_fields.label),
				 field_type = excluded.field_type,
				 updated_at = excluded.updated_at`;

	await q(upsertSql, [
		data.company_id, data.source, data.field_name,
		data.field_value, data.label ?? null, ft, ts,
	]);

	const fields = await getCompanyExtensionFieldsBySource(data.company_id, data.source);
	return fields.find(f => f.field_name === data.field_name)!;
}

export async function deleteCompanyExtensionFields(companyId: number, source: string): Promise<number> {
	const { numAffectedRows } = await q(
		"DELETE FROM crm_company_extension_fields WHERE company_id = ? AND source = ?",
		[companyId, source],
	);
	return numAffectedRows ?? 0;
}

// ── Search ──────────────────────────────────────────────────────

export async function searchContacts(query: string, limit: number = 20): Promise<Contact[]> {
	return getContacts(query, limit);
}

export async function searchCompanies(query: string, limit: number = 20): Promise<Company[]> {
	const companies = await getCompanies(query);
	return companies.slice(0, limit);
}

// ── Smart Search (port of db.ts logic, without levenshtein UDF) ─

/**
 * Smart search — port of db.ts search logic.
 *
 * Step 1: Multi-term AND match across first_name / last_name.
 * Step 2: Comma fallback ("Last, First").
 * Step 3: Single-pattern LIKE across all fields.
 * Step 4: Fuzzy fallback via levenshtein UDF (when registered).
 *
 * The levenshtein UDF is registered on SQLite via kysely:function:register
 * and on Postgres via the fuzzystrmatch extension. If neither is available,
 * step 4 is skipped.
 */
async function smartSearch(search: string, limit: number): Promise<Contact[]> {
	const trimmed = search.trim();
	if (!trimmed) return [];

	const terms = trimmed.split(/\s+/).filter(t => t.length > 0);

	// Step 1: Multi-term — all terms must match first_name or last_name
	if (terms.length > 1) {
		const conditions = terms.map((_t, i) =>
			`(LOWER(c.first_name) LIKE LOWER(?) OR LOWER(COALESCE(c.last_name, '')) LIKE ?)`,
		);
		const params: unknown[] = [];
		for (const t of terms) {
			params.push(`%${t}%`, `%${t.toLowerCase()}%`);
		}
		params.push(limit);

		const sql = `
			SELECT c.*, co.name as company_name
			FROM crm_contacts c
			LEFT JOIN crm_companies co ON c.company_id = co.id
			WHERE ${conditions.join(" AND ")}
			ORDER BY c.first_name, c.last_name
			LIMIT ?
		`;

		const { rows } = await q(sql, params);
		if (rows.length > 0) return rows as unknown as Contact[];

		// Step 2: Comma fallback — "Last, First"
		if (trimmed.includes(",")) {
			const [lastName, ...firstParts] = trimmed.split(",").map(s => s.trim());
			const firstName = firstParts.join(" ").trim();
			if (lastName && firstName) {
				const { rows: commaRows } = await q(
					`SELECT c.*, co.name as company_name
					 FROM crm_contacts c
					 LEFT JOIN crm_companies co ON c.company_id = co.id
					 WHERE LOWER(COALESCE(c.last_name, '')) LIKE LOWER(?)
					   AND LOWER(c.first_name) LIKE LOWER(?)
					 ORDER BY c.first_name, c.last_name
					 LIMIT ?`,
					[`%${lastName}%`, `%${firstName}%`, limit],
				);
				if (commaRows.length > 0) return commaRows as unknown as Contact[];
			}
		}
	}

	// Step 3: Single-pattern LIKE across all fields
	const pattern = `%${trimmed}%`;
	const { rows } = await q(
		`SELECT c.*, co.name as company_name
		 FROM crm_contacts c
		 LEFT JOIN crm_companies co ON c.company_id = co.id
		 WHERE c.first_name LIKE ? OR c.last_name LIKE ? OR c.nickname LIKE ?
		    OR c.email LIKE ? OR c.phone LIKE ? OR c.tags LIKE ?
		 ORDER BY c.first_name, c.last_name
		 LIMIT ?`,
		[pattern, pattern, pattern, pattern, pattern, pattern, limit],
	);
	if (rows.length > 0) return rows as unknown as Contact[];

	// Step 4: Fuzzy search via levenshtein UDF
	if (hasLevenshteinUdf) {
		return searchContactsFuzzy(terms, limit);
	}

	return [];
}

/**
 * Fuzzy fallback: find contacts where name terms are within edit distance.
 * Uses the levenshtein() SQL UDF to compute distances server-side.
 *
 * Threshold scales with term length: max(2, floor(term.length / 3)).
 *
 * For each search term, we find the minimum levenshtein distance across
 * first_name, last_name, and nickname. All terms must match within threshold.
 * Results are ordered by total distance (best matches first).
 */
async function searchContactsFuzzy(terms: string[], limit: number): Promise<Contact[]> {
	if (terms.length === 0) return [];

	// Build a query that computes per-term minimum distances and filters/sorts.
	// For each term, compute: MIN(lev(term, first_name), lev(term, last_name), lev(term, nickname))
	// Then require each min_dist <= threshold, and ORDER BY sum of min_dists.

	const selectParts: string[] = [];
	const havingParts: string[] = [];
	const params: unknown[] = [];

	for (let i = 0; i < terms.length; i++) {
		const t = terms[i].toLowerCase();
		const threshold = Math.max(2, Math.floor(t.length / 3));

		// Use MIN across name fields for this term
		selectParts.push(
			`MIN(levenshtein(LOWER(?), LOWER(c.first_name)),` +
			` levenshtein(LOWER(?), LOWER(COALESCE(c.last_name, ''))),` +
			` levenshtein(LOWER(?), LOWER(COALESCE(c.nickname, '')))) as dist_${i}`,
		);
		params.push(t, t, t);
		havingParts.push(`dist_${i} <= ${threshold}`);
	}

	const orderExpr = terms.map((_, i) => `dist_${i}`).join(" + ");

	const sql = `
		SELECT c.*, co.name as company_name, ${selectParts.join(", ")}
		FROM crm_contacts c
		LEFT JOIN crm_companies co ON c.company_id = co.id
		GROUP BY c.id
		HAVING ${havingParts.join(" AND ")}
		ORDER BY (${orderExpr}) ASC
		LIMIT ?
	`;
	params.push(limit);

	const { rows } = await q(sql, params);
	// Strip the dist_ columns from results
	return rows.map((r) => {
		const clean = { ...r };
		for (const key of Object.keys(clean)) {
			if (key.startsWith("dist_")) delete clean[key];
		}
		return clean;
	}) as unknown as Contact[];
}

// ── Duplicate Detection ─────────────────────────────────────────

export async function findDuplicates(data: { email?: string; first_name: string; last_name?: string }): Promise<Contact[]> {
	const found = new Map<number, Contact>();

	// Check by email — exact match and LIKE for JSON arrays
	if (data.email) {
		const { rows } = await q(
			`SELECT c.*, co.name as company_name
			 FROM crm_contacts c
			 LEFT JOIN crm_companies co ON c.company_id = co.id
			 WHERE (c.email = ? OR c.email LIKE ?) AND c.email IS NOT NULL AND c.email != ''`,
			[data.email, `%${data.email}%`],
		);
		for (const r of rows) found.set((r as any).id, hydrateContact(r as unknown as Contact));
	}

	const { rows: byName } = await q(
		`SELECT c.*, co.name as company_name
		 FROM crm_contacts c
		 LEFT JOIN crm_companies co ON c.company_id = co.id
		 WHERE LOWER(c.first_name) = LOWER(?) AND LOWER(COALESCE(c.last_name, '')) = LOWER(?)`,
		[data.first_name, data.last_name ?? ""],
	);
	for (const r of byName) found.set((r as any).id, hydrateContact(r as unknown as Contact));

	return [...found.values()];
}

// ── CSV Export ──────────────────────────────────────────────────

export async function exportContactsCsv(): Promise<string> {
	const contacts = await getContacts(undefined, 100_000);
	const headers = [
		"first_name", "last_name", "email", "phone",
		"emails", "phones",
		"company_name", "birthday", "anniversary", "tags", "notes",
	];

	const escCsv = (val: string | null | undefined): string => {
		if (val == null || val === "") return "";
		const s = String(val);
		if (s.includes(",") || s.includes('"') || s.includes("\n")) {
			return `"${s.replace(/"/g, '""')}"`;
		}
		return s;
	};

	const formatLabeled = (items?: LabeledValue[]): string => {
		if (!items || items.length === 0) return "";
		return items
			.map((v) => (v.label ? `${v.label}: ${v.value}` : v.value))
			.join("; ");
	};

	const rows = [headers.join(",")];
	for (const c of contacts) {
		rows.push([
			escCsv(c.first_name), escCsv(c.last_name), escCsv(c.email),
			escCsv(c.phone),
			escCsv(formatLabeled(c.emails)),
			escCsv(formatLabeled(c.phones)),
			escCsv(c.company_name), escCsv(c.birthday),
			escCsv(c.anniversary), escCsv(c.tags), escCsv(c.notes),
		].join(","));
	}

	return rows.join("\n");
}

// ── CSV Import ──────────────────────────────────────────────────

export async function importContactsCsv(csv: string): Promise<ImportResult> {
	const result: ImportResult = { created: 0, skipped: 0, errors: [], duplicates: [] };

	const lines = parseCsvLines(csv);
	if (lines.length < 2) {
		result.errors.push("CSV must have a header row and at least one data row");
		return result;
	}

	const headers = lines[0].map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));

	// Standard field mapping (excludes email/phone — handled separately with labels)
	const fieldMap: Record<string, string> = {
		// Name
		"first_name": "first_name", "firstname": "first_name", "first": "first_name",
		"last_name": "last_name", "lastname": "last_name", "last": "last_name", "surname": "last_name",
		"nickname": "nickname", "nick": "nickname",

		// Company (incl. Outlook "Company")
		"company": "company_name", "company_name": "company_name",
		"organization": "company_name", "org": "company_name",

		// Dates
		"birthday": "birthday", "date_of_birth": "birthday", "dob": "birthday", "birth_date": "birthday",
		"anniversary": "anniversary",

		// Tags / Notes
		"tags": "tags", "labels": "tags", "categories": "tags",
		"notes": "notes", "note": "notes", "description": "notes",
	};

	// Email columns → labeled values
	const emailColMap: Record<string, string | undefined> = {
		"email": undefined, "email_address": undefined, "e-mail": undefined,
		"e-mail_address": undefined,
		"e-mail_2_address": "Email 2", "e-mail_3_address": "Email 3",
	};

	// Phone columns → labeled values
	const phoneColMap: Record<string, string | undefined> = {
		"phone": undefined, "phone_number": undefined, "telephone": undefined,
		"mobile": "Mobile", "mobile_phone": "Mobile",
		"home_phone": "Home", "home_phone_2": "Home 2",
		"business_phone": "Work", "business_phone_2": "Work 2",
		"primary_phone": undefined, "car_phone": "Car", "other_phone": "Other",
	};

	const colMap: { index: number; field: string }[] = [];
	const emailCols: { index: number; label?: string }[] = [];
	const phoneCols: { index: number; label?: string }[] = [];
	for (let i = 0; i < headers.length; i++) {
		const h = headers[i];
		const mapped = fieldMap[h];
		if (mapped) {
			colMap.push({ index: i, field: mapped });
		} else if (h in emailColMap) {
			emailCols.push({ index: i, label: emailColMap[h] });
		} else if (h in phoneColMap) {
			phoneCols.push({ index: i, label: phoneColMap[h] });
		}
	}

	if (!colMap.find(c => c.field === "first_name")) {
		result.errors.push(`Missing required column: first_name (found: ${headers.join(", ")})`);
		return result;
	}

	for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
		const cols = lines[rowIdx];
		if (cols.length === 0 || (cols.length === 1 && cols[0].trim() === "")) continue;

		const row: Record<string, string> = {};
		for (const { index, field } of colMap) {
			if (index < cols.length && cols[index].trim()) {
				if (!row[field]) {
					row[field] = cols[index].trim();
				}
			}
		}

		// Collect labeled emails
		const emails: LabeledValue[] = [];
		for (const { index, label } of emailCols) {
			if (index < cols.length && cols[index].trim()) {
				emails.push({ value: cols[index].trim(), ...(label ? { label } : {}) });
			}
		}

		// Collect labeled phones
		const phones: LabeledValue[] = [];
		for (const { index, label } of phoneCols) {
			if (index < cols.length && cols[index].trim()) {
				phones.push({ value: cols[index].trim(), ...(label ? { label } : {}) });
			}
		}

		if (!row.first_name) {
			result.errors.push(`Row ${rowIdx + 1}: missing first_name, skipped`);
			result.skipped++;
			continue;
		}

		// Duplicate check (uses primary email)
		const primaryEmail = emails.length > 0 ? emails[0].value : undefined;
		const dupes = await findDuplicates({
			email: primaryEmail,
			first_name: row.first_name,
			last_name: row.last_name,
		});

		if (dupes.length > 0) {
			const label = `${row.first_name} ${row.last_name || ""}`.trim();
			result.duplicates.push({ row: rowIdx + 1, existing: dupes[0], incoming: label });
			result.skipped++;
			continue;
		}

		let company_id: number | undefined;
		if (row.company_name) {
			const companies = await getCompanies(row.company_name);
			const exact = companies.find(c => c.name.toLowerCase() === row.company_name!.toLowerCase());
			if (exact) {
				company_id = exact.id;
			} else {
				const newCo = await createCompany({ name: row.company_name });
				company_id = newCo.id;
			}
		}

		try {
			await createContact({
				first_name: row.first_name,
				last_name: row.last_name,
				nickname: row.nickname,
				emails: emails.length > 0 ? emails : undefined,
				email: emails.length === 0 ? row.email : undefined,
				phones: phones.length > 0 ? phones : undefined,
				phone: phones.length === 0 ? row.phone : undefined,
				company_id,
				birthday: row.birthday,
				anniversary: row.anniversary,
				tags: row.tags,
				notes: row.notes,
			});
			result.created++;
		} catch (err: any) {
			result.errors.push(`Row ${rowIdx + 1}: ${err.message}`);
			result.skipped++;
		}
	}

	return result;
}

// ── CSV Parser ──────────────────────────────────────────────────

function parseCsvLines(csv: string): string[][] {
	const rows: string[][] = [];
	let current: string[] = [];
	let field = "";
	let inQuotes = false;

	for (let i = 0; i < csv.length; i++) {
		const ch = csv[i];

		if (inQuotes) {
			if (ch === '"') {
				if (i + 1 < csv.length && csv[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += ch;
			}
		} else {
			if (ch === '"') {
				inQuotes = true;
			} else if (ch === ",") {
				current.push(field);
				field = "";
			} else if (ch === "\n") {
				current.push(field);
				field = "";
				if (current.length > 0) rows.push(current);
				current = [];
			} else if (ch === "\r") {
				// skip
			} else {
				field += ch;
			}
		}
	}

	current.push(field);
	if (current.length > 0 && !(current.length === 1 && current[0] === "")) {
		rows.push(current);
	}

	return rows;
}

// ── Levenshtein Distance ────────────────────────────────────────

/**
 * Classic Levenshtein edit distance. O(n*m) time, O(min(n,m)) space.
 *
 * Registered as a SQL UDF on SQLite via kysely:function:register so it
 * can be used in WHERE/ORDER BY clauses for fuzzy contact search.
 */
function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	// Ensure a is the shorter string for space efficiency
	if (a.length > b.length) [a, b] = [b, a];

	const aLen = a.length;
	const bLen = b.length;
	let prev = new Array(aLen + 1);
	let curr = new Array(aLen + 1);

	for (let i = 0; i <= aLen; i++) prev[i] = i;

	for (let j = 1; j <= bLen; j++) {
		curr[0] = j;
		for (let i = 1; i <= aLen; i++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[i] = Math.min(
				prev[i] + 1,        // deletion
				curr[i - 1] + 1,    // insertion
				prev[i - 1] + cost, // substitution
			);
		}
		[prev, curr] = [curr, prev];
	}

	return prev[aLen];
}
