/**
 * CRM Database.
 *
 * Self-contained: owns migrations, prepared statements, and CRUD operations.
 * Call initDb(path) to open the database and run migrations.
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
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
import { VALID_EXTENSION_FIELD_TYPES } from "./types.ts";
import { crmRegistry } from "./registry.ts";

// ── Prepared Statements (initialized in init()) ────────────────

let stmts: {
	// Contacts
	getContacts: any;
	getContactById: any;
	getContactsByCompany: any;
	searchContacts: any;
	insertContact: any;
	updateContact: any;
	deleteContact: any;

	// Companies
	getCompanies: any;
	getCompanyById: any;
	searchCompanies: any;
	insertCompany: any;
	updateCompany: any;
	deleteCompany: any;

	// Interactions
	getInteractions: any;
	getAllInteractions: any;
	insertInteraction: any;
	deleteInteraction: any;

	// Reminders
	getReminders: any;
	getAllReminders: any;
	getRemindersByContact: any;
	getUpcomingReminders: any;
	insertReminder: any;
	deleteReminder: any;

	// Relationships
	getRelationships: any;
	insertRelationship: any;
	deleteRelationship: any;

	// Groups
	getGroups: any;
	insertGroup: any;
	deleteGroup: any;

	// Group members
	getGroupMembers: any;
	getContactGroups: any;
	addGroupMember: any;

	// Extension fields (contacts)
	getExtensionFields: any;
	getExtensionFieldsBySource: any;
	upsertExtensionField: any;
	deleteExtensionFields: any;

	// Extension fields (companies)
	getCompanyExtensionFields: any;
	getCompanyExtensionFieldsBySource: any;
	upsertCompanyExtensionField: any;
	deleteCompanyExtensionFields: any;

	// Duplicate detection
	findDuplicatesByEmail: any;
	findDuplicatesByName: any;
	removeGroupMember: any;
};

// ── DB Module Definition ────────────────────────────────────────

// ── Migrations ──────────────────────────────────────────────────

const migrations: string[] = [
	// Migration 1: Core tables
	`
		-- Companies (referenced by contacts)
		CREATE TABLE IF NOT EXISTS crm_companies (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			website TEXT,
			industry TEXT,
			notes TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);

		-- Contacts
		CREATE TABLE IF NOT EXISTS crm_contacts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			first_name TEXT NOT NULL,
			last_name TEXT,
			nickname TEXT,
			email TEXT,
			phone TEXT,
			company_id INTEGER,
			birthday TEXT,
			anniversary TEXT,
			notes TEXT,
			avatar_url TEXT,
			tags TEXT,
			custom_fields TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			FOREIGN KEY (company_id) REFERENCES crm_companies(id) ON DELETE SET NULL
		);

		-- Interactions (timeline)
		CREATE TABLE IF NOT EXISTS crm_interactions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			contact_id INTEGER NOT NULL,
			interaction_type TEXT NOT NULL,
			summary TEXT NOT NULL,
			notes TEXT,
			happened_at TEXT NOT NULL DEFAULT (datetime('now')),
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE
		);

		-- Reminders
		CREATE TABLE IF NOT EXISTS crm_reminders (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			contact_id INTEGER NOT NULL,
			reminder_type TEXT NOT NULL CHECK(reminder_type IN ('birthday', 'anniversary', 'custom')),
			reminder_date TEXT NOT NULL,
			message TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE
		);

		-- Relationships
		CREATE TABLE IF NOT EXISTS crm_relationships (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			contact_id INTEGER NOT NULL,
			related_contact_id INTEGER NOT NULL,
			relationship_type TEXT NOT NULL,
			notes TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE,
			FOREIGN KEY (related_contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE,
			UNIQUE(contact_id, related_contact_id, relationship_type)
		);

		-- Groups
		CREATE TABLE IF NOT EXISTS crm_groups (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			description TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);

		-- Indexes
		CREATE INDEX IF NOT EXISTS idx_contacts_company ON crm_contacts(company_id);
		CREATE INDEX IF NOT EXISTS idx_contacts_email ON crm_contacts(email);
		CREATE INDEX IF NOT EXISTS idx_contacts_tags ON crm_contacts(tags);
		CREATE INDEX IF NOT EXISTS idx_interactions_contact ON crm_interactions(contact_id);
		CREATE INDEX IF NOT EXISTS idx_interactions_happened ON crm_interactions(happened_at);
		CREATE INDEX IF NOT EXISTS idx_reminders_contact ON crm_reminders(contact_id);
		CREATE INDEX IF NOT EXISTS idx_reminders_date ON crm_reminders(reminder_date);
		CREATE INDEX IF NOT EXISTS idx_relationships_contact ON crm_relationships(contact_id);
		CREATE INDEX IF NOT EXISTS idx_relationships_related ON crm_relationships(related_contact_id);
		`,

		// Migration 2: Group membership join table
		`
		CREATE TABLE IF NOT EXISTS crm_group_members (
			group_id INTEGER NOT NULL,
			contact_id INTEGER NOT NULL,
			added_at TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (group_id, contact_id),
			FOREIGN KEY (group_id) REFERENCES crm_groups(id) ON DELETE CASCADE,
			FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_group_members_group ON crm_group_members(group_id);
		CREATE INDEX IF NOT EXISTS idx_group_members_contact ON crm_group_members(contact_id);
		`,

		// Migration 3: Extension fields (third-party data)
		`
		CREATE TABLE IF NOT EXISTS crm_extension_fields (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			contact_id INTEGER NOT NULL,
			source TEXT NOT NULL,
			field_name TEXT NOT NULL,
			field_value TEXT NOT NULL,
			label TEXT,
			field_type TEXT NOT NULL DEFAULT 'text',
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE,
			UNIQUE(contact_id, source, field_name)
		);

		CREATE INDEX IF NOT EXISTS idx_ext_fields_contact ON crm_extension_fields(contact_id);
		CREATE INDEX IF NOT EXISTS idx_ext_fields_source ON crm_extension_fields(source);
		`,

		// Migration 4: Extension fields for companies
		`
		CREATE TABLE IF NOT EXISTS crm_company_extension_fields (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			company_id INTEGER NOT NULL,
			source TEXT NOT NULL,
			field_name TEXT NOT NULL,
			field_value TEXT NOT NULL,
			label TEXT,
			field_type TEXT NOT NULL DEFAULT 'text',
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			FOREIGN KEY (company_id) REFERENCES crm_companies(id) ON DELETE CASCADE,
			UNIQUE(company_id, source, field_name)
		);

		CREATE INDEX IF NOT EXISTS idx_co_ext_fields_company ON crm_company_extension_fields(company_id);
		CREATE INDEX IF NOT EXISTS idx_co_ext_fields_source ON crm_company_extension_fields(source);
		`,
];

// ── Database Initialization ─────────────────────────────────────

let db: DatabaseType;

/**
 * Open the CRM database, run migrations, and prepare statements.
 * Safe to call multiple times (re-initializes).
 */
export function initDb(dbPath: string): void {
	db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");

	// Register custom functions
	db.function("levenshtein", { deterministic: true }, levenshtein);

	// Migration tracking
	db.exec(`CREATE TABLE IF NOT EXISTS crm_module_versions (
		module TEXT PRIMARY KEY,
		version INTEGER NOT NULL DEFAULT 0
	)`);

	const versionRow = db.prepare("SELECT version FROM crm_module_versions WHERE module = ?").get("crm") as { version: number } | undefined;
	const currentVersion = versionRow?.version ?? 0;

	for (let i = currentVersion; i < migrations.length; i++) {
		db.exec(migrations[i]);
		db.prepare("INSERT OR REPLACE INTO crm_module_versions (module, version) VALUES (?, ?)").run("crm", i + 1);
	}

	// Prepare all statements
	stmts = {
			// Contacts
			getContacts: db.prepare(`
				SELECT 
					c.*,
					co.name as company_name
				FROM crm_contacts c
				LEFT JOIN crm_companies co ON c.company_id = co.id
				ORDER BY c.first_name, c.last_name
				LIMIT ?
			`),

			getContactById: db.prepare(`
				SELECT 
					c.*,
					co.name as company_name
				FROM crm_contacts c
				LEFT JOIN crm_companies co ON c.company_id = co.id
				WHERE c.id = ?
			`),

			getContactsByCompany: db.prepare(`
				SELECT 
					c.*,
					co.name as company_name
				FROM crm_contacts c
				LEFT JOIN crm_companies co ON c.company_id = co.id
				WHERE c.company_id = ?
				ORDER BY c.first_name, c.last_name
			`),

			searchContacts: db.prepare(`
				SELECT 
					c.*,
					co.name as company_name
				FROM crm_contacts c
				LEFT JOIN crm_companies co ON c.company_id = co.id
				WHERE 
					c.first_name LIKE ? OR 
					c.last_name LIKE ? OR 
					c.nickname LIKE ? OR
					c.email LIKE ? OR
					c.phone LIKE ? OR
					c.tags LIKE ?
				ORDER BY c.first_name, c.last_name
				LIMIT ?
			`),

			insertContact: db.prepare(`
				INSERT INTO crm_contacts (
					first_name, last_name, nickname, email, phone, company_id,
					birthday, anniversary, notes, avatar_url, tags, custom_fields
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`),

			updateContact: db.prepare(`
				UPDATE crm_contacts SET
					first_name = ?,
					last_name = ?,
					nickname = ?,
					email = ?,
					phone = ?,
					company_id = ?,
					birthday = ?,
					anniversary = ?,
					notes = ?,
					avatar_url = ?,
					tags = ?,
					custom_fields = ?,
					updated_at = datetime('now')
				WHERE id = ?
			`),

			deleteContact: db.prepare(`DELETE FROM crm_contacts WHERE id = ?`),

			// Companies
			getCompanies: db.prepare(`
				SELECT * FROM crm_companies
				ORDER BY name
			`),

			getCompanyById: db.prepare(`SELECT * FROM crm_companies WHERE id = ?`),

			searchCompanies: db.prepare(`
				SELECT * FROM crm_companies
				WHERE name LIKE ? OR industry LIKE ? OR website LIKE ?
				ORDER BY name
				LIMIT ?
			`),

			insertCompany: db.prepare(`
				INSERT INTO crm_companies (name, website, industry, notes)
				VALUES (?, ?, ?, ?)
			`),

			updateCompany: db.prepare(`
				UPDATE crm_companies SET
					name = ?,
					website = ?,
					industry = ?,
					notes = ?,
					updated_at = datetime('now')
				WHERE id = ?
			`),

			deleteCompany: db.prepare(`DELETE FROM crm_companies WHERE id = ?`),

			// Interactions
			getInteractions: db.prepare(`
				SELECT * FROM crm_interactions
				WHERE contact_id = ?
				ORDER BY happened_at DESC
			`),

			getAllInteractions: db.prepare(`
				SELECT i.*, c.first_name, c.last_name
				FROM crm_interactions i
				JOIN crm_contacts c ON i.contact_id = c.id
				ORDER BY i.happened_at DESC
			`),

			insertInteraction: db.prepare(`
				INSERT INTO crm_interactions (contact_id, interaction_type, summary, notes, happened_at)
				VALUES (?, ?, ?, ?, ?)
			`),

			deleteInteraction: db.prepare(`DELETE FROM crm_interactions WHERE id = ?`),

			// Reminders
			getReminders: db.prepare(`
				SELECT r.*, c.first_name, c.last_name
				FROM crm_reminders r
				JOIN crm_contacts c ON r.contact_id = c.id
				ORDER BY r.reminder_date
			`),

			getAllReminders: db.prepare(`
				SELECT r.*, c.first_name, c.last_name
				FROM crm_reminders r
				JOIN crm_contacts c ON r.contact_id = c.id
				ORDER BY r.reminder_date
			`),

			getRemindersByContact: db.prepare(`
				SELECT r.*, c.first_name, c.last_name
				FROM crm_reminders r
				JOIN crm_contacts c ON r.contact_id = c.id
				WHERE r.contact_id = ?
				ORDER BY r.reminder_date
			`),

			getUpcomingReminders: db.prepare(`
				SELECT r.*, c.first_name, c.last_name
				FROM crm_reminders r
				JOIN crm_contacts c ON r.contact_id = c.id
				WHERE date(r.reminder_date) <= date('now', '+' || ? || ' days')
				ORDER BY r.reminder_date
			`),

			insertReminder: db.prepare(`
				INSERT INTO crm_reminders (contact_id, reminder_type, reminder_date, message)
				VALUES (?, ?, ?, ?)
			`),

			deleteReminder: db.prepare(`DELETE FROM crm_reminders WHERE id = ?`),

			// Relationships
			getRelationships: db.prepare(`
				SELECT r.*, c.first_name, c.last_name
				FROM crm_relationships r
				JOIN crm_contacts c ON r.related_contact_id = c.id
				WHERE r.contact_id = ?
			`),

			insertRelationship: db.prepare(`
				INSERT INTO crm_relationships (contact_id, related_contact_id, relationship_type, notes)
				VALUES (?, ?, ?, ?)
			`),

			deleteRelationship: db.prepare(`DELETE FROM crm_relationships WHERE id = ?`),

			// Groups
			getGroups: db.prepare(`SELECT * FROM crm_groups ORDER BY name`),

			insertGroup: db.prepare(`
				INSERT INTO crm_groups (name, description)
				VALUES (?, ?)
			`),

			deleteGroup: db.prepare(`DELETE FROM crm_groups WHERE id = ?`),

			// Group members
			getGroupMembers: db.prepare(`
				SELECT c.*, co.name as company_name
				FROM crm_group_members gm
				JOIN crm_contacts c ON gm.contact_id = c.id
				LEFT JOIN crm_companies co ON c.company_id = co.id
				WHERE gm.group_id = ?
				ORDER BY c.first_name, c.last_name
			`),

			getContactGroups: db.prepare(`
				SELECT g.*
				FROM crm_group_members gm
				JOIN crm_groups g ON gm.group_id = g.id
				WHERE gm.contact_id = ?
				ORDER BY g.name
			`),

			addGroupMember: db.prepare(`
				INSERT OR IGNORE INTO crm_group_members (group_id, contact_id)
				VALUES (?, ?)
			`),

			removeGroupMember: db.prepare(`
				DELETE FROM crm_group_members
				WHERE group_id = ? AND contact_id = ?
			`),

			// Extension fields
			getExtensionFields: db.prepare(`
				SELECT * FROM crm_extension_fields
				WHERE contact_id = ?
				ORDER BY source, field_name
			`),

			getExtensionFieldsBySource: db.prepare(`
				SELECT * FROM crm_extension_fields
				WHERE contact_id = ? AND source = ?
				ORDER BY field_name
			`),

			upsertExtensionField: db.prepare(`
				INSERT INTO crm_extension_fields (contact_id, source, field_name, field_value, label, field_type, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
				ON CONFLICT(contact_id, source, field_name) DO UPDATE SET
					field_value = excluded.field_value,
					label = COALESCE(excluded.label, crm_extension_fields.label),
					field_type = excluded.field_type,
					updated_at = datetime('now')
			`),

			deleteExtensionFields: db.prepare(`
				DELETE FROM crm_extension_fields
				WHERE contact_id = ? AND source = ?
			`),

			// Extension fields (companies)
			getCompanyExtensionFields: db.prepare(`
				SELECT * FROM crm_company_extension_fields
				WHERE company_id = ?
				ORDER BY source, field_name
			`),

			getCompanyExtensionFieldsBySource: db.prepare(`
				SELECT * FROM crm_company_extension_fields
				WHERE company_id = ? AND source = ?
				ORDER BY field_name
			`),

			upsertCompanyExtensionField: db.prepare(`
				INSERT INTO crm_company_extension_fields (company_id, source, field_name, field_value, label, field_type, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
				ON CONFLICT(company_id, source, field_name) DO UPDATE SET
					field_value = excluded.field_value,
					label = COALESCE(excluded.label, crm_company_extension_fields.label),
					field_type = excluded.field_type,
					updated_at = datetime('now')
			`),

			deleteCompanyExtensionFields: db.prepare(`
				DELETE FROM crm_company_extension_fields
				WHERE company_id = ? AND source = ?
			`),

			// Duplicate detection
			findDuplicatesByEmail: db.prepare(`
				SELECT c.*, co.name as company_name
				FROM crm_contacts c
				LEFT JOIN crm_companies co ON c.company_id = co.id
				WHERE c.email = ? AND c.email IS NOT NULL AND c.email != ''
			`),

			findDuplicatesByName: db.prepare(`
				SELECT c.*, co.name as company_name
				FROM crm_contacts c
				LEFT JOIN crm_companies co ON c.company_id = co.id
				WHERE LOWER(c.first_name) = LOWER(?) AND LOWER(COALESCE(c.last_name, '')) = LOWER(?)
			`),
		};

	// Register core entity types and interaction types
	registerCoreTypes();
}

// ── Registry Integration ────────────────────────────────────────

function registerCoreTypes(): void {
	// Core interaction types
	const coreInteractionTypes = [
		{ name: "call", label: "Phone Call", icon: "📞" },
		{ name: "meeting", label: "Meeting", icon: "🤝" },
		{ name: "email", label: "Email", icon: "📧" },
		{ name: "note", label: "Note", icon: "📝" },
		{ name: "gift", label: "Gift", icon: "🎁" },
		{ name: "message", label: "Message", icon: "💬" },
	];

	for (const type of coreInteractionTypes) {
		crmRegistry.registerInteractionType(type);
	}
}

// ── Smart Search ────────────────────────────────────────────────

/**
 * Search contacts with smart name matching.
 *
 * Step 1: Split query into terms, match ALL terms against first_name OR last_name.
 *   "John Smith" → each of ["John","Smith"] must appear in first_name or last_name.
 *   This handles "John Smith", "Smith John", "John Michael Smith", etc.
 *
 * Step 2 (fallback): If no results and query contains a comma, try "Last, First" format.
 *   "Smith, John" → last_name LIKE "%Smith%" AND first_name LIKE "%John%"
 *
 * Also searches email, phone, nickname, tags, company_name as a simple LIKE fallback.
 */
function searchContactsSmart(query: string, limit: number): Contact[] {
	const trimmed = query.trim();
	if (!trimmed) return [];

	const terms = trimmed.split(/\s+/).filter(t => t.length > 0);

	// Step 1: All terms must match against first_name or last_name
	if (terms.length > 1) {
		const conditions = terms.map((_t, i) =>
			`(LOWER(c.first_name) LIKE LOWER(@term${i}) OR LOWER(COALESCE(c.last_name, '')) LIKE LOWER(@term${i}))`
		).join(" AND ");

		const sql = `
			SELECT c.*, co.name as company_name
			FROM crm_contacts c
			LEFT JOIN crm_companies co ON c.company_id = co.id
			WHERE ${conditions}
			ORDER BY c.first_name, c.last_name
			LIMIT @limit
		`;

		const params: Record<string, string | number> = { limit };
		for (let i = 0; i < terms.length; i++) {
			params[`term${i}`] = `%${terms[i]}%`;
		}

		const results: Contact[] = db.prepare(sql).all(params) as Contact[];
		if (results.length > 0) return results;

		// Step 2: Comma fallback — "Last, First"
		if (trimmed.includes(",")) {
			const [lastName, ...firstParts] = trimmed.split(",").map(s => s.trim());
			const firstName = firstParts.join(" ").trim();
			if (lastName && firstName) {
				const commaSql = `
					SELECT c.*, co.name as company_name
					FROM crm_contacts c
					LEFT JOIN crm_companies co ON c.company_id = co.id
					WHERE LOWER(COALESCE(c.last_name, '')) LIKE LOWER(@last)
					  AND LOWER(c.first_name) LIKE LOWER(@first)
					ORDER BY c.first_name, c.last_name
					LIMIT @limit
				`;
				const commaResults: Contact[] = db.prepare(commaSql).all({
					last: `%${lastName}%`,
					first: `%${firstName}%`,
					limit,
				}) as Contact[];
				if (commaResults.length > 0) return commaResults;
			}
		}
	}

	// Step 3: original single-pattern LIKE across all fields
	const pattern = `%${trimmed}%`;
	const likeResults: Contact[] = stmts.searchContacts.all(pattern, pattern, pattern, pattern, pattern, pattern, limit);
	if (likeResults.length > 0) return likeResults;

	// Step 4: Fuzzy search — levenshtein distance on name terms
	return searchContactsFuzzy(terms, limit);
}

/**
 * Fuzzy fallback: find contacts where name terms are within edit distance.
 * Threshold scales with term length: max(2, floor(term.length / 3)).
 */
function searchContactsFuzzy(terms: string[], limit: number): Contact[] {
	// Score every contact by best combined distance across terms
	const all: Contact[] = db.prepare(`
		SELECT c.*, co.name as company_name
		FROM crm_contacts c
		LEFT JOIN crm_companies co ON c.company_id = co.id
		ORDER BY c.first_name, c.last_name
	`).all() as Contact[];

	const scored: { contact: Contact; score: number }[] = [];

	for (const c of all) {
		const first = (c.first_name ?? "").toLowerCase();
		const last = (c.last_name ?? "").toLowerCase();
		const full = `${first} ${last}`.trim();
		const nick = (c.nickname ?? "").toLowerCase();

		let totalScore = 0;
		let allMatch = true;

		for (const term of terms) {
			const t = term.toLowerCase();
			const threshold = Math.max(2, Math.floor(t.length / 3));

			// Best distance across name fields and substrings
			const distances = [
				levenshtein(t, first),
				levenshtein(t, last),
				levenshtein(t, nick),
			];

			// Also check against individual words in first_name (for middle names)
			for (const word of first.split(/\s+/)) {
				distances.push(levenshtein(t, word));
			}

			const best = Math.min(...distances);
			if (best > threshold) {
				allMatch = false;
				break;
			}
			totalScore += best;
		}

		if (allMatch) {
			scored.push({ contact: c, score: totalScore });
		}
	}

	scored.sort((a, b) => a.score - b.score);
	return scored.slice(0, limit).map(s => s.contact);
}

// ── CRM API Implementation ──────────────────────────────────────

/**
 * Main CRM API singleton.
 */
export const crmApi: CrmApi = {
	// ── Contacts ────────────────────────────────────────────────

	getContacts(search?: string, limit: number = 100): Contact[] {
		if (search) {
			return searchContactsSmart(search, limit);
		}
		return stmts.getContacts.all(limit);
	},

	getContact(id: number): Contact | null {
		return stmts.getContactById.get(id) ?? null;
	},

	getContactsByCompany(companyId: number): Contact[] {
		return stmts.getContactsByCompany.all(companyId);
	},

	createContact(data: CreateContactData): Contact {
		const result = stmts.insertContact.run(
			data.first_name,
			data.last_name ?? null,
			data.nickname ?? null,
			data.email ?? null,
			data.phone ?? null,
			data.company_id ?? null,
			data.birthday ?? null,
			data.anniversary ?? null,
			data.notes ?? null,
			data.avatar_url ?? null,
			data.tags ?? null,
			data.custom_fields ?? null,
		);

		const contact = this.getContact(result.lastInsertRowid as number)!;

		// Emit event
		crmRegistry.emit("contact.created", contact).catch((err) => {
			console.error("Failed to emit contact.created event:", err);
		});

		return contact;
	},

	updateContact(id: number, data: UpdateContactData): Contact | null {
		const existing = this.getContact(id);
		if (!existing) return null;

		stmts.updateContact.run(
			data.first_name ?? existing.first_name,
			data.last_name ?? existing.last_name,
			data.nickname ?? existing.nickname,
			data.email ?? existing.email,
			data.phone ?? existing.phone,
			data.company_id !== undefined ? data.company_id : existing.company_id,
			data.birthday !== undefined ? data.birthday : existing.birthday,
			data.anniversary !== undefined ? data.anniversary : existing.anniversary,
			data.notes !== undefined ? data.notes : existing.notes,
			data.avatar_url !== undefined ? data.avatar_url : existing.avatar_url,
			data.tags !== undefined ? data.tags : existing.tags,
			data.custom_fields !== undefined ? data.custom_fields : existing.custom_fields,
			id,
		);

		const updated = this.getContact(id)!;

		// Emit event
		crmRegistry.emit("contact.updated", updated).catch((err) => {
			console.error("Failed to emit contact.updated event:", err);
		});

		return updated;
	},

	deleteContact(id: number): boolean {
		const contact = this.getContact(id);
		if (!contact) return false;

		stmts.deleteContact.run(id);

		// Emit event
		crmRegistry.emit("contact.deleted", { id, contact }).catch((err) => {
			console.error("Failed to emit contact.deleted event:", err);
		});

		return true;
	},

	// ── Companies ───────────────────────────────────────────────

	getCompanies(search?: string): Company[] {
		if (search) {
			const pattern = `%${search}%`;
			return stmts.searchCompanies.all(pattern, pattern, pattern, 100);
		}
		return stmts.getCompanies.all();
	},

	getCompany(id: number): Company | null {
		return stmts.getCompanyById.get(id) ?? null;
	},

	createCompany(data: CreateCompanyData): Company {
		const result = stmts.insertCompany.run(
			data.name,
			data.website ?? null,
			data.industry ?? null,
			data.notes ?? null,
		);
		return this.getCompany(result.lastInsertRowid as number)!;
	},

	updateCompany(id: number, data: UpdateCompanyData): Company | null {
		const existing = this.getCompany(id);
		if (!existing) return null;

		stmts.updateCompany.run(
			data.name ?? existing.name,
			data.website !== undefined ? data.website : existing.website,
			data.industry !== undefined ? data.industry : existing.industry,
			data.notes !== undefined ? data.notes : existing.notes,
			id,
		);

		return this.getCompany(id);
	},

	deleteCompany(id: number): boolean {
		const result = stmts.deleteCompany.run(id);
		return result.changes > 0;
	},

	// ── Interactions ────────────────────────────────────────────

	getInteractions(contactId: number): Interaction[] {
		return stmts.getInteractions.all(contactId);
	},

	getAllInteractions(): Interaction[] {
		return stmts.getAllInteractions.all();
	},

	createInteraction(data: CreateInteractionData): Interaction {
		const happened_at = data.happened_at ?? new Date().toISOString();

		const result = stmts.insertInteraction.run(
			data.contact_id,
			data.interaction_type,
			data.summary,
			data.notes ?? null,
			happened_at,
		);

		const interaction = stmts.getInteractions
			.all(data.contact_id)
			.find((i: Interaction) => i.id === result.lastInsertRowid);

		// Emit event
		crmRegistry.emit("interaction.logged", interaction).catch((err) => {
			console.error("Failed to emit interaction.logged event:", err);
		});

		return interaction;
	},

	deleteInteraction(id: number): boolean {
		const result = stmts.deleteInteraction.run(id);
		return result.changes > 0;
	},

	// ── Reminders ───────────────────────────────────────────────

	getReminders(contactId?: number): Reminder[] {
		if (contactId) {
			return stmts.getRemindersByContact.all(contactId);
		}
		return stmts.getReminders.all();
	},

	getAllReminders(): Reminder[] {
		return stmts.getAllReminders.all();
	},

	getUpcomingReminders(days: number = 7): Reminder[] {
		return stmts.getUpcomingReminders.all(days);
	},

	createReminder(data: CreateReminderData): Reminder {
		const result = stmts.insertReminder.run(
			data.contact_id,
			data.reminder_type,
			data.reminder_date,
			data.message ?? null,
		);

		return stmts.getRemindersByContact
			.all(data.contact_id)
			.find((r: Reminder) => r.id === result.lastInsertRowid);
	},

	deleteReminder(id: number): boolean {
		const result = stmts.deleteReminder.run(id);
		return result.changes > 0;
	},

	// ── Relationships ───────────────────────────────────────────

	getRelationships(contactId: number): Relationship[] {
		return stmts.getRelationships.all(contactId);
	},

	createRelationship(data: CreateRelationshipData): Relationship {
		const result = stmts.insertRelationship.run(
			data.contact_id,
			data.related_contact_id,
			data.relationship_type,
			data.notes ?? null,
		);

		return stmts.getRelationships
			.all(data.contact_id)
			.find((r: Relationship) => r.id === result.lastInsertRowid);
	},

	deleteRelationship(id: number): boolean {
		const result = stmts.deleteRelationship.run(id);
		return result.changes > 0;
	},

	// ── Groups ──────────────────────────────────────────────────

	getGroups(): Group[] {
		return stmts.getGroups.all();
	},

	createGroup(data: CreateGroupData): Group {
		const result = stmts.insertGroup.run(data.name, data.description ?? null);
		return stmts.getGroups.all().find((g: Group) => g.id === result.lastInsertRowid)!;
	},

	deleteGroup(id: number): boolean {
		const result = stmts.deleteGroup.run(id);
		return result.changes > 0;
	},

	// ── Group Membership ────────────────────────────────────────

	getGroupMembers(groupId: number): Contact[] {
		return stmts.getGroupMembers.all(groupId);
	},

	getContactGroups(contactId: number): Group[] {
		return stmts.getContactGroups.all(contactId);
	},

	addGroupMember(groupId: number, contactId: number): boolean {
		const result = stmts.addGroupMember.run(groupId, contactId);
		return result.changes > 0;
	},

	removeGroupMember(groupId: number, contactId: number): boolean {
		const result = stmts.removeGroupMember.run(groupId, contactId);
		return result.changes > 0;
	},

	// ── Extension Fields ────────────────────────────────────────

	getExtensionFields(contactId: number): ExtensionField[] {
		return stmts.getExtensionFields.all(contactId);
	},

	getExtensionFieldsBySource(contactId: number, source: string): ExtensionField[] {
		return stmts.getExtensionFieldsBySource.all(contactId, source);
	},

	setExtensionField(data: SetExtensionFieldData): ExtensionField {
		const ft = data.field_type ?? "text";
		if (!VALID_EXTENSION_FIELD_TYPES.includes(ft)) {
			throw new Error(`Invalid field_type "${ft}" — must be one of: ${VALID_EXTENSION_FIELD_TYPES.join(", ")}`);
		}
		stmts.upsertExtensionField.run(
			data.contact_id,
			data.source,
			data.field_name,
			data.field_value,
			data.label ?? null,
			ft,
		);
		// Always look up by unique key — lastInsertRowid is unreliable on upsert-update
		const fields = this.getExtensionFieldsBySource(data.contact_id, data.source);
		return fields.find(f => f.field_name === data.field_name)!;
	},

	deleteExtensionFields(contactId: number, source: string): number {
		const result = stmts.deleteExtensionFields.run(contactId, source);
		return result.changes;
	},

	// ── Extension Fields (Companies) ────────────────────────────

	getCompanyExtensionFields(companyId: number): ExtensionField[] {
		return stmts.getCompanyExtensionFields.all(companyId);
	},

	getCompanyExtensionFieldsBySource(companyId: number, source: string): ExtensionField[] {
		return stmts.getCompanyExtensionFieldsBySource.all(companyId, source);
	},

	setCompanyExtensionField(data: SetCompanyExtensionFieldData): ExtensionField {
		const ft = data.field_type ?? "text";
		if (!VALID_EXTENSION_FIELD_TYPES.includes(ft)) {
			throw new Error(`Invalid field_type "${ft}" — must be one of: ${VALID_EXTENSION_FIELD_TYPES.join(", ")}`);
		}
		stmts.upsertCompanyExtensionField.run(
			data.company_id,
			data.source,
			data.field_name,
			data.field_value,
			data.label ?? null,
			ft,
		);
		const fields = this.getCompanyExtensionFieldsBySource(data.company_id, data.source);
		return fields.find(f => f.field_name === data.field_name)!;
	},

	deleteCompanyExtensionFields(companyId: number, source: string): number {
		const result = stmts.deleteCompanyExtensionFields.run(companyId, source);
		return result.changes;
	},

	// ── Search ──────────────────────────────────────────────────

	searchContacts(query: string, limit: number = 20): Contact[] {
		return this.getContacts(query, limit);
	},

	searchCompanies(query: string, limit: number = 20): Company[] {
		return this.getCompanies(query).slice(0, limit);
	},

	// ── Duplicate Detection ─────────────────────────────────────

	findDuplicates(data: { email?: string; first_name: string; last_name?: string }): Contact[] {
		const found = new Map<number, Contact>();

		// Check by email (strongest signal)
		if (data.email) {
			const byEmail: Contact[] = stmts.findDuplicatesByEmail.all(data.email);
			for (const c of byEmail) found.set(c.id, c);
		}

		// Check by name
		const byName: Contact[] = stmts.findDuplicatesByName.all(
			data.first_name,
			data.last_name ?? "",
		);
		for (const c of byName) found.set(c.id, c);

		return [...found.values()];
	},

	// ── CSV Export ───────────────────────────────────────────────

	exportContactsCsv(): string {
		const contacts = this.getContacts(undefined, 100_000);
		const headers = [
			"first_name", "last_name", "email", "phone",
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

		const rows = [headers.join(",")];
		for (const c of contacts) {
			rows.push([
				escCsv(c.first_name),
				escCsv(c.last_name),
				escCsv(c.email),
				escCsv(c.phone),
				escCsv(c.company_name),
				escCsv(c.birthday),
				escCsv(c.anniversary),
				escCsv(c.tags),
				escCsv(c.notes),
			].join(","));
		}

		return rows.join("\n");
	},

	// ── CSV Import ──────────────────────────────────────────────

	importContactsCsv(csv: string): ImportResult {
		const result: ImportResult = { created: 0, skipped: 0, errors: [], duplicates: [] };

		const lines = parseCsvLines(csv);
		if (lines.length < 2) {
			result.errors.push("CSV must have a header row and at least one data row");
			return result;
		}

		const headers = lines[0].map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
		const fieldMap: Record<string, string> = {
			"first_name": "first_name", "firstname": "first_name", "first": "first_name",
			"last_name": "last_name", "lastname": "last_name", "last": "last_name", "surname": "last_name",
			"email": "email", "email_address": "email", "e-mail": "email",
			"phone": "phone", "phone_number": "phone", "telephone": "phone", "mobile": "phone",
			"company": "company_name", "company_name": "company_name", "organization": "company_name", "org": "company_name",
			"birthday": "birthday", "date_of_birth": "birthday", "dob": "birthday", "birth_date": "birthday",
			"anniversary": "anniversary",
			"tags": "tags", "labels": "tags", "categories": "tags",
			"notes": "notes", "note": "notes", "description": "notes",
			"nickname": "nickname", "nick": "nickname",
		};

		// Map header indices to contact fields
		const colMap: { index: number; field: string }[] = [];
		for (let i = 0; i < headers.length; i++) {
			const mapped = fieldMap[headers[i]];
			if (mapped) colMap.push({ index: i, field: mapped });
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
					row[field] = cols[index].trim();
				}
			}

			if (!row.first_name) {
				result.errors.push(`Row ${rowIdx + 1}: missing first_name, skipped`);
				result.skipped++;
				continue;
			}

			// Duplicate check
			const dupes = this.findDuplicates({
				email: row.email,
				first_name: row.first_name,
				last_name: row.last_name,
			});

			if (dupes.length > 0) {
				const label = `${row.first_name} ${row.last_name || ""}`.trim();
				result.duplicates.push({ row: rowIdx + 1, existing: dupes[0], incoming: label });
				result.skipped++;
				continue;
			}

			// Resolve company
			let company_id: number | undefined;
			if (row.company_name) {
				const companies = this.getCompanies(row.company_name);
				const exact = companies.find(c => c.name.toLowerCase() === row.company_name!.toLowerCase());
				if (exact) {
					company_id = exact.id;
				} else {
					const newCo = this.createCompany({ name: row.company_name });
					company_id = newCo.id;
				}
			}

			try {
				this.createContact({
					first_name: row.first_name,
					last_name: row.last_name,
					nickname: row.nickname,
					email: row.email,
					phone: row.phone,
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
	},
};

// ── CSV Parser ──────────────────────────────────────────────────

/**
 * Parse CSV text into rows of columns, handling quoted fields.
 */
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
					i++; // skip escaped quote
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
				// skip, handle \r\n
			} else {
				field += ch;
			}
		}
	}

	// Last field/row
	current.push(field);
	if (current.length > 0 && !(current.length === 1 && current[0] === "")) {
		rows.push(current);
	}

	return rows;
}

// ── Levenshtein Distance ────────────────────────────────────────

/**
 * Classic Levenshtein edit distance. O(n*m) time, O(min(n,m)) space.
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
				prev[i] + 1,      // deletion
				curr[i - 1] + 1,  // insertion
				prev[i - 1] + cost, // substitution
			);
		}
		[prev, curr] = [curr, prev];
	}

	return prev[aLen];
}
