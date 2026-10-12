import { activityRange, readingNames } from "../assistant/queries.js";
export function matches(cdp, p, definition, now = new Date()) {
  const rules = definition.rules || [];
  const test = (r) => {
    if (r.rules) return matches(cdp, p, r, now);
    const value =
      r.field === "email"
        ? p.email
        : r.field === "event_count"
          ? r.window_days
            ? (() => {
                const [from, to] = activityRange(r, now);
                return (p.activity || []).filter(
                  (event) =>
                    readingNames.includes(event.name) &&
                    event.timestamp >= (from?.toISOString() || "0000") &&
                    event.timestamp < to.toISOString(),
                ).length;
              })()
            : p.event_count
          : r.field === "last_seen"
            ? p.last_seen
            : p.traits[r.field];
    const want = r.value;
    // Date pickers select a calendar day, while imported date traits contain timestamps.
    const comparable =
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T/.test(value) &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(want))
        ? value.slice(0, 10)
        : value;
    switch (r.op) {
      case "known":
        return value != null && value !== "";
      case "unknown":
        return value == null || value === "";
      case "eq":
        return (
          String(comparable ?? "").toLowerCase() === String(want).toLowerCase()
        );
      case "neq":
        return (
          String(comparable ?? "").toLowerCase() !== String(want).toLowerCase()
        );
      case "contains":
        return String(value ?? "")
          .toLowerCase()
          .includes(String(want).toLowerCase());
      case "gt":
        return Number(value) > Number(want);
      case "lt":
        return Number(value) < Number(want);
      case "older_than_days":
        return (
          value != null &&
          value !== "" &&
          Number.isFinite(Number(want)) &&
          Date.parse(value) <= now.getTime() - Number(want) * 86400000
        );
      case "after":
        return Date.parse(value) > Date.parse(want);
      case "before":
        return Date.parse(value) < Date.parse(want);
      case "event":
        return (p.activity || []).some((e) =>
          [e.name, ...Object.values(JSON.parse(e.properties))].some((v) =>
            String(v).toLowerCase().includes(String(want).toLowerCase()),
          ),
        );
      default:
        throw new Error("Unknown filter operator");
    }
  };
  return (
    !rules.length ||
    (definition.mode === "any" ? rules.some(test) : rules.every(test))
  );
}
export async function segments(cdp, profiles) {
  profiles ||= await cdp.profiles();
  return (await cdp.all("SELECT * FROM segments")).map((s) => ({
    ...s,
    definition: JSON.parse(s.definition),
    count: profiles.filter((p) => cdp.matches(p, JSON.parse(s.definition)))
      .length,
  }));
}
