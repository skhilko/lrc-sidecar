import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FatalError } from "../domain/errors.js";
import { migrate, SCHEMA_VERSION } from "./migrations.js";

export interface StateDatabase { database: DatabaseSync; close(): void; schemaVersion: number }

export async function openStateDatabaseReadOnly(path: string): Promise<StateDatabase> {
  try {
    const database = new DatabaseSync(path, { readOnly: true, allowExtension: false, timeout: 5_000 });
    database.enableLoadExtension(false);
    database.enableDefensive(true);
    const row = database.prepare("SELECT version FROM schema_version").get() as { version?: unknown } | undefined;
    if (typeof row?.version !== "number" || row.version !== SCHEMA_VERSION) throw new Error(`unsupported schema version ${String(row?.version)}`);
    return { database, schemaVersion: row.version, close: () => database.close() };
  } catch (error) {
    throw new FatalError(`cannot open state database ${path}: ${error instanceof Error ? error.message : String(error)}`, 3, { cause: error });
  }
}

export async function openStateDatabase(path: string, createDirectory = true): Promise<StateDatabase> {
  try {
    if (createDirectory) await mkdir(dirname(path), { recursive: true, mode: 0o750 });
    const database = new DatabaseSync(path, { allowExtension: false, timeout: 5_000 });
    database.enableLoadExtension(false);
    database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    migrate(database);
    database.enableDefensive(true);
    return { database, schemaVersion: SCHEMA_VERSION, close: () => database.close() };
  } catch (error) {
    throw new FatalError(`cannot initialize state database ${path}: ${error instanceof Error ? error.message : String(error)}`, 3, { cause: error });
  }
}
