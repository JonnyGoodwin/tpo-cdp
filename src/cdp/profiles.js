export function profiles(cdp) {
  const eventCounts = new Map(
    cdp
      .all(
        "SELECT person_id,count(*) AS n,max(timestamp) AS last FROM events GROUP BY person_id",
      )
      .map((r) => [r.person_id, r]),
  );
  const ids = new Map();
  for (const r of cdp.all("SELECT * FROM identities")) {
    if (!ids.has(r.person_id)) ids.set(r.person_id, []);
    ids.get(r.person_id).push(r);
  }
  return cdp.all("SELECT * FROM people ORDER BY created_at DESC").map((p) => ({
    ...p,
    traits: JSON.parse(p.traits),
    identities: ids.get(p.id) || [],
    event_count: eventCounts.get(p.id)?.n || 0,
    last_seen: eventCounts.get(p.id)?.last || null,
  }));
}
