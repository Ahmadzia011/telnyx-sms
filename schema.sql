-- Run this once in the Neon SQL Editor.
-- Conversations are derived from messages (one per contact number).

CREATE TABLE IF NOT EXISTS messages (
  id          BIGSERIAL PRIMARY KEY,
  telnyx_id   TEXT UNIQUE,
  contact     TEXT NOT NULL,                       -- the other party, E.164
  direction   TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'received',    -- received | queued | sent | delivered | failed
  error       TEXT,
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_contact_created_idx
  ON messages (contact, created_at);
