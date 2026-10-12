import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { CDP } from "../src/cdp/index.js";

const connection =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;
if (!connection)
  throw new Error("Set DATABASE_URL to the destination Postgres database");
const source = new DatabaseSync(
  resolve(process.env.SQLITE_SOURCE || "data/cdp.sqlite"),
  { readOnly: true },
);
const target = await CDP.open(connection);
const tables = [
  "people",
  "identities",
  "events",
  "imports",
  "segments",
  "connections",
  "connection_members",
  "connection_runs",
  "assistant_reports",
];
try {
  await target.withSession(async () => {
    for (const table of tables)
      if ((await target.get(`SELECT count(*) AS n FROM ${table}`)).n)
        throw new Error(
          "Destination must be empty; refusing to overwrite existing data",
        );
    source.exec("BEGIN");
    await target.db.exec("BEGIN");
    try {
      const counts = {};
      for (const table of tables) {
        const columns = source
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((column) => column.name);
        if (!columns.length) continue;
        const rows = source
          .prepare(
            `SELECT * FROM ${table}${table === "connection_runs" ? " ORDER BY rowid" : ""}`,
          )
          .all();
        for (let offset = 0; offset < rows.length; offset += 500) {
          const batch = rows.slice(offset, offset + 500);
          const placeholders = batch
            .map(() => `(${columns.map(() => "?").join(",")})`)
            .join(",");
          await target.run(
            `INSERT INTO ${table}(${columns.join(",")}) VALUES ${placeholders}`,
            ...batch.flatMap((row) => columns.map((column) => row[column])),
          );
        }
        const actual = (await target.get(`SELECT count(*) AS n FROM ${table}`))
          .n;
        if (actual !== rows.length)
          throw new Error(`Row count mismatch: ${table}`);
        counts[table] = actual;
      }
      await target.db.exec("COMMIT");
      source.exec("COMMIT");
      console.log("Migrated and verified:", counts);
    } catch (error) {
      await target.db.exec("ROLLBACK");
      source.exec("ROLLBACK");
      throw error;
    }
  });
} finally {
  source.close();
  await target.db.close();
}
