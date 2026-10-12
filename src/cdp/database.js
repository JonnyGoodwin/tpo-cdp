import { DatabaseSync } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import { attachDatabasePool } from "@vercel/functions";

const schema = `
  CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,email TEXT,name TEXT,created_at TEXT,traits TEXT);
  CREATE TABLE IF NOT EXISTS identities(kind TEXT,value TEXT,person_id TEXT REFERENCES people(id),PRIMARY KEY(kind,value));
  CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,person_id TEXT REFERENCES people(id),source TEXT,name TEXT,timestamp TEXT,properties TEXT);
  CREATE INDEX IF NOT EXISTS events_person ON events(person_id);
  CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,source TEXT,filename TEXT,type TEXT,created_at TEXT,mapping TEXT,result TEXT);
  CREATE TABLE IF NOT EXISTS segments(id TEXT PRIMARY KEY,name TEXT,definition TEXT);
  CREATE TABLE IF NOT EXISTS assistant_reports(id TEXT PRIMARY KEY,plan TEXT,definition TEXT,expires TEXT);
`;

// Keep SQLite for offline development; hosted deployments use Postgres.
export class Database {
  constructor(path = ":memory:") {
    this.postgres = /^postgres(?:ql)?:\/\//.test(path);
    this.sessions = new AsyncLocalStorage();
    if (this.postgres) {
      this.pool = new pg.Pool({
        connectionString: path,
        max: 5,
        connectionTimeoutMillis: 15000,
        idleTimeoutMillis: 10000,
        statement_timeout: 30000,
        idle_in_transaction_session_timeout: 30000,
      });
      if (process.env.VERCEL) attachDatabasePool(this.pool);
      this.pool.on("error", (error) =>
        console.error("Postgres:", error.message),
      );
      this.db = {
        exec: (sql) => this.query(sql),
        close: () => this.pool.end(),
      };
    } else {
      this.db = new DatabaseSync(path);
      this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;");
    }
  }
  async initialize() {
    await this.db.exec(schema);
  }
  async withSession(work) {
    if (!this.postgres || this.sessions.getStore()) return work();
    const client = await this.pool.connect();
    try {
      // Serialize workspace mutations across Vercel instances, including identity merges.
      await client.query("SELECT pg_advisory_lock(8675309)");
      return await this.sessions.run(client, work);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.query("SELECT pg_advisory_unlock(8675309)").catch(() => {});
      client.release();
    }
  }
  async query(sql, args = []) {
    let index = 0;
    sql = sql
      .replace(/\?/g, () => `$${++index}`)
      .replace(/\browid\b/g, "queued_order");
    if (/INSERT OR IGNORE/i.test(sql))
      sql =
        sql.replace(/INSERT OR IGNORE/i, "INSERT") + " ON CONFLICT DO NOTHING";
    return (this.sessions.getStore() || this.pool).query(sql, args);
  }
  async all(sql, ...args) {
    if (!this.postgres) return this.db.prepare(sql).all(...args);
    const result = await this.query(sql, args);
    const integers = new Set(
      result.fields
        .filter((field) => field.dataTypeID === 20)
        .map((field) => field.name),
    );
    return result.rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          integers.has(key) && value !== null ? Number(value) : value,
        ]),
      ),
    );
  }
  async get(sql, ...args) {
    return (await this.all(sql, ...args))[0];
  }
  async run(sql, ...args) {
    if (!this.postgres) return this.db.prepare(sql).run(...args);
    return { changes: (await this.query(sql, args)).rowCount };
  }
}
