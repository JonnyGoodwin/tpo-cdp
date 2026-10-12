import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { CDP } from "../src/cdp/index.js";
import { ingestAppEvent } from "../src/cdp/app-events.js";
import { deletePeople } from "../src/cdp/delete-people.js";
import { save, push, sync, list } from "../src/connections/store.js";
import { drain } from "../src/connections/runner.js";
import { assistantRoutes } from "../src/server/routes/assistant.js";
import { Readable } from "node:stream";

const url =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL;
test(
  "Postgres preserves imports, webhook identity merges, reports and queue claims across instances",
  { skip: !url },
  async (t) => {
    const schema = `tpo_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const isolated = new URL(url);
    isolated.searchParams.set("options", `-c search_path=${schema}`);
    const first = await CDP.open(isolated.href);
    const second = await CDP.open(isolated.href);
    t.after(async () => {
      await first.db.close();
      await second.db.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    });
    const csv = {
      source: "subscribers",
      text: "email,signup_date,status\npg-test@example.com,2026-10-01,active\ninvalid,2026-10-01,active",
    };
    assert.equal((await first.importCSV({ ...csv, dryRun: true })).created, 1);
    assert.equal((await second.profiles()).length, 0);
    const imported = await first.importCSV(csv);
    assert.equal(imported.created, 1);
    assert.equal(imported.rejected, 1);
    assert.equal((await second.importCSV(csv)).created, 0);
    const person = (await second.profiles())[0];
    const event = {
      event_id: "pg-event",
      event: "read_story",
      user_id: null,
      device_id: "pg-device",
      timestamp: "2026-10-12T12:00:00Z",
      properties: { story: "test" },
    };
    await ingestAppEvent(first, event);
    const results = await Promise.all([
      ingestAppEvent(
        first,
        { ...event, event_id: "login", event: "login", user_id: "pg-user" },
        new Map([["pg-user", person.email]]),
      ),
      ingestAppEvent(second, event),
    ]);
    assert.equal(results[1].duplicate, true);
    assert.equal((await second.profiles()).length, 1);
    assert.equal((await first.profiles())[0].event_count, 2);
    const connection = await save(first, {
      name: "Postgres QA",
      code: "await new Promise(r=>setTimeout(r,100)); return {traits:{verified:true}};",
      namespace: "qa",
    });
    await push(second, connection, [person.id]);
    await Promise.all([drain(first), drain(second)]);
    assert.equal(
      (await first.get("SELECT status FROM connection_runs")).status,
      "succeeded",
    );
    assert.equal((await second.profiles())[0].traits["qa/verified"], true);
    assert.equal((await list(second))[0].settings, undefined);
    await first.run(
      "INSERT INTO segments VALUES(?,?,?)",
      "active",
      "Active",
      JSON.stringify({
        rules: [{ field: "subscribers/status", op: "eq", value: "active" }],
      }),
    );
    await save(first, {
      id: connection,
      name: "Postgres QA",
      code: "return {};",
      segmentId: "active",
      enabled: true,
    });
    await first.importCSV({
      source: "subscribers",
      text: "email,status\npg-test@example.com,inactive",
    });
    await second.importCSV({
      source: "subscribers",
      text: "email,status\npg-test@example.com,active",
    });
    await Promise.all([sync(first), sync(second)]);
    assert.equal(
      (await first.get("SELECT count(*) AS n FROM connection_runs")).n,
      2,
    );
    const req = (value) => {
      const request = Readable.from([Buffer.from(JSON.stringify(value))]);
      request.method = "POST";
      return request;
    };
    const res = () => ({
      writeHead(status) {
        this.status = status;
      },
      end(value) {
        this.data = JSON.parse(value);
      },
    });
    const report = res();
    await first.withSession(() =>
      assistantRoutes(first)(
        req({ question: "How many signups this month?" }),
        report,
        new URL("http://localhost/api/assistant/ask"),
      ),
    );
    assert.ok(report.data.report_id);
    const saved = res();
    await second.withSession(() =>
      assistantRoutes(second)(
        req({ report_id: report.data.report_id, name: "Persistent report" }),
        saved,
        new URL("http://localhost/api/assistant/segments"),
      ),
    );
    assert.ok(
      await first.get("SELECT id FROM segments WHERE id=?", saved.data.id),
    );
    await assert.rejects(
      deletePeople(first, [person.id, "missing"]),
      /no longer exist/,
    );
    assert.equal((await second.profiles()).length, 1);
    await deletePeople(second, [person.id]);
    assert.equal((await first.profiles()).length, 0);
    assert.equal(
      (await first.get("SELECT count(*) AS n FROM connection_runs")).n,
      0,
    );
  },
);
