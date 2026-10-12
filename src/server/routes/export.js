import { body, csvCell } from "../http.js";
export async function handle(req, res, url, cdp) {
  if (["GET", "POST"].includes(req.method) && url.pathname === "/api/export") {
    let profiles = await cdp.profiles();
    const segmentId = url.searchParams.get("segment");
    if (segmentId) {
      const s = await cdp.get(
        "SELECT definition FROM segments WHERE id=?",
        segmentId,
      );
      if (!s) throw new Error("Segment not found");
      profiles = profiles.filter((p) =>
        cdp.matches(p, JSON.parse(s.definition)),
      );
    }
    const ids =
      req.method === "POST"
        ? (await body(req)).ids
        : url.searchParams.get("ids")?.split(",");
    if (ids) {
      const selected = new Set(ids);
      profiles = profiles.filter((p) => selected.has(p.id));
    }
    const fields = [
      ...new Set(profiles.flatMap((p) => Object.keys(p.traits))),
    ].sort();
    const headers = ["id", "email", "name", "event_count", ...fields];
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="people.csv"',
      "Cache-Control": "no-store",
    });
    return res.end(
      [
        headers.map(csvCell).join(","),
        ...profiles.map((p) =>
          [
            p.id,
            p.email,
            p.name,
            p.event_count,
            ...fields.map((f) => p.traits[f]),
          ]
            .map(csvCell)
            .join(","),
        ),
      ].join("\r\n"),
    );
  }
  return false;
}
