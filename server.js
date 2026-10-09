import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { CDP } from "./src/cdp/index.js";
import { seed } from "./src/server/seed.js";
import { createServer } from "./src/server/app.js";
const root = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.CDP_DATA_DIR || join(root, "data");
mkdirSync(dataDir, { recursive: true });
const cdp = new CDP(join(dataDir, "cdp.sqlite"));
seed(cdp, root);
const server = createServer(cdp, root);
const port = Number(process.env.PORT || 8787);
server.listen(port, "127.0.0.1", () =>
  console.log(`CDP web app: http://localhost:${server.address().port}`),
);
