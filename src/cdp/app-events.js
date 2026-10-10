import { readFileSync } from "node:fs";
import { parseCSV } from "./csv.js";
import { resolvePerson } from "./identity.js";
import { sync } from "../connections/store.js";
const allowedEvents = new Set([
  "app_open",
  "read_story",
  "link_click",
  "login",
]);
export function loadAppUsers(path) {
  const { rows } = parseCSV(readFileSync(path, "utf8"));
  return new Map(
    rows
      .filter((r) => r.data.user_id?.trim() && r.data.email?.trim())
      .map((r) => [r.data.user_id.trim(), r.data.email.trim().toLowerCase()]),
  );
}
function identifier(value, field, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new Error(
      `${field} must be a nonempty string of up to 200 characters${nullable ? " or null" : ""}`,
    );
  return value.trim();
}
function validate(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Send a JSON event object");
  const eventId = identifier(payload.event_id, "event_id");
  const userId = identifier(payload.user_id, "user_id", true);
  const deviceId = identifier(payload.device_id, "device_id");
  if (!allowedEvents.has(payload.event))
    throw new Error("event must be app_open, read_story, link_click, or login");
  if (payload.event === "login" && !userId)
    throw new Error("login requires a user_id");
  const timestamp = payload.timestamp;
  if (
    typeof timestamp !== "string" ||
    !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      timestamp,
    ) ||
    Number.isNaN(Date.parse(timestamp))
  )
    throw new Error("timestamp must be an ISO 8601 datetime with a timezone");
  const [year, month, day] = timestamp.slice(0, 10).split("-").map(Number);
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day)
    throw new Error("timestamp contains an invalid calendar date");
  const properties = payload.properties;
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  )
    throw new Error("properties must be a JSON object");
  if (
    Object.keys(properties).some(
      (key) => !key || ["__proto__", "constructor", "prototype"].includes(key),
    )
  )
    throw new Error("Invalid property name");
  return {
    eventId,
    userId,
    deviceId,
    event: payload.event,
    timestamp: new Date(timestamp).toISOString(),
    properties,
  };
}
export function ingestAppEvent(cdp, payload, users = new Map()) {
  const event = validate(payload);
  const id = `app_webhook:${event.eventId}`;
  const existing = cdp.get("SELECT person_id FROM events WHERE id=?", id);
  if (existing)
    return {
      event_id: event.eventId,
      person_id: existing.person_id,
      duplicate: true,
    };
  cdp.db.exec("BEGIN");
  let personId;
  try {
    const identity = { anonymous_id: event.deviceId };
    if (event.userId) {
      identity.external_id = event.userId;
      const email = users.get(event.userId);
      if (email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          throw new Error("App user lookup contains an invalid email");
        identity.email = email;
      }
    }
    personId = resolvePerson(cdp, { source: "app", identity }).id;
    if (identity.email)
      cdp.run(
        "UPDATE people SET email=COALESCE(?,email) WHERE id=?",
        identity.email,
        personId,
      );
    const properties = Object.fromEntries(
      Object.entries(event.properties).map(([key, value]) => [
        `app/${key}`,
        value,
      ]),
    );
    cdp.run(
      "INSERT INTO events VALUES(?,?,?,?,?,?)",
      id,
      personId,
      "app",
      event.event,
      event.timestamp,
      JSON.stringify(properties),
    );
    cdp.db.exec("COMMIT");
  } catch (error) {
    cdp.db.exec("ROLLBACK");
    throw error;
  }
  sync(cdp);
  return { event_id: event.eventId, person_id: personId, duplicate: false };
}
