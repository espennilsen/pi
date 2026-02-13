-- pi-personal-crm initial schema
-- Applied via kysely:migration:apply (actor: pi-personal-crm)
-- Matches the SCHEMA constant in db-kysely.ts

-- Companies (referenced by contacts)
CREATE TABLE IF NOT EXISTS crm_companies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  website    TEXT,
  industry   TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Contacts
CREATE TABLE IF NOT EXISTS crm_contacts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name    TEXT NOT NULL,
  last_name     TEXT,
  nickname      TEXT,
  email         TEXT,
  phone         TEXT,
  company_id    INTEGER REFERENCES crm_companies(id) ON DELETE SET NULL,
  birthday      TEXT,
  anniversary   TEXT,
  notes         TEXT,
  avatar_url    TEXT,
  tags          TEXT,
  custom_fields TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_company ON crm_contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON crm_contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_tags ON crm_contacts(tags);

-- Interactions (timeline)
CREATE TABLE IF NOT EXISTS crm_interactions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id       INTEGER NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  interaction_type TEXT NOT NULL,
  summary          TEXT NOT NULL,
  notes            TEXT,
  happened_at      TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_interactions_contact ON crm_interactions(contact_id);
CREATE INDEX IF NOT EXISTS idx_interactions_happened ON crm_interactions(happened_at);

-- Reminders
CREATE TABLE IF NOT EXISTS crm_reminders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id    INTEGER NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL,
  reminder_date TEXT NOT NULL,
  message       TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_contact ON crm_reminders(contact_id);
CREATE INDEX IF NOT EXISTS idx_reminders_date ON crm_reminders(reminder_date);

-- Relationships
CREATE TABLE IF NOT EXISTS crm_relationships (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id         INTEGER NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  related_contact_id INTEGER NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  relationship_type  TEXT NOT NULL,
  notes              TEXT,
  created_at         TEXT NOT NULL,
  UNIQUE(contact_id, related_contact_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_relationships_contact ON crm_relationships(contact_id);
CREATE INDEX IF NOT EXISTS idx_relationships_related ON crm_relationships(related_contact_id);

-- Groups
CREATE TABLE IF NOT EXISTS crm_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TEXT NOT NULL
);

-- Group membership
CREATE TABLE IF NOT EXISTS crm_group_members (
  group_id   INTEGER NOT NULL REFERENCES crm_groups(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  added_at   TEXT NOT NULL,
  PRIMARY KEY (group_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_group ON crm_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_contact ON crm_group_members(contact_id);

-- Extension fields (third-party data for contacts)
CREATE TABLE IF NOT EXISTS crm_extension_fields (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id  INTEGER NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  field_name  TEXT NOT NULL,
  field_value TEXT NOT NULL,
  label       TEXT,
  field_type  TEXT NOT NULL DEFAULT 'text',
  updated_at  TEXT NOT NULL,
  UNIQUE(contact_id, source, field_name)
);

CREATE INDEX IF NOT EXISTS idx_ext_fields_contact ON crm_extension_fields(contact_id);
CREATE INDEX IF NOT EXISTS idx_ext_fields_source ON crm_extension_fields(source);

-- Extension fields (third-party data for companies)
CREATE TABLE IF NOT EXISTS crm_company_extension_fields (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  field_name  TEXT NOT NULL,
  field_value TEXT NOT NULL,
  label       TEXT,
  field_type  TEXT NOT NULL DEFAULT 'text',
  updated_at  TEXT NOT NULL,
  UNIQUE(company_id, source, field_name)
);

CREATE INDEX IF NOT EXISTS idx_co_ext_fields_company ON crm_company_extension_fields(company_id);
CREATE INDEX IF NOT EXISTS idx_co_ext_fields_source ON crm_company_extension_fields(source);
