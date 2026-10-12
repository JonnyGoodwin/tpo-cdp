import test from "node:test";
import assert from "node:assert/strict";
import { CDP } from "../src/cdp/index.js";
import { deletePeople } from "../src/cdp/delete-people.js";
import { save, push } from "../src/connections/store.js";
import { drain } from "../src/connections/runner.js";
async function fixture(t) {
  const cdp = await CDP.open();
  t.after(() => cdp.db.close());
  await cdp.importCSV({
    source: "test",
    text: "email,name\na@example.com,A\nb@example.com,B",
  });
  return cdp;
}
test("deleting people removes identities, events, memberships, and queued/history payloads while preserving others", async (t) => {
  const cdp = await fixture(t);
  const person = (await cdp.profiles()).find(
    (p) => p.email === "a@example.com",
  );
  await cdp.importCSV({
    source: "test",
    type: "events",
    text: "email,timestamp\na@example.com,2026-10-09T10:00:00Z",
  });
  await cdp.run(
    "INSERT INTO segments VALUES(?,?,?)",
    "audience",
    "Everyone",
    JSON.stringify({
      rules: [],
    }),
  );
  const connection = await save(cdp, {
    name: "Test",
    segmentId: "audience",
    enabled: true,
    code: "return {ok:true};",
  });
  await push(cdp, connection, [person.id]);
  await drain(cdp);
  await push(cdp, connection, [person.id]);
  assert.deepEqual(await deletePeople(cdp, [person.id, person.id]), {
    deleted: 1,
  });
  for (const table of [
    "identities",
    "events",
    "connection_members",
    "connection_runs",
  ])
    assert.equal(
      (
        await cdp.get(
          `SELECT count(*) AS n FROM ${table} WHERE person_id=?`,
          person.id,
        )
      ).n,
      0,
    );
  assert.equal((await cdp.profiles()).length, 1);
  assert.equal((await cdp.profiles())[0].email, "b@example.com");
  await drain(cdp);
  assert.equal(
    (await cdp.get("SELECT count(*) AS n FROM connection_runs")).n,
    0,
  );
  assert.equal((await cdp.segments())[0].count, 1);
});
test("bulk deletion validates IDs and rolls back all removals if any deletion fails", async (t) => {
  const cdp = await fixture(t);
  const ids = (await cdp.profiles()).map((p) => p.id);
  await assert.rejects(async () => await deletePeople(cdp, []), /Select/);
  await assert.rejects(
    async () => await deletePeople(cdp, [ids[0], "missing"]),
    /no longer exist/,
  );
  assert.equal((await cdp.profiles()).length, 2);
  await cdp.db.exec(
    "CREATE TRIGGER prevent_delete BEFORE DELETE ON people WHEN OLD.email='b@example.com' BEGIN SELECT RAISE(ABORT,'blocked'); END;",
  );
  await assert.rejects(async () => await deletePeople(cdp, ids), /blocked/);
  assert.equal((await cdp.profiles()).length, 2);
  assert.equal((await cdp.get("SELECT count(*) AS n FROM identities")).n, 2);
});
test("deleting a person terminates an active function and cannot recreate profile data", async (t) => {
  const cdp = await fixture(t);
  const person = (await cdp.profiles())[0];
  const connection = await save(cdp, {
    name: "Slow",
    code: "await new Promise(resolve=>setTimeout(resolve,10000)); return {traits:{restored:true}};",
  });
  await push(cdp, connection, [person.id]);
  const running = drain(cdp);
  while (
    (await cdp.get("SELECT status FROM connection_runs")).status === "queued"
  )
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    (await cdp.get("SELECT status FROM connection_runs")).status,
    "running",
  );
  await deletePeople(cdp, [person.id]);
  await running;
  assert.equal(
    await cdp.get("SELECT id FROM people WHERE id=?", person.id),
    undefined,
  );
  assert.equal(
    (await cdp.get("SELECT count(*) AS n FROM connection_runs")).n,
    0,
  );
});
