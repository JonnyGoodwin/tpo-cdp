import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export function seed(cdp, root) {
  if (!cdp.get("SELECT count(*) AS n FROM imports").n) {
    for (const [filename, source, type] of [
      ["subscribers.csv", "subscribers", "people"],
      ["app_users.csv", "app", "people"],
      ["web_events.csv", "web", "events"],
    ]) {
      const text = readFileSync(join(root, "data", filename), "utf8");
      console.log(
        `Loaded ${filename}:`,
        cdp.importCSV({ text, source, filename, type }),
      );
    }
    for (const [name, definition] of [
      [
        "Active subscribers",
        {
          mode: "all",
          rules: [{ field: "subscribers/status", op: "eq", value: "active" }],
        },
      ],
      [
        "App users",
        {
          mode: "all",
          rules: [{ field: "app/created_at", op: "known", value: "" }],
        },
      ],
      [
        "Engaged readers",
        {
          mode: "all",
          rules: [
            { field: "email", op: "known", value: "" },
            { field: "event_count", op: "gt", value: "4" },
          ],
        },
      ],
    ])
      cdp.run(
        "INSERT INTO segments VALUES(?,?,?)",
        randomUUID(),
        name,
        JSON.stringify(definition),
      );
  }
}
