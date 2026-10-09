export function matches(cdp, p, definition) {
  const rules = definition.rules || [];
  const test = (r) => {
    if (r.rules) return cdp.matches(p, r);
    const value =
      r.field === "email"
        ? p.email
        : r.field === "event_count"
          ? p.event_count
          : r.field === "last_seen"
            ? p.last_seen
            : p.traits[r.field];
    const want = r.value;
    switch (r.op) {
      case "known":
        return value != null && value !== "";
      case "unknown":
        return value == null || value === "";
      case "eq":
        return String(value ?? "").toLowerCase() === String(want).toLowerCase();
      case "neq":
        return String(value ?? "").toLowerCase() !== String(want).toLowerCase();
      case "contains":
        return String(value ?? "")
          .toLowerCase()
          .includes(String(want).toLowerCase());
      case "gt":
        return Number(value) > Number(want);
      case "lt":
        return Number(value) < Number(want);
      case "after":
        return Date.parse(value) > Date.parse(want);
      case "before":
        return Date.parse(value) < Date.parse(want);
      case "event":
        return cdp
          .all("SELECT name,properties FROM events WHERE person_id=?", p.id)
          .some((e) =>
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
export function segments(cdp, profiles = cdp.profiles()) {
  return cdp.all("SELECT * FROM segments").map((s) => ({
    ...s,
    definition: JSON.parse(s.definition),
    count: profiles.filter((p) => cdp.matches(p, JSON.parse(s.definition)))
      .length,
  }));
}
