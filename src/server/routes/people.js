import { send } from "../http.js";
export async function handle(req, res, url, cdp) {
  if (req.method === "GET" && url.pathname.startsWith("/api/people/")) {
    const id = decodeURIComponent(url.pathname.slice(12));
    const person = cdp.profiles().find((p) => p.id === id);
    if (!person) return send(res, { error: "Profile not found" }, 404);
    return send(res, {
      ...person,
      events: cdp
        .all(
          "SELECT * FROM events WHERE person_id=? ORDER BY timestamp DESC",
          id,
        )
        .map((e) => ({ ...e, properties: JSON.parse(e.properties) })),
    });
  }
  return false;
}
