import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CDP } from "../src/cdp/index.js";
import { ingestAppEvent, loadAppUsers } from "../src/cdp/app-events.js";
import { save } from "../src/connections/store.js";
const users = loadAppUsers(new URL("../data/app_users.csv", import.meta.url));
const knownUser = "u_2b6447a3";
const email = users.get(knownUser);
function payload(overrides = {}) {
  return {
    event_id: "evt_default",
    event: "read_story",
    user_id: null,
    device_id: "d_test",
    timestamp: "2026-09-28T14:22:05Z",
    properties: {
      story: "supreme-court-ruling-explained",
    },
    ...overrides,
  };
}
async function fixture(t) {
  const cdp = await CDP.open();
  t.after(() => cdp.db.close());
  await cdp.importCSV({
    source: "subscribers",
    text: `email,status\n${email},active`,
  });
  return cdp;
}
test("CSV resolves the app user to a subscriber and login moves anonymous history, including late arrivals", async (t) => {
  const cdp = await fixture(t);
  const subscriber = (await cdp.profiles())[0];
  const anonymous = await ingestAppEvent(
    cdp,
    payload({
      event_id: "before",
      event: "app_open",
    }),
    users,
  );
  assert.notEqual(anonymous.person_id, subscriber.id);
  const login = await ingestAppEvent(
    cdp,
    payload({
      event_id: "login",
      event: "login",
      user_id: knownUser,
      timestamp: "2026-09-28T15:00:00Z",
    }),
    users,
  );
  assert.equal(login.person_id, subscriber.id);
  const late = await ingestAppEvent(
    cdp,
    payload({
      event_id: "late",
      timestamp: "2026-09-28T13:00:00Z",
    }),
    users,
  );
  assert.equal(late.person_id, subscriber.id);
  assert.equal((await cdp.profiles()).length, 1);
  const person = (await cdp.profiles())[0];
  assert.equal(person.email, email);
  assert.equal(person.event_count, 3);
  assert.equal(person.last_seen, "2026-09-28T15:00:00.000Z");
  assert.equal(person.traits["subscribers/status"], "active");
  assert.ok(person.identities.some((i) => i.value === `app:${knownUser}`));
  assert.ok(person.identities.some((i) => i.value === "app:d_test"));
  assert.ok(
    (await cdp.all("SELECT * FROM events")).every(
      (e) => e.person_id === subscriber.id,
    ),
  );
  assert.equal(
    JSON.parse(
      (
        await cdp.get(
          "SELECT properties FROM events WHERE id='app_webhook:late'",
        )
      ).properties,
    )["app/story"],
    "supreme-court-ruling-explained",
  );
});
test("login can arrive first; unknown user IDs get profiles and multiple devices resolve to the same person", async (t) => {
  const cdp = await fixture(t);
  const login = await ingestAppEvent(
    cdp,
    payload({
      event_id: "login",
      event: "login",
      user_id: "u_unknown",
    }),
    users,
  );
  const late = await ingestAppEvent(
    cdp,
    payload({
      event_id: "late",
      user_id: null,
    }),
    users,
  );
  const other = await ingestAppEvent(
    cdp,
    payload({
      event_id: "other",
      device_id: "d_other",
      user_id: "u_unknown",
      event: "link_click",
    }),
    users,
  );
  assert.equal(late.person_id, login.person_id);
  assert.equal(other.person_id, login.person_id);
  const person = (await cdp.profiles()).find((p) => p.id === login.person_id);
  assert.equal(person.email, null);
  assert.equal(person.event_count, 3);
});
test("retries dedupe by event ID, keep first payload, and return the current merged profile", async (t) => {
  const cdp = await fixture(t);
  const event = payload();
  await ingestAppEvent(cdp, event, users);
  const subscriber = await ingestAppEvent(
    cdp,
    payload({
      event_id: "login",
      event: "login",
      user_id: knownUser,
    }),
    users,
  );
  const retry = await ingestAppEvent(
    cdp,
    {
      ...event,
      properties: {
        story: "changed",
      },
    },
    users,
  );
  assert.equal(retry.duplicate, true);
  assert.equal(retry.person_id, subscriber.person_id);
  assert.equal((await cdp.get("SELECT count(*) AS n FROM events")).n, 2);
  assert.equal(
    JSON.parse(
      (
        await cdp.get(
          "SELECT properties FROM events WHERE id='app_webhook:evt_default'",
        )
      ).properties,
    )["app/story"],
    event.properties.story,
  );
});
test("invalid events roll back; conflicting app identities cannot merge different users", async (t) => {
  const cdp = await fixture(t);
  for (const patch of [
    {
      event: "invalid",
    },
    {
      event_id: "",
    },
    {
      user_id: undefined,
    },
    {
      event: "login",
      user_id: null,
    },
    {
      device_id: "",
    },
    {
      timestamp: "2026-02-30T10:00:00Z",
    },
    {
      timestamp: "2026-09-28",
    },
    {
      properties: [],
    },
  ])
    await assert.rejects(
      async () => await ingestAppEvent(cdp, payload(patch), users),
    );
  assert.equal((await cdp.get("SELECT count(*) AS n FROM events")).n, 0);
  await ingestAppEvent(
    cdp,
    payload({
      event_id: "a",
      user_id: "u_a",
    }),
    users,
  );
  await assert.rejects(
    async () =>
      await ingestAppEvent(
        cdp,
        payload({
          event_id: "b",
          user_id: "u_b",
        }),
        users,
      ),
    /Conflicting/,
  );
  assert.equal((await cdp.get("SELECT count(*) AS n FROM events")).n, 1);
  assert.equal(
    await cdp.get("SELECT person_id FROM identities WHERE value='app:u_b'"),
    undefined,
  );
});
test("webhook changes are immediately visible to segmentation and enqueue Connections once", async (t) => {
  const cdp = await fixture(t);
  const definition = {
    rules: [
      {
        field: "event_count",
        op: "event",
        value: "read_story",
      },
    ],
  };
  await cdp.run(
    "INSERT INTO segments VALUES(?,?,?)",
    "readers",
    "Story readers",
    JSON.stringify(definition),
  );
  await save(cdp, {
    name: "Readers",
    code: "return {};",
    enabled: true,
    segmentId: "readers",
  });
  const event = payload({
    user_id: knownUser,
  });
  await ingestAppEvent(cdp, event, users);
  assert.equal((await cdp.segments())[0].count, 1);
  assert.equal(cdp.matches((await cdp.profiles())[0], definition), true);
  assert.equal(
    (await cdp.get("SELECT count(*) AS n FROM connection_runs")).n,
    1,
  );
  await ingestAppEvent(cdp, event, users);
  assert.equal(
    (await cdp.get("SELECT count(*) AS n FROM connection_runs")).n,
    1,
  );
});
test("device links and event deduplication persist after reopening the database", async (t) => {
  const folder = mkdtempSync(join(tmpdir(), "tpo-app-events-"));
  t.after(() =>
    rmSync(folder, {
      recursive: true,
      force: true,
    }),
  );
  const path = join(folder, "test.sqlite");
  let cdp = await CDP.open(path);
  const event = payload({
    event: "login",
    user_id: "u_persistent",
  });
  const first = await ingestAppEvent(cdp, event, users);
  cdp.db.close();
  cdp = await CDP.open(path);
  try {
    assert.equal((await ingestAppEvent(cdp, event, users)).duplicate, true);
    assert.equal(
      (
        await ingestAppEvent(
          cdp,
          payload({
            event_id: "late",
          }),
          users,
        )
      ).person_id,
      first.person_id,
    );
    assert.equal((await cdp.profiles())[0].event_count, 2);
  } finally {
    cdp.db.close();
  }
});
