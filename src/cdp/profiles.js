export async function profiles(cdp) {
  const events = await cdp.all("SELECT * FROM events");
  const activity = new Map();
  for (const event of events) {
    if (!activity.has(event.person_id)) activity.set(event.person_id, []);
    activity.get(event.person_id).push(event);
  }
  const eventCounts = new Map(
    (
      await cdp.all(
        "SELECT person_id,count(*) AS n,max(timestamp) AS last FROM events GROUP BY person_id",
      )
    ).map((r) => [r.person_id, r]),
  );
  const ids = new Map();
  for (const r of await cdp.all("SELECT * FROM identities")) {
    if (!ids.has(r.person_id)) ids.set(r.person_id, []);
    ids.get(r.person_id).push(r);
  }
  return (await cdp.all("SELECT * FROM people ORDER BY created_at DESC")).map(
    (p) => {
      const profile = {
        ...p,
        traits: JSON.parse(p.traits),
        identities: ids.get(p.id) || [],
        event_count: eventCounts.get(p.id)?.n || 0,
        last_seen: eventCounts.get(p.id)?.last || null,
      };
      Object.defineProperty(profile, "activity", {
        value: activity.get(p.id) || [],
      });
      return profile;
    },
  );
}
