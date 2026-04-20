import { createRequire } from "node:module";
import { dirname } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import initSqlJs from "sql.js";
import type { Database, QueryExecResult, SqlJsStatic } from "sql.js";
import type { SessionRecord } from "./types.js";

const require = createRequire(import.meta.url);

const schemaSql = `
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model_id TEXT NOT NULL,
    cwd TEXT NOT NULL,
    transcript_path TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const extractRows = (result: QueryExecResult[] | undefined): SessionRecord[] => {
  const rows = result?.[0];

  if (!rows) {
    return [];
  }

  return rows.values.map((valueRow: Array<string | number | null>) => ({
    sessionId: String(valueRow[0]),
    title: String(valueRow[1]),
    modelId: String(valueRow[2]),
    cwd: String(valueRow[3]),
    transcriptPath: String(valueRow[4]),
    status: valueRow[5] as SessionRecord["status"],
    createdAt: String(valueRow[6]),
    updatedAt: String(valueRow[7])
  }));
};

export class SessionIndex {
  private constructor(
    private readonly SQL: SqlJsStatic,
    private readonly database: Database,
    private readonly databasePath: string
  ) {}

  public static async open(databasePath: string): Promise<SessionIndex> {
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    const SQL = await initSqlJs({
      locateFile: () => wasmPath
    });

    let database: Database;

    try {
      const file = await readFile(databasePath);
      database = new SQL.Database(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      database = new SQL.Database();
    }

    database.run(schemaSql);

    return new SessionIndex(SQL, database, databasePath);
  }

  public async upsert(record: SessionRecord): Promise<void> {
    this.database.run(
      `
        INSERT INTO sessions (
          session_id, title, model_id, cwd, transcript_path, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          title = excluded.title,
          model_id = excluded.model_id,
          cwd = excluded.cwd,
          transcript_path = excluded.transcript_path,
          status = excluded.status,
          updated_at = excluded.updated_at
      `,
      [
        record.sessionId,
        record.title,
        record.modelId,
        record.cwd,
        record.transcriptPath,
        record.status,
        record.createdAt,
        record.updatedAt
      ]
    );

    await this.persist();
  }

  public get(sessionId: string): SessionRecord | null {
    const rows = extractRows(
      this.database.exec(
        `SELECT session_id, title, model_id, cwd, transcript_path, status, created_at, updated_at
         FROM sessions WHERE session_id = ?`,
        [sessionId]
      )
    );

    return rows[0] ?? null;
  }

  public list(limit = 20): SessionRecord[] {
    const rows = extractRows(
      this.database.exec(
        `SELECT session_id, title, model_id, cwd, transcript_path, status, created_at, updated_at
         FROM sessions ORDER BY updated_at DESC LIMIT ?`,
        [limit]
      )
    );

    return rows;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.databasePath), { recursive: true });
    const payload = Buffer.from(this.database.export());
    await writeFile(this.databasePath, payload);
  }
}
