import { randomUUID } from "node:crypto";
// Resolves and merges identities inside the caller's transaction.
export async function resolvePerson(cdp, { source, identity, name }) {
  const counts = {
    created: 0,
    updated: 0,
    merged: 0,
  };
  const keys = Object.entries(identity).map(([k, v]) => [
    k,
    k === "email" ? v : `${source}:${v}`,
  ]);
  const found = [];
  for (const [kind, value] of keys) {
    const row = await cdp.get(
      "SELECT person_id FROM identities WHERE kind=? AND value=?",
      kind,
      value,
    );
    if (row) found.push(row.person_id);
  }
  const matched = [...new Set(found)];
  const externals = [];
  for (const id of matched) {
    const rows = await cdp.all(
      "SELECT value FROM identities WHERE person_id=? AND kind='external_id'",
      id,
    );
    externals.push(...rows.map((row) => row.value));
  }
  const externalSources = new Map();
  for (const v of externals.concat(
    identity.external_id ? [`${source}:${identity.external_id}`] : [],
  )) {
    const namespace = v.split(":")[0];
    if (!externalSources.has(namespace))
      externalSources.set(namespace, new Set());
    externalSources.get(namespace).add(v);
  }
  if ([...externalSources.values()].some((values) => values.size > 1))
    throw new Error("Conflicting external IDs; profile was not merged");
  let id;
  for (const candidate of matched) {
    if (
      (await cdp.get("SELECT email FROM people WHERE id=?", candidate)).email
    ) {
      id = candidate;
      break;
    }
  }
  id ||= matched[0];
  if (!id) {
    id = randomUUID();
    await cdp.run(
      "INSERT INTO people VALUES(?,?,?,?,?)",
      id,
      identity.email || null,
      name || null,
      new Date().toISOString(),
      "{}",
    );
    counts.created++;
  } else counts.updated++;
  for (const other of matched.filter((x) => x !== id)) {
    const a = JSON.parse(
      (await cdp.get("SELECT traits FROM people WHERE id=?", other)).traits,
    );
    const b = JSON.parse(
      (await cdp.get("SELECT traits FROM people WHERE id=?", id)).traits,
    );
    await cdp.run(
      "UPDATE people SET traits=? WHERE id=?",
      JSON.stringify({
        ...a,
        ...b,
      }),
      id,
    );
    await cdp.run(
      "UPDATE identities SET person_id=? WHERE person_id=?",
      id,
      other,
    );
    await cdp.run("UPDATE events SET person_id=? WHERE person_id=?", id, other);
    await cdp.run("DELETE FROM people WHERE id=?", other);
    counts.merged++;
  }
  for (const [k, v] of keys)
    await cdp.run("INSERT OR IGNORE INTO identities VALUES(?,?,?)", k, v, id);
  return {
    id,
    ...counts,
  };
}
