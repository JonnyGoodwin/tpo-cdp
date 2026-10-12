import { send, body } from "../http.js";
import { ingestAppEvent, loadAppUsers } from "../../cdp/app-events.js";
import { join } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
export function appWebhook(cdp, root) {
  const users = loadAppUsers(join(root, "data", "app_users.csv"));
  return async (req, res, url) => {
    if (url.pathname !== "/webhooks/app") return false;
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(
        res,
        {
          error: "Use POST for app events",
        },
        405,
      );
    }
    const secret = process.env.APP_WEBHOOK_SECRET;
    if (!secret) return send(res, { error: "Webhook is not configured" }, 503);
    const authorization = req.headers.authorization || "";
    const provided = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    const digest = (value) => createHash("sha256").update(value).digest();
    if (!provided || !timingSafeEqual(digest(provided), digest(secret)))
      return send(res, { error: "Unauthorized" }, 401);
    const result = await ingestAppEvent(cdp, await body(req), users);
    return send(res, result, result.duplicate ? 200 : 201);
  };
}
