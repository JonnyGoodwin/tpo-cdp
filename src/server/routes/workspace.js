import { send } from "../http.js";
export async function handle(req, res, url, cdp) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    const profiles = cdp.profiles();
    const imports = cdp
      .all("SELECT * FROM imports ORDER BY created_at DESC")
      .map((i) => ({
        ...i,
        mapping: JSON.parse(i.mapping),
        result: JSON.parse(i.result),
      }));
    const fields = [
      ...new Set(profiles.flatMap((p) => Object.keys(p.traits))),
    ].sort();
    return send(res, {
      profiles,
      imports,
      fields,
      segments: cdp.segments(profiles),
      stats: {
        people: profiles.length,
        known: profiles.filter((p) => p.email).length,
        anonymous: profiles.filter((p) => !p.email).length,
        events: cdp.get("SELECT count(*) AS n FROM events").n,
        sources: new Set(imports.map((i) => i.source)).size,
      },
    });
  }
  return false;
}
