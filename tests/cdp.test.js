import test from "node:test";
import assert from "node:assert/strict";
import { CDP, parseCSV, defaultMapping } from "../src/cdp/index.js";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("CSV handles BOM, CRLF, escaped quotes and embedded newlines", () => {
  const csv = parseCSV(
    '\ufeffemail,note\r\na@b.com,"hello, ""reader""\nnext line"\r\n',
  );
  assert.equal(csv.rows[0].data.note, 'hello, "reader"\nnext line');
  assert.throws(() => parseCSV("a,a\n1,2"), /unique/);
  assert.throws(() => parseCSV('a\n"broken'), /unclosed/);
});
test("dry run rolls back and email updates are normalized and persistent", () => {
  const path = mkdtempSync(join(tmpdir(), "cdp-test-"));
  const db = new CDP(join(path, "test.sqlite"));
  const payload = {
    source: "crm",
    text: "email,name,score\nA@EXAMPLE.COM,Alice,10",
    mapping: [
      { column: "email", target: "email", type: "string" },
      { column: "name", target: "name", type: "string" },
      { column: "score", target: "trait", name: "score", type: "number" },
    ],
  };
  assert.equal(db.importCSV({ ...payload, dryRun: true }).created, 1);
  assert.equal(db.profiles().length, 0);
  assert.equal(db.all("SELECT * FROM imports").length, 0);
  db.importCSV(payload);
  assert.equal(db.importCSV(payload).created, 0);
  assert.equal(db.profiles()[0].email, "a@example.com");
  assert.equal(db.profiles()[0].traits["crm/score"], 10);
  db.db.close();
  const reopened = new CDP(join(path, "test.sqlite"));
  assert.equal(reopened.profiles().length, 1);
  reopened.db.close();
  rmSync(path, { recursive: true });
});
test("identifying a visitor merges anonymous browsing history and repeated events dedupe", () => {
  const db = new CDP();
  db.importCSV({ source: "crm", text: "email\nreader@example.com" });
  const first = {
    source: "web",
    type: "events",
    text: "visitor_id,email,timestamp,page\nv1,,2026-09-01T00:00:00Z,/",
  };
  db.importCSV(first);
  assert.equal(db.profiles().length, 2);
  assert.equal(
    db.importCSV({
      ...first,
      text: "visitor_id,email,timestamp,page\nv1,reader@example.com,2026-09-02T00:00:00Z,/subscribe",
    }).merged,
    1,
  );
  assert.equal(db.profiles().length, 1);
  assert.equal(db.profiles()[0].event_count, 2);
  assert.equal(db.importCSV(first).duplicates, 1);
  assert.equal(db.profiles()[0].event_count, 2);
  db.db.close();
});
test("conflicting IDs and invalid rows are rejected without partial profile changes", () => {
  const db = new CDP();
  db.importCSV({
    source: "app",
    text: "user_id,email\nu1,a@example.com\nu2,b@example.com",
  });
  const r = db.importCSV({
    source: "app",
    text: "user_id,email\nu2,a@example.com\nu3,broken\nu4,c@example.com",
  });
  assert.equal(r.rejected, 2);
  assert.equal(r.created, 1);
  assert.equal(db.profiles().length, 3);
  assert.equal(
    db.profiles().find((p) => p.email === "a@example.com").identities.length,
    2,
  );
  db.db.close();
});
test("a visitor cannot merge conflicting app identities through another source", () => {
  const db = new CDP();
  db.importCSV({
    source: "app",
    text: "user_id,email\nu1,a@example.com\nu2,b@example.com",
  });
  db.importCSV({
    source: "web",
    type: "events",
    text: "visitor_id,email,timestamp\nv1,a@example.com,2026-09-01",
  });
  const result = db.importCSV({
    source: "web",
    type: "events",
    text: "visitor_id,email,timestamp\nv1,b@example.com,2026-09-02",
  });
  assert.equal(result.rejected, 1);
  assert.equal(db.profiles().length, 2);
  assert.equal(db.get("SELECT count(*) AS n FROM events").n, 1);
  db.db.close();
});
test("invalid typed values do not write identities; duplicate mapping roles fail early", () => {
  const db = new CDP();
  const text = "email,score\na@example.com,broken\nb@example.com,12";
  const mapping = defaultMapping(parseCSV(text).headers).map((m) => ({
    ...m,
    type: m.column === "score" ? "number" : m.type,
  }));
  const result = db.importCSV({ source: "crm", text, mapping });
  assert.equal(result.created, 1);
  assert.equal(result.rejected, 1);
  assert.equal(db.profiles()[0].email, "b@example.com");
  assert.throws(
    () =>
      db.importCSV({
        source: "crm",
        text,
        mapping: mapping.map((m) => ({ ...m, target: "email" })),
      }),
    /one column/,
  );
  db.db.close();
});
test("typed traits, empty updates, nested segments and event predicates", () => {
  const db = new CDP();
  const text =
    "email,status,score\na@example.com,active,8\nb@example.com,unsubscribed,2";
  const mapping = defaultMapping(parseCSV(text).headers).map((m) => ({
    ...m,
    type: m.column === "score" ? "number" : m.type,
  }));
  db.importCSV({ source: "crm", text, mapping });
  db.importCSV({ source: "crm", text: "email,status\na@example.com," });
  const definition = {
    mode: "all",
    rules: [
      { field: "crm/status", op: "eq", value: "active" },
      {
        mode: "any",
        rules: [
          { field: "crm/score", op: "gt", value: 5 },
          { field: "email", op: "unknown" },
        ],
      },
    ],
  };
  assert.equal(
    db.profiles().filter((p) => db.matches(p, definition)).length,
    1,
  );
  db.importCSV({
    source: "web",
    type: "events",
    text: "email,timestamp,page\na@example.com,2026-09-01,/subscribe",
  });
  assert.equal(
    db
      .profiles()
      .filter((p) =>
        db.matches(p, { rules: [{ op: "event", value: "/subscribe" }] }),
      ).length,
    1,
  );
  db.db.close();
});
test("supplied datasets import, stitch identities, and reimport without duplicate events", () => {
  const db = new CDP();
  for (const [file, source, type] of [
    ["subscribers.csv", "subscribers", "people"],
    ["app_users.csv", "app", "people"],
    ["web_events.csv", "web", "events"],
  ]) {
    const result = db.importCSV({
      text: readFileSync(new URL("../data/" + file, import.meta.url), "utf8"),
      source,
      type,
    });
    assert.equal(result.rejected, file === "subscribers.csv" ? 10 : 0);
  }
  const profiles = db.profiles();
  assert.equal(db.get("SELECT count(*) AS n FROM events").n, 10000);
  assert.equal(profiles.filter((p) => p.traits["app/created_at"]).length, 930);
  assert.ok(
    profiles.some(
      (p) =>
        p.traits["subscribers/status"] &&
        p.traits["app/created_at"] &&
        p.event_count,
    ),
  );
  const again = db.importCSV({
    text: readFileSync(
      new URL("../data/web_events.csv", import.meta.url),
      "utf8",
    ),
    source: "web",
    type: "events",
  });
  assert.equal(again.events, 0);
  assert.equal(again.duplicates, 10000);
  console.log("Seed dataset:", {
    profiles: profiles.length,
    known: profiles.filter((p) => p.email).length,
    anonymous: profiles.filter((p) => !p.email).length,
  });
  db.db.close();
});
