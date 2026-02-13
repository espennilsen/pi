-- pi-jobs initial schema
-- Applied via kysely:migration:apply (actor: pi-jobs)
-- Matches the SCHEMA constant in db-kysely.ts

CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  channel         TEXT NOT NULL DEFAULT 'tui',
  status          TEXT NOT NULL DEFAULT 'pending',
  prompt          TEXT NOT NULL,
  response        TEXT,
  model           TEXT,
  provider        TEXT,
  input_tokens      INTEGER NOT NULL DEFAULT 0,
  output_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  cost_input       REAL NOT NULL DEFAULT 0,
  cost_output      REAL NOT NULL DEFAULT 0,
  cost_cache_read  REAL NOT NULL DEFAULT 0,
  cost_cache_write REAL NOT NULL DEFAULT 0,
  cost_total       REAL NOT NULL DEFAULT 0,
  tool_call_count  INTEGER NOT NULL DEFAULT 0,
  turn_count       INTEGER NOT NULL DEFAULT 0,
  error_message    TEXT,
  duration_ms      INTEGER,
  created_at       TEXT NOT NULL,
  finished_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_channel    ON jobs(channel);
CREATE INDEX IF NOT EXISTS idx_jobs_status     ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_model      ON jobs(model);

CREATE TABLE IF NOT EXISTS tool_calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tool_name     TEXT NOT NULL,
  args_json     TEXT,
  result_preview TEXT,
  is_error      INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_job  ON tool_calls(job_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);

CREATE TABLE IF NOT EXISTS daily_stats (
  date          TEXT NOT NULL,
  channel       TEXT NOT NULL,
  model         TEXT NOT NULL DEFAULT '',
  job_count     INTEGER NOT NULL DEFAULT 0,
  error_count   INTEGER NOT NULL DEFAULT 0,
  total_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_total    REAL NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, channel, model)
);
