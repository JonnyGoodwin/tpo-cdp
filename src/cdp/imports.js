import { resolvePerson } from "./identity.js";
import { createHash, randomUUID } from "node:crypto";
import { parseCSV, defaultMapping, convert } from "./csv.js";
export async function importCSV(
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
  await cdp.db.exec("BEGIN");
  try {
    for (const row of csv.rows) {
      await cdp.db.exec("SAVEPOINT row");
      const before = {
        ...result,
      };
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
        const resolved = await resolvePerson(cdp, {
          source,
          identity,
          name,
        });
        const id = resolved.id;
        for (const key of ["created", "updated", "merged"])
          result[key] += resolved[key];
        const current = await cdp.get("SELECT * FROM people WHERE id=?", id);
        if (type === "people")
          await cdp.run(
            "UPDATE people SET email=?,name=?,traits=? WHERE id=?",
            identity.email || current.email,
            name || current.name,
            JSON.stringify({
              ...JSON.parse(current.traits),
              ...traits,
            }),
            id,
          );
        else {
          await cdp.run(
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
          const added = await cdp.run(
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
        await cdp.db.exec("RELEASE row");
      } catch (e) {
        await cdp.db.exec("ROLLBACK TO row; RELEASE row");
        Object.assign(result, before);
        result.rejected++;
        result.errors.push({
          line: row.line,
          message: e.message,
        });
      }
    }
    if (dryRun) await cdp.db.exec("ROLLBACK");
    else {
      await cdp.run(
        "INSERT INTO imports VALUES(?,?,?,?,?,?,?)",
        randomUUID(),
        source,
        filename,
        type,
        new Date().toISOString(),
        JSON.stringify(mapping),
        JSON.stringify(result),
      );
      await cdp.db.exec("COMMIT");
    }
    return result;
  } catch (e) {
    await cdp.db.exec("ROLLBACK");
    throw e;
  }
}
