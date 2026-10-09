import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CDP } from "../src/cdp/index.js";
import { save, sync, push, list } from "../src/connections/store.js";
import { drain } from "../src/connections/runner.js";
const definition = {
  mode: "all",
  rules: [{ field: "test/status", op: "eq", value: "active" }],
};
function fixture() {
  const cdp = new CDP();
  const segmentId = randomUUID();
  cdp.run(
    "INSERT INTO segments VALUES(?,?,?)",
    segmentId,
    "Active",
    JSON.stringify(definition),
  );
  return { cdp, segmentId };
}
function importPerson(cdp, email, status = "active", dryRun = false) {
  return cdp.importCSV({
    source: "test",
    text: `email,status\n${email},${status}`,
    dryRun,
  });
}
test("audience entry queues once; existing members and dry runs do not push; re-entry triggers", (t) => {
  const { cdp, segmentId } = fixture();
  t.after(() => cdp.db.close());
  importPerson(cdp, "existing@example.com");
  const id = save(cdp, {
    name: "Test",
    segmentId,
    enabled: true,
    code: "return { ok: true };",
  });
  assert.equal(cdp.get("SELECT count(*) AS n FROM connection_runs").n, 0);
  importPerson(cdp, "new@example.com", "active", true);
  assert.equal(cdp.get("SELECT count(*) AS n FROM connection_runs").n, 0);
  importPerson(cdp, "new@example.com");
  sync(cdp);
  importPerson(cdp, "new@example.com");
  assert.equal(cdp.get("SELECT count(*) AS n FROM connection_runs").n, 1);
  importPerson(cdp, "new@example.com", "inactive");
  importPerson(cdp, "new@example.com");
  assert.equal(cdp.get("SELECT count(*) AS n FROM connection_runs").n, 2);
  save(cdp, {
    id,
    name: "Test",
    segmentId,
    enabled: false,
    code: "return {};",
  });
  importPerson(cdp, "paused@example.com");
  save(cdp, { id, name: "Test", segmentId, enabled: true, code: "return {};" });
  sync(cdp);
  assert.equal(cdp.get("SELECT count(*) AS n FROM connection_runs").n, 2);
});
test("saved function runs with user/settings/fetch, persists enrichment, and has execution history", async (t) => {
  const { cdp, segmentId } = fixture();
  t.after(() => cdp.db.close());
  const id = save(cdp, {
    name: "Enrich",
    segmentId,
    enabled: true,
    settings: { TEAM: "news" },
    code: `const response=await context.fetch('data:application/json,{"title":"Editor"}'); const data=await response.json(); context.log(user.email); return {traits:{job:data.title,team:context.settings.TEAM},runId:context.runId};`,
  });
  importPerson(cdp, "new@example.com");
  await drain(cdp);
  const run = cdp.get("SELECT * FROM connection_runs");
  assert.equal(run.status, "succeeded");
  assert.equal(JSON.parse(run.result).result.runId, run.id);
  assert.equal(cdp.profiles()[0].traits[`connection_${id}/job`], "Editor");
  assert.equal(cdp.profiles()[0].traits[`connection_${id}/team`], "news");
  assert.equal(cdp.get("SELECT count(*) AS n FROM connection_runs").n, 1);
  assert.equal(list(cdp)[0].settings, undefined);
  assert.deepEqual(list(cdp)[0].settingKeys, ["TEAM"]);
});
test("manual pushes run without an automatic audience and use snapshots", async (t) => {
  const { cdp } = fixture();
  t.after(() => cdp.db.close());
  importPerson(cdp, "manual@example.com");
  const id = save(cdp, {
    name: "Manual",
    code: "return {email:user.email,version:context.settings.VERSION};",
    settings: { VERSION: "v1" },
  });
  push(cdp, id, [cdp.profiles()[0].id]);
  save(cdp, {
    id,
    name: "Changed",
    code: 'throw new Error("new code");',
    settings: { VERSION: "v2" },
  });
  await drain(cdp);
  const run = cdp.get("SELECT * FROM connection_runs");
  assert.equal(run.status, "succeeded");
  assert.equal(JSON.parse(run.result).result.version, "v1");
});
test("syntax errors and missing audiences are rejected before saving", (t) => {
  const { cdp } = fixture();
  t.after(() => cdp.db.close());
  assert.throws(
    () => save(cdp, { name: "Invalid", code: "return {" }),
    SyntaxError,
  );
  assert.throws(
    () => save(cdp, { name: "Invalid", code: "return {};", enabled: true }),
    /Select an audience/,
  );
  assert.equal(list(cdp).length, 0);
});
test("failed and timed-out functions do not block subsequent queued calls", async (t) => {
  const { cdp } = fixture();
  t.after(() => cdp.db.close());
  importPerson(cdp, "manual@example.com");
  const person = cdp.profiles()[0];
  for (const code of [
    'throw new Error("API failed");',
    "while(true) {}",
    "return {ok:true};",
  ]) {
    const id = save(cdp, { name: "Test", code });
    push(cdp, id, [person.id]);
  }
  await drain(cdp, { timeout: 500 });
  const runs = cdp.all(
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
  const { cdp } = fixture();
  t.after(() => cdp.db.close());
  importPerson(cdp, "namespace@example.com");
  const code = 'return {traits:{job_title:"Editor"}};';
  const id = save(cdp, { name: "PDL", namespace: "pdl", code });
  push(cdp, id, [cdp.profiles()[0].id]);
  save(cdp, { id, name: "PDL", namespace: "another_source", code });
  await drain(cdp);
  assert.equal(cdp.profiles()[0].traits["pdl/job_title"], "Editor");
  assert.equal(cdp.profiles()[0].traits["another_source/job_title"], undefined);
  assert.equal(cdp.profiles()[0].traits["job_title"], undefined);
});
