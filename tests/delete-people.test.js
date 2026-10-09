import test from "node:test";
import assert from "node:assert/strict";
import { CDP } from "../src/cdp/index.js";
import { deletePeople } from "../src/cdp/delete-people.js";
import { save, push } from "../src/connections/store.js";
import { drain } from "../src/connections/runner.js";
function fixture(t) {
  const cdp = new CDP();
  t.after(() => cdp.db.close());
  cdp.importCSV({
    source: "test",
    text: "email,name\na@example.com,A\nb@example.com,B",
  });
  return cdp;
}
test("deleting people removes identities, events, memberships, and queued/history payloads while preserving others", async (t) => {
  const cdp = fixture(t);
  const person = cdp.profiles().find((p) => p.email === "a@example.com");
  cdp.importCSV({
    source: "test",
    type: "events",
    text: "email,timestamp\na@example.com,2026-10-09T10:00:00Z",
  });
  cdp.run(
    "INSERT INTO segments VALUES(?,?,?)",
    "audience",
    "Everyone",
    JSON.stringify({ rules: [] }),
  );
  const connection = save(cdp, {
    name: "Test",
    segmentId: "audience",
    enabled: true,
    code: "return {ok:true};",
  });
  push(cdp, connection, [person.id]);
  await drain(cdp);
  push(cdp, connection, [person.id]);
  assert.deepEqual(deletePeople(cdp, [person.id, person.id]), { deleted: 1 });
  for (const table of [
    "identities",
    "events",
    "connection_members",
    "connection_runs",
  ])
    assert.equal(
      cdp.get(`SELECT count(*) AS n FROM ${table} WHERE person_id=?`, person.id)
        .n,
      0,
    );
  assert.equal(cdp.profiles().length, 1);
  assert.equal(cdp.profiles()[0].email, "b@example.com");
  await drain(cdp);
  assert.equal(cdp.get("SELECT count(*) AS n FROM connection_runs").n, 0);
  assert.equal(cdp.segments()[0].count, 1);
});
test("bulk deletion validates IDs and rolls back all removals if any deletion fails", (t) => {
  const cdp = fixture(t);
  const ids = cdp.profiles().map((p) => p.id);
  assert.throws(() => deletePeople(cdp, []), /Select/);
  assert.throws(
    () => deletePeople(cdp, [ids[0], "missing"]),
    /no longer exist/,
  );
  assert.equal(cdp.profiles().length, 2);
  cdp.db.exec(
    "CREATE TRIGGER prevent_delete BEFORE DELETE ON people WHEN OLD.email='b@example.com' BEGIN SELECT RAISE(ABORT,'blocked'); END;",
  );
  assert.throws(() => deletePeople(cdp, ids), /blocked/);
  assert.equal(cdp.profiles().length, 2);
  assert.equal(cdp.get("SELECT count(*) AS n FROM identities").n, 2);
});
test("deleting a person terminates an active function and cannot recreate profile data", async (t) => {
  const cdp = fixture(t);
  const person = cdp.profiles()[0];
  const connection = save(cdp, {
    name: "Slow",
    code: "await new Promise(resolve=>setTimeout(resolve,10000)); return {traits:{restored:true}};",
  });
  push(cdp, connection, [person.id]);
  const running = drain(cdp);
  assert.equal(cdp.get("SELECT status FROM connection_runs").status, "running");
  deletePeople(cdp, [person.id]);
  await running;
  assert.equal(
    cdp.get("SELECT id FROM people WHERE id=?", person.id),
    undefined,
  );
  assert.equal(cdp.get("SELECT count(*) AS n FROM connection_runs").n, 0);
});
