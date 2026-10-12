import { parseCSV, defaultMapping } from "../../cdp/csv.js";
import { send, body } from "../http.js";
export async function handle(req, res, url, cdp) {
  if (req.method === "POST" && url.pathname === "/api/csv/preview") {
    const b = await body(req);
    const csv = parseCSV(b.text);
    return send(res, {
      headers: csv.headers,
      rows: csv.rows.slice(0, 5).map((r) => r.data),
      count: csv.rows.length,
      mapping: defaultMapping(csv.headers),
    });
  }
  if (req.method === "POST" && url.pathname === "/api/import")
    return send(res, await cdp.importCSV(await body(req)));
  return false;
}
