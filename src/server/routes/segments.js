import { sync } from "../../connections/store.js";
import { randomUUID } from "node:crypto";
import { send, body } from "../http.js";
export async function handle(req, res, url, cdp) {
  if (req.method === "POST" && url.pathname === "/api/segments/preview") {
    const b = await body(req);
    return send(res, {
      ids: cdp
        .profiles()
        .filter((p) => cdp.matches(p, b))
        .map((p) => p.id),
    });
  }
  if (req.method === "POST" && url.pathname === "/api/segments") {
    const b = await body(req);
    if (!String(b.name || "").trim())
      throw new Error("Give the segment a name");
    cdp.profiles().forEach((p) => cdp.matches(p, b.definition));
    const id = b.id || randomUUID();
    cdp.run(
      "INSERT INTO segments VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,definition=excluded.definition",
      id,
      String(b.name).trim().slice(0, 100),
      JSON.stringify(b.definition),
    );
    sync(cdp);
    return send(res, { id });
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/api/segments/")) {
    const id = url.pathname.slice(14);
    if (cdp.get("SELECT id FROM connections WHERE segment_id=?", id))
      throw new Error(
        "Remove this audience from its Connections before deleting it",
      );
    cdp.run("DELETE FROM segments WHERE id=?", id);
    return send(res, { ok: true });
  }
  return false;
}
