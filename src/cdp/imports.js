import { createHash, randomUUID } from "node:crypto";
import { parseCSV, defaultMapping, convert } from "./csv.js";

export function importCSV(
  cdp,
  {
    text,
    source,
    filename = "upload.csv",
    type = "people",
    mapping,
    dryRun = false,
  },
) {
  source = String(source || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9_-]{1,50}$/.test(source))
    throw new Error(
      "Source must contain 1–50 letters, numbers, underscores or hyphens",
    );
  if (!["people", "events"].includes(type))
    throw new Error("Choose people or events");
  const csv = parseCSV(text);
  mapping ||= defaultMapping(csv.headers);
  if (
    !Array.isArray(mapping) ||
    mapping.some(
      (m) =>
        !csv.headers.includes(m.column) ||
        ![
          "skip",
          "email",
          "external_id",
          "anonymous_id",
          "name",
          "trait",
          "timestamp",
          "event_name",
        ].includes(m.target) ||
        !["string", "number", "boolean", "date"].includes(m.type),
    )
  )
    throw new Error("Invalid column mapping");
  for (const role of [
    "email",
    "external_id",
    "anonymous_id",
    "name",
    "timestamp",
    "event_name",
  ])
    if (mapping.filter((m) => m.target === role).length > 1)
      throw new Error(`Map only one column to ${role}`);
  if (
    !mapping.some((m) =>
      ["email", "external_id", "anonymous_id"].includes(m.target),
    )
  )
    throw new Error("Map at least one identity column");
  if (type === "events" && !mapping.some((m) => m.target === "timestamp"))
    throw new Error("Events need a timestamp column");
  const names = mapping
    .filter((m) => m.target === "trait")
    .map((m) => String(m.name || m.column).trim());
  if (
    new Set(names).size !== names.length ||
    names.some(
      (n) => !n || ["__proto__", "constructor", "prototype"].includes(n),
    )
  )
    throw new Error("Trait names must be unique and nonempty");
  const result = {
    rows: csv.rows.length,
    created: 0,
    updated: 0,
    merged: 0,
    events: 0,
    duplicates: 0,
    rejected: 0,
    errors: [],
  };
  cdp.db.exec("BEGIN");
  try {
    for (const row of csv.rows) {
      cdp.db.exec("SAVEPOINT row");
      const before = { ...result };
      try {
        if (row.values.length !== csv.headers.length)
          throw new Error("Column count does not match header");
        const identity = {};
        const traits = {};
        let timestamp,
          eventName = "Page viewed",
          name;
        for (const m of mapping) {
          const v = row.data[m.column].trim();
          if (!v || m.target === "skip") continue;
          if (m.target === "trait")
            traits[`${source}/${String(m.name || m.column).trim()}`] = convert(
              v,
              m.type,
            );
          else if (m.target === "timestamp") timestamp = convert(v, "date");
          else if (m.target === "event_name") eventName = v;
          else if (m.target === "name") name = v;
          else identity[m.target] = v;
        }
        if (identity.email) {
          identity.email = identity.email.toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email))
            throw new Error("Invalid email address");
        }
        if (!Object.keys(identity).length) throw new Error("Missing identity");
        if (type === "events" && !timestamp)
          throw new Error("Missing event timestamp");
        const keys = Object.entries(identity).map(([k, v]) => [
          k,
          k === "email" ? v : `${source}:${v}`,
        ]);
        const matched = [
          ...new Set(
            keys
              .map(
                ([k, v]) =>
                  cdp.get(
                    "SELECT person_id FROM identities WHERE kind=? AND value=?",
                    k,
                    v,
                  )?.person_id,
              )
              .filter(Boolean),
          ),
        ];
        const externals = matched.flatMap((id) =>
          cdp
            .all(
              "SELECT value FROM identities WHERE person_id=? AND kind='external_id'",
              id,
            )
            .map((r) => r.value),
        );
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
        let id =
          matched.find(
            (id) => cdp.get("SELECT email FROM people WHERE id=?", id).email,
          ) || matched[0];
        if (!id) {
          id = randomUUID();
          cdp.run(
            "INSERT INTO people VALUES(?,?,?,?,?)",
            id,
            identity.email || null,
            name || null,
            new Date().toISOString(),
            "{}",
          );
          result.created++;
        } else result.updated++;
        for (const other of matched.filter((x) => x !== id)) {
          const a = JSON.parse(
            cdp.get("SELECT traits FROM people WHERE id=?", other).traits,
          );
          const b = JSON.parse(
            cdp.get("SELECT traits FROM people WHERE id=?", id).traits,
          );
          cdp.run(
            "UPDATE people SET traits=? WHERE id=?",
            JSON.stringify({ ...a, ...b }),
            id,
          );
          cdp.run(
            "UPDATE identities SET person_id=? WHERE person_id=?",
            id,
            other,
          );
          cdp.run("UPDATE events SET person_id=? WHERE person_id=?", id, other);
          cdp.run("DELETE FROM people WHERE id=?", other);
          result.merged++;
        }
        for (const [k, v] of keys)
          cdp.run("INSERT OR IGNORE INTO identities VALUES(?,?,?)", k, v, id);
        const current = cdp.get("SELECT * FROM people WHERE id=?", id);
        if (type === "people")
          cdp.run(
            "UPDATE people SET email=?,name=?,traits=? WHERE id=?",
            identity.email || current.email,
            name || current.name,
            JSON.stringify({ ...JSON.parse(current.traits), ...traits }),
            id,
          );
        else {
          cdp.run(
            "UPDATE people SET email=COALESCE(?,email),name=COALESCE(?,name) WHERE id=?",
            identity.email || null,
            name || null,
            id,
          );
          const eventId = createHash("sha256")
            .update(
              JSON.stringify([source, identity, timestamp, eventName, traits]),
            )
            .digest("hex");
          const added = cdp.run(
            "INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?)",
            eventId,
            id,
            source,
            eventName,
            timestamp,
            JSON.stringify(traits),
          );
          result[added.changes ? "events" : "duplicates"]++;
        }
        cdp.db.exec("RELEASE row");
      } catch (e) {
        cdp.db.exec("ROLLBACK TO row; RELEASE row");
        Object.assign(result, before);
        result.rejected++;
        result.errors.push({ line: row.line, message: e.message });
      }
    }
    if (dryRun) cdp.db.exec("ROLLBACK");
    else {
      cdp.run(
        "INSERT INTO imports VALUES(?,?,?,?,?,?,?)",
        randomUUID(),
        source,
        filename,
        type,
        new Date().toISOString(),
        JSON.stringify(mapping),
        JSON.stringify(result),
      );
      cdp.db.exec("COMMIT");
    }
    return result;
  } catch (e) {
    cdp.db.exec("ROLLBACK");
    throw e;
  }
}
