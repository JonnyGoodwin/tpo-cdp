import { send, body } from "../http.js";
import { ingestAppEvent, loadAppUsers } from "../../cdp/app-events.js";
import { join } from "node:path";
export function appWebhook(cdp, root) {
  const users = loadAppUsers(join(root, "data", "app_users.csv"));
  return async (req, res, url) => {
    if (url.pathname !== "/webhooks/app") return false;
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(res, { error: "Use POST for app events" }, 405);
    }
    const result = ingestAppEvent(cdp, await body(req), users);
    return send(res, result, result.duplicate ? 200 : 201);
  };
}
