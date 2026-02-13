-- pi-calendar initial schema
-- Applied via kysely:migration:apply (actor: pi-calendar)
-- Matches the SCHEMA constant in db-kysely.ts

CREATE TABLE IF NOT EXISTS calendar_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  description     TEXT,
  start_time      TEXT NOT NULL,
  end_time        TEXT NOT NULL,
  all_day         INTEGER NOT NULL DEFAULT 0,
  color           TEXT,
  recurrence      TEXT,
  recurrence_rule TEXT,
  recurrence_end  TEXT,
  reminder_minutes INTEGER,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cal_events_start ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_cal_events_end ON calendar_events(end_time);

CREATE TABLE IF NOT EXISTS calendar_reminders_sent (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL,
  event_time TEXT NOT NULL,
  sent_at    TEXT NOT NULL,
  UNIQUE(event_id, event_time)
);

CREATE INDEX IF NOT EXISTS idx_cal_reminders_event ON calendar_reminders_sent(event_id, event_time);
