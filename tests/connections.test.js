import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CDP } from "../src/cdp/index.js";
import { save, sync, push, list } from "../src/connections/store.js";
import { drain } from "../src/connections/runner.js";
const definition = {
  mode: "all",
  rules: [
    {
      field: "test/status",
      op: "eq",
      value: "active",
    },
  ],
};
async function fixture() {
  const cdp = await CDP.open();
  const segmentId = randomUUID();
  await cdp.run(
    "INSERT INTO segments VALUES(?,?,?)",
    segmentId,
    "Active",
    JSON.stringify(definition),
  );
  return {
    cdp,
    segmentId,
  };
}
async function importPerson(cdp, email, status = "active", dryRun = false) {
  return await cdp.importCSV({
    source: "test",
    text: `email,status\n${email},${status}`,
    dryRun,
  });
}
test("audience entry queues once; existing members and dry runs do not push; re-entry triggers", async (t) => {
  const { cdp, segmentId } = await fixture();
  t.after(() => cdp.db.close());
  await importPerson(cdp, "existing@example.com");
  const id = await save(cdp, {
    name: "Test",
    segmentId,
    enabled: true,
    code: "return { ok: true };",
  });
  assert.equal(
    (await cdp.get("SELECT count(*) AS n FROM connection_runs")).n,
    0,
  );
  await importPerson(cdp, "new@example.com", "active", true);
  assert.equal(
    (await cdp.get("SELECT count(*) AS n FROM connection_runs")).n,
    0,
  );
  await importPerson(cdp, "new@example.com");
  await sync(cdp);
  await importPerson(cdp, "new@example.com");
  assert.equal(
    (await cdp.get("SELECT count(*) AS n FROM connection_runs")).n,
    1,
  );
  await importPerson(cdp, "new@example.com", "inactive");
  await importPerson(cdp, "new@example.com");
  assert.equal(
    (await cdp.get("SELECT count(*) AS n FROM connection_runs")).n,
    2,
  );
  await save(cdp, {
    id,
    name: "Test",
    segmentId,
    enabled: false,
    code: "return {};",
  });
  await importPerson(cdp, "paused@example.com");
  await save(cdp, {
    id,
    name: "Test",
    segmentId,
    enabled: true,
    code: "return {};",
  });
  await sync(cdp);
  assert.equal(
    (await cdp.get("SELECT count(*) AS n FROM connection_runs")).n,
    2,
  );
});
test("saved function runs with user/settings/fetch, persists enrichment, and has execution history", async (t) => {
  const { cdp, segmentId } = await fixture();
  t.after(() => cdp.db.close());
  const id = await save(cdp, {
    name: "Enrich",
    segmentId,
    enabled: true,
    settings: {
      TEAM: "news",
    },
    code: `const response=await context.fetch('data:application/json,{"title":"Editor"}'); const data=await response.json(); context.log(user.email); return {traits:{job:data.title,team:context.settings.TEAM},runId:context.runId};`,
  });
  await importPerson(cdp, "new@example.com");
  await drain(cdp);
  const run = await cdp.get("SELECT * FROM connection_runs");
  assert.equal(run.status, "succeeded");
  assert.equal(JSON.parse(run.result).result.runId, run.id);
  assert.equal(
    (await cdp.profiles())[0].traits[`connection_${id}/job`],
    "Editor",
  );
  assert.equal(
    (await cdp.profiles())[0].traits[`connection_${id}/team`],
    "news",
  );
  assert.equal(
    (await cdp.get("SELECT count(*) AS n FROM connection_runs")).n,
    1,
  );
  assert.equal((await list(cdp))[0].settings, undefined);
  assert.deepEqual((await list(cdp))[0].settingKeys, ["TEAM"]);
});
test("manual pushes run without an automatic audience and use snapshots", async (t) => {
  const { cdp } = await fixture();
  t.after(() => cdp.db.close());
  await importPerson(cdp, "manual@example.com");
  const id = await save(cdp, {
    name: "Manual",
    code: "return {email:user.email,version:context.settings.VERSION};",
    settings: {
      VERSION: "v1",
    },
  });
  await push(cdp, id, [(await cdp.profiles())[0].id]);
  await save(cdp, {
    id,
    name: "Changed",
    code: 'throw new Error("new code");',
    settings: {
      VERSION: "v2",
    },
  });
  await drain(cdp);
  const run = await cdp.get("SELECT * FROM connection_runs");
  assert.equal(run.status, "succeeded");
  assert.equal(JSON.parse(run.result).result.version, "v1");
});
test("syntax errors and missing audiences are rejected before saving", async (t) => {
  const { cdp } = await fixture();
  t.after(() => cdp.db.close());
  await assert.rejects(
    async () =>
      await save(cdp, {
        name: "Invalid",
        code: "return {",
      }),
    SyntaxError,
  );
  await assert.rejects(
    async () =>
      await save(cdp, {
        name: "Invalid",
        code: "return {};",
        enabled: true,
      }),
    /Select an audience/,
  );
  assert.equal((await list(cdp)).length, 0);
});
test("failed and timed-out functions do not block subsequent queued calls", async (t) => {
  const { cdp } = await fixture();
  t.after(() => cdp.db.close());
  await importPerson(cdp, "manual@example.com");
  const person = (await cdp.profiles())[0];
  for (const code of [
    'throw new Error("API failed");',
    "while(true) {}",
    "return {ok:true};",
  ]) {
    const id = await save(cdp, {
      name: "Test",
      code,
    });
    await push(cdp, id, [person.id]);
  }
  await drain(cdp, {
    timeout: 500,
  });
  const runs = await cdp.all(
    "SELECT * FROM connection_runs ORDER BY created_at,rowid",
  );
  assert.deepEqual(
    runs.map((r) => r.status),
    ["failed", "failed", "succeeded"],
  );
  assert.match(runs[0].error, /API failed/);
  assert.match(runs[1].error, /limit/);
});
test("enrichment uses the source namespace captured when the call was queued", async (t) => {
  const { cdp } = await fixture();
  t.after(() => cdp.db.close());
  await importPerson(cdp, "namespace@example.com");
  const code = 'return {traits:{job_title:"Editor"}};';
  const id = await save(cdp, {
    name: "PDL",
    namespace: "pdl",
    code,
  });
  await push(cdp, id, [(await cdp.profiles())[0].id]);
  await save(cdp, {
    id,
    name: "PDL",
    namespace: "another_source",
    code,
  });
  await drain(cdp);
  assert.equal((await cdp.profiles())[0].traits["pdl/job_title"], "Editor");
  assert.equal(
    (await cdp.profiles())[0].traits["another_source/job_title"],
    undefined,
  );
  assert.equal((await cdp.profiles())[0].traits["job_title"], undefined);
});
