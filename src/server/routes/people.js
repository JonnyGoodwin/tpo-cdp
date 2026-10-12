import { send, body } from "../http.js";
import { deletePeople } from "../../cdp/delete-people.js";
export async function handle(req, res, url, cdp) {
  if (req.method === "DELETE" && url.pathname === "/api/people") {
    return send(res, await deletePeople(cdp, (await body(req)).ids));
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/api/people/")) {
    return send(
      res,
      await deletePeople(cdp, [decodeURIComponent(url.pathname.slice(12))]),
    );
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/people/")) {
    const id = decodeURIComponent(url.pathname.slice(12));
    const person = (await cdp.profiles()).find((p) => p.id === id);
    if (!person)
      return send(
        res,
        {
          error: "Profile not found",
        },
        404,
      );
    return send(res, {
      ...person,
      events: (
        await cdp.all(
          "SELECT * FROM events WHERE person_id=? ORDER BY timestamp DESC",
          id,
        )
      ).map((e) => ({
        ...e,
        properties: JSON.parse(e.properties),
      })),
    });
  }
  return false;
}
