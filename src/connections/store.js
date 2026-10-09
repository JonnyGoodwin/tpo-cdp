import { randomUUID } from "node:crypto";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
export function initialize(cdp) {
  cdp.db.exec(`
    CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,name TEXT,segment_id TEXT REFERENCES segments(id),code TEXT,settings TEXT,enabled INTEGER,created_at TEXT);
    CREATE TABLE IF NOT EXISTS connection_members(connection_id TEXT REFERENCES connections(id) ON DELETE CASCADE,person_id TEXT,PRIMARY KEY(connection_id,person_id));
    CREATE TABLE IF NOT EXISTS connection_runs(id TEXT PRIMARY KEY,connection_id TEXT REFERENCES connections(id) ON DELETE CASCADE,person_id TEXT,trigger TEXT,status TEXT,payload TEXT,code TEXT,settings TEXT,result TEXT,error TEXT,created_at TEXT,finished_at TEXT);
    CREATE INDEX IF NOT EXISTS connection_runs_status ON connection_runs(status,created_at);
  `);
  for (const table of ["connections", "connection_runs"]) {
    if (
      !cdp
        .all(`PRAGMA table_info(${table})`)
        .some((column) => column.name === "namespace")
    ) {
      cdp.db.exec(`ALTER TABLE ${table} ADD COLUMN namespace TEXT`);
    }
  }
}
export function list(cdp) {
  return cdp
    .all(
      "SELECT c.*,s.name AS segment_name FROM connections c LEFT JOIN segments s ON s.id=c.segment_id ORDER BY c.created_at DESC",
    )
    .map((c) => ({
      ...c,
      settings: undefined,
      settingKeys: Object.keys(JSON.parse(c.settings)),
    }));
}
export function enqueue(cdp, c, p, trigger) {
  const id = randomUUID();
  cdp.run(
    "INSERT INTO connection_runs(id,connection_id,person_id,trigger,status,payload,code,settings,result,error,created_at,finished_at,namespace) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id,
    c.id,
    p.id,
    trigger,
    "queued",
    JSON.stringify(p),
    c.code,
    c.settings,
    null,
    null,
    new Date().toISOString(),
    null,
    c.namespace || `connection_${c.id}`,
  );
  return id;
}
export function baseline(cdp, c, people = cdp.profiles()) {
  cdp.run("DELETE FROM connection_members WHERE connection_id=?", c.id);
  if (!c.segment_id) return;
  const segment = cdp.get(
    "SELECT definition FROM segments WHERE id=?",
    c.segment_id,
  );
  for (const p of people.filter((p) =>
    cdp.matches(p, JSON.parse(segment.definition)),
  ))
    cdp.run("INSERT INTO connection_members VALUES(?,?)", c.id, p.id);
}
export function save(cdp, input) {
  const existing = input.id
    ? cdp.get("SELECT * FROM connections WHERE id=?", input.id)
    : null;
  if (input.id && !existing) throw new Error("Connection not found");
  const name = String(input.name || "")
    .trim()
    .slice(0, 100);
  const code = String(input.code || "");
  if (!name) throw new Error("Give the connection a name");
  if (!code.trim() || code.length > 50000)
    throw new Error("Provide a function body under 50 KB");
  new AsyncFunction("user", "context", code);
  const segmentId = input.segmentId || null;
  if (segmentId && !cdp.get("SELECT id FROM segments WHERE id=?", segmentId))
    throw new Error("Audience not found");
  if (input.enabled && !segmentId)
    throw new Error("Select an audience before enabling the trigger");
  const settings =
    input.settings ?? (existing ? JSON.parse(existing.settings) : {});
  if (
    !settings ||
    Array.isArray(settings) ||
    typeof settings !== "object" ||
    Object.values(settings).some((v) => typeof v !== "string")
  )
    throw new Error("Settings must be a JSON object of string values");
  const id = existing?.id || randomUUID();
  const namespace = String(
    input.namespace ?? existing?.namespace ?? `connection_${id}`,
  )
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9_-]{1,80}$/.test(namespace))
    throw new Error(
      "Namespace must contain 1–80 letters, numbers, underscores or hyphens",
    );
  cdp.db.exec("BEGIN");
  try {
    cdp.run(
      "INSERT INTO connections(id,name,segment_id,code,settings,enabled,created_at,namespace) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,segment_id=excluded.segment_id,code=excluded.code,settings=excluded.settings,enabled=excluded.enabled,namespace=excluded.namespace",
      id,
      name,
      segmentId,
      code,
      JSON.stringify(settings),
      input.enabled ? 1 : 0,
      existing?.created_at || new Date().toISOString(),
      namespace,
    );
    const c = cdp.get("SELECT * FROM connections WHERE id=?", id);
    if (
      !existing ||
      existing.segment_id !== segmentId ||
      (!existing.enabled && c.enabled)
    )
      baseline(cdp, c);
    cdp.db.exec("COMMIT");
    return id;
  } catch (error) {
    cdp.db.exec("ROLLBACK");
    throw error;
  }
}
export function sync(cdp) {
  const connections = cdp.all("SELECT * FROM connections WHERE enabled=1");
  if (!connections.length) return;
  const people = cdp.profiles();
  cdp.db.exec("BEGIN");
  try {
    for (const c of connections) {
      const segment = cdp.get(
        "SELECT definition FROM segments WHERE id=?",
        c.segment_id,
      );
      if (!segment) continue;
      const members = people.filter((p) =>
        cdp.matches(p, JSON.parse(segment.definition)),
      );
      const before = new Set(
        cdp
          .all(
            "SELECT person_id FROM connection_members WHERE connection_id=?",
            c.id,
          )
          .map((r) => r.person_id),
      );
      for (const p of members)
        if (!before.has(p.id)) enqueue(cdp, c, p, "audience_entry");
      baseline(cdp, c, people);
    }
    cdp.db.exec("COMMIT");
  } catch (error) {
    cdp.db.exec("ROLLBACK");
    throw error;
  }
}
export function push(cdp, id, ids) {
  const c = cdp.get("SELECT * FROM connections WHERE id=?", id);
  if (!c) throw new Error("Connection not found");
  if (!Array.isArray(ids) || !ids.length)
    throw new Error("Select at least one person");
  const selected = new Set(ids);
  const people = cdp.profiles().filter((p) => selected.has(p.id));
  if (people.length !== selected.size)
    throw new Error("Some profiles no longer exist");
  cdp.db.exec("BEGIN");
  try {
    const runs = people.map((p) => enqueue(cdp, c, p, "manual"));
    cdp.db.exec("COMMIT");
    return runs;
  } catch (error) {
    cdp.db.exec("ROLLBACK");
    throw error;
  }
}
