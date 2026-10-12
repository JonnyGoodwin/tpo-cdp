import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { CDP } from "../src/cdp/index.js";
import { appWebhook } from "../src/server/routes/app-webhook.js";

const root = fileURLToPath(new URL("../", import.meta.url));
function response() {
  return {
    status: null,
    data: null,
    writeHead(status) {
      this.status = status;
    },
    end(value) {
      this.data = JSON.parse(value);
    },
  };
}
function request(authorization, payload) {
  const req = Readable.from([Buffer.from(JSON.stringify(payload))]);
  req.method = "POST";
  req.headers = authorization ? { authorization } : {};
  return req;
}
test("webhook rejects missing configuration and incorrect secrets before ingesting; authenticated retries deduplicate", async (t) => {
  const previous = process.env.APP_WEBHOOK_SECRET;
  t.after(() => {
    if (previous === undefined) delete process.env.APP_WEBHOOK_SECRET;
    else process.env.APP_WEBHOOK_SECRET = previous;
  });
  const cdp = await CDP.open();
  t.after(() => cdp.db.close());
  const handle = appWebhook(cdp, root);
  const url = new URL("http://localhost/webhooks/app");
  const payload = {
    event_id: "auth-test",
    event: "read_story",
    user_id: null,
    device_id: "auth-device",
    timestamp: "2026-10-12T12:00:00Z",
    properties: {},
  };
  delete process.env.APP_WEBHOOK_SECRET;
  let res = response();
  await handle(request("Bearer test-secret", payload), res, url);
  assert.equal(res.status, 503);
  process.env.APP_WEBHOOK_SECRET = "test-secret";
  for (const authorization of [
    undefined,
    "Bearer wrong-secret",
    "test-secret",
    "Bearer test-secret ",
    "Basic test-secret",
  ]) {
    res = response();
    const req = request(authorization, payload);
    await handle(req, res, url);
    assert.equal(res.status, 401);
    assert.equal(req.readableDidRead, false);
  }
  assert.equal((await cdp.get("SELECT count(*) AS n FROM events")).n, 0);
  for (const status of [201, 200]) {
    res = response();
    await handle(request("Bearer test-secret", payload), res, url);
    assert.equal(res.status, status);
  }
  assert.equal((await cdp.get("SELECT count(*) AS n FROM events")).n, 1);
});
