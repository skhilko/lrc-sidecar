import type { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 1;

export function migrate(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
      ) STRICT;
      INSERT INTO schema_version(version)
        SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
    `);
    const row = database.prepare("SELECT version FROM schema_version").get() as { version?: unknown } | undefined;
    const version = row?.version;
    if (typeof version !== "number" || !Number.isInteger(version)) throw new Error("invalid schema version");
    if (version > SCHEMA_VERSION) throw new Error(`state schema ${version} is newer than supported schema ${SCHEMA_VERSION}`);
    if (version < 1) {
      database.exec(`
        CREATE TABLE app_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT;

        CREATE TABLE track_state (
          audio_path TEXT PRIMARY KEY,
          root_path TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          modified_at_ms REAL NOT NULL,
          metadata_hash TEXT NOT NULL,
          title TEXT,
          primary_artist TEXT,
          album TEXT,
          duration_seconds REAL,
          status TEXT NOT NULL,
          provider TEXT,
          provider_record_id INTEGER,
          match_score REAL,
          lyrics_kind TEXT,
          output_path TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          first_seen_at_ms INTEGER NOT NULL,
          last_checked_at_ms INTEGER,
          retry_after_ms INTEGER,
          completed_at_ms INTEGER,
          last_error_code TEXT,
          last_error_message TEXT,
          app_version TEXT NOT NULL
        ) STRICT;

        CREATE INDEX track_state_status_idx ON track_state(status);
        CREATE INDEX track_state_retry_idx ON track_state(retry_after_ms);

        CREATE TABLE lookup_attempt (
          id INTEGER PRIMARY KEY,
          audio_path TEXT NOT NULL,
          started_at_ms INTEGER NOT NULL,
          completed_at_ms INTEGER NOT NULL,
          provider TEXT NOT NULL,
          operation TEXT NOT NULL,
          outcome TEXT NOT NULL,
          http_status INTEGER,
          candidate_count INTEGER,
          selected_record_id INTEGER,
          selected_score REAL,
          error_code TEXT,
          error_message TEXT
        ) STRICT;
        CREATE INDEX lookup_attempt_audio_idx ON lookup_attempt(audio_path, started_at_ms);
        UPDATE schema_version SET version = 1;
      `);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
