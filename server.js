import { startRunner } from "./src/connections/runner.js";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { CDP } from "./src/cdp/index.js";
import { seed } from "./src/server/seed.js";
import { createServer } from "./src/server/app.js";
const root = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.CDP_DATA_DIR || join(root, "data");
mkdirSync(dataDir, {
  recursive: true,
});
const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;
if (process.env.VERCEL && !databaseUrl)
  throw new Error("Configure Postgres before deploying this app");
const cdp = await CDP.open(databaseUrl || join(dataDir, "cdp.sqlite"));
if (!databaseUrl) await seed(cdp, root);
if (!process.env.VERCEL) await startRunner(cdp);
const server = createServer(cdp, root);
const port = Number(process.env.PORT || 8787);
server.listen(port, "127.0.0.1", () =>
  console.log(`CDP web app: http://localhost:${server.address().port}`),
);
