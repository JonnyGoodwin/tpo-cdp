import { assistantRoutes } from "./routes/assistant.js";
import { appWebhook } from "./routes/app-webhook.js";
import { handle as connections } from "./routes/connections.js";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { send } from "./http.js";
import { handle as workspace } from "./routes/workspace.js";
import { handle as people } from "./routes/people.js";
import { handle as imports } from "./routes/imports.js";
import { handle as segments } from "./routes/segments.js";
import { handle as exportPeople } from "./routes/export.js";
const pages = new Set([
  "/",
  "/people",
  "/segments",
  "/sources",
  "/attributes",
  "/connections",
  "/assistant",
]);
export function createServer(cdp, root) {
  const webhook = appWebhook(cdp, root);
  const assistant = assistantRoutes(cdp);
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "POST" || req.method === "DELETE") {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host)
          return send(res, { error: "Cross-origin writes are blocked" }, 403);
      }
      for (const handle of [
        workspace,
        people,
        imports,
        segments,
        exportPeople,
        connections,
        webhook,
        assistant,
      ]) {
        if ((await handle(req, res, url, cdp)) !== false) return;
      }
      if (req.method === "GET") {
        const staticRoot = resolve(root, "static");
        const name = pages.has(url.pathname)
          ? "index.html"
          : decodeURIComponent(url.pathname).slice(1);
        const file = resolve(staticRoot, name);
        const type = file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : name === "index.html"
              ? "text/html"
              : null;
        if (file.startsWith(staticRoot + sep) && type && existsSync(file)) {
          res.writeHead(200, {
            "Content-Type": type,
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy":
              "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
          });
          return res.end(readFileSync(file));
        }
      }
      send(res, { error: "Not found" }, 404);
    } catch (error) {
      send(res, { error: error.message }, 400);
    }
  });
}
