import { send, body } from "../http.js";
import { list, save, push } from "../../connections/store.js";
function redact(text, settings) {
  let value = text || "";
  for (const secret of Object.values(JSON.parse(settings)))
    if (secret.length >= 4) value = value.split(secret).join("[redacted]");
  return value;
}
function redactResult(value, settings) {
  if (typeof value === "string") return redact(value, settings);
  if (Array.isArray(value))
    return value.map((item) => redactResult(item, settings));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        redactResult(item, settings),
      ]),
    );
  return value;
}
export async function handle(req, res, url, cdp) {
  if (url.pathname === "/api/connections") {
    if (req.method === "GET") return send(res, { connections: list(cdp) });
    if (req.method === "POST")
      return send(res, { id: save(cdp, await body(req)) });
  }
  const match = url.pathname.match(
    /^\/api\/connections\/([^/]+)(?:\/(push|runs))?$/,
  );
  if (!match) return false;
  const [, id, action] = match;
  if (!cdp.get("SELECT id FROM connections WHERE id=?", id))
    return send(res, { error: "Connection not found" }, 404);
  if (action === "push" && req.method === "POST")
    return send(res, { runs: push(cdp, id, (await body(req)).ids) });
  if (action === "runs" && req.method === "GET") {
    const counts = cdp.all(
      "SELECT status,count(*) AS count FROM connection_runs WHERE connection_id=? GROUP BY status",
      id,
    );
    const runs = cdp
      .all(
        "SELECT r.*,p.email FROM connection_runs r LEFT JOIN people p ON p.id=r.person_id WHERE connection_id=? ORDER BY r.created_at DESC,r.rowid DESC LIMIT 100",
        id,
      )
      .map((r) => ({
        id: r.id,
        person_id: r.person_id,
        email: r.email,
        trigger: r.trigger,
        status: r.status,
        created_at: r.created_at,
        finished_at: r.finished_at,
        result: r.result
          ? redactResult(JSON.parse(r.result), r.settings)
          : null,
        error: redact(r.error, r.settings),
      }));
    return send(res, { runs, counts });
  }
  if (!action && req.method === "DELETE") {
    cdp.run("DELETE FROM connections WHERE id=?", id);
    return send(res, { ok: true });
  }
  return false;
}
