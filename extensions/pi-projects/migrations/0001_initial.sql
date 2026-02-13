-- pi-projects initial schema
-- Applied via kysely:migration:apply (actor: pi-projects)
-- Matches the SCHEMA constant in db-kysely.ts

CREATE TABLE IF NOT EXISTS project_sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  path        TEXT NOT NULL UNIQUE,
  label       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_hidden (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_path TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL
);
