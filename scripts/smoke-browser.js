import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = mkdtempSync(join(tmpdir(), "tpo-cdp-browser-"));
const server = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT: "0", CDP_DATA_DIR: dataDir },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error("Server startup timeout")),
      30000,
    );
    server.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/CDP web app: (http:\/\/localhost:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited ${code}`));
    });
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  });
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Each page must work as a direct URL and survive a refresh.
  for (const [route, title] of [
    ["/", "Your audience, connected."],
    ["/people", "People"],
    ["/segments", "Segments"],
    ["/sources", "Sources & imports"],
    ["/attributes", "Attributes"],
    ["/connections", "Connections"],
  ]) {
    const response = await page.goto(base + route);
    assert.equal(response.status(), 200);
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
  }
  await page.goto(base);
  await page
    .getByRole("heading", { name: "Your audience, connected." })
    .waitFor();
  await page.screenshot({
    path: join(tmpdir(), "tpo-cdp-overview.png"),
    fullPage: true,
  });
  await page.locator('#nav [data-view="people"]').click();
  await page.getByRole("heading", { name: "People", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/people");
  await page.goBack();
  await page
    .getByRole("heading", { name: "Your audience, connected." })
    .waitFor();
  await page.goForward();
  await page.getByRole("heading", { name: "People", exact: true }).waitFor();
  const workspace = await (await page.request.get(base + "/api/state")).json();
  for (const segment of workspace.segments) {
    const membership = await page.request.post(base + "/api/segments/preview", {
      data: segment.definition,
    });
    const ids = new Set((await membership.json()).ids);
    await page.getByLabel("Filter by segment").selectOption(segment.id);
    await page
      .getByRole("heading", { name: segment.name, exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("Filter by segment").inputValue(),
      segment.id,
    );
    assert.equal(
      await page.locator("tbody tr[data-profile]").count(),
      Math.min(ids.size, 25),
    );
    const visibleIds = await page
      .locator("tbody tr[data-profile]")
      .evaluateAll((rows) => rows.map((row) => row.dataset.profile));
    assert.ok(
      visibleIds.every((id) => ids.has(id)),
      "Table contains only segment members",
    );
    assert.ok(
      (await page.locator(".pagination").innerText()).includes(
        `of ${ids.size.toLocaleString()} people`,
      ),
    );
  }
  await page.getByLabel("Filter by segment").selectOption("");
  await page.getByRole("heading", { name: "People", exact: true }).waitFor();
  assert.ok(
    (await page.locator(".pagination").innerText()).includes(
      `of ${workspace.stats.people.toLocaleString()} people`,
    ),
  );
  await page
    .getByPlaceholder("Search by email, name, or identity…")
    .fill("julia.peterson914");
  assert.equal(await page.locator("tbody tr[data-profile]").count(), 1);
  await page.locator("tbody tr[data-profile]").click();
  await page.getByRole("heading", { name: "Linked identities" }).waitFor();
  await page.keyboard.press("Escape");
  const exportDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: false }).click();
  const download = await exportDownload;
  assert.equal(download.suggestedFilename(), "people.csv");
  await page
    .getByRole("button", { name: "Create segment", exact: false })
    .click();
  await page.getByLabel("Segment name").fill("Browser QA temporary");
  await page.getByRole("button", { name: "Add group", exact: false }).click();
  await page.getByRole("button", { name: "Save segment", exact: true }).click();
  await page.getByRole("heading", { name: "Segments", exact: true }).waitFor();
  const segment = page
    .locator(".segment-card")
    .filter({ hasText: "Browser QA temporary" });
  await segment.getByRole("button", { name: "Edit" }).click();
  await page
    .getByRole("button", { name: "Delete segment", exact: true })
    .click();
  await page.getByRole("heading", { name: "Segments", exact: true }).waitFor();
  await page.locator("#global-import").click();
  await page.locator("#csv-file").setInputFiles({
    name: "browser_qa.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("email,score\nqa@example.com,12\nbad-email,7"),
  });
  await page.locator("#source-name").fill("browser_qa");
  await page.getByRole("button", { name: "Map columns" }).click();
  await page.locator('[data-map-type="1"]').selectOption("number");
  await page.getByRole("button", { name: "Validate mapping" }).click();
  await page.getByText("1 row will be skipped.", { exact: false }).waitFor();
  let response = await page.request.get(base + "/api/state");
  assert.equal(
    (await response.json()).stats.people,
    3558,
    "preview must not persist changes",
  );
  await page.screenshot({
    path: join(tmpdir(), "tpo-cdp-import.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Import 1 valid row", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Import complete", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "View people", exact: false }).click();
  await page
    .getByPlaceholder("Search by email, name, or identity…")
    .fill("qa@example.com");
  await page.locator("tbody tr[data-profile]").click();
  await page.getByText("browser_qa/score", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  response = await page.request.get(base + "/api/state");
  const data = await response.json();
  assert.equal(data.stats.people, 3559);
  assert.equal(
    data.profiles.find((p) => p.email === "qa@example.com").traits[
      "browser_qa/score"
    ],
    12,
  );
  await page.locator('#nav [data-view="sources"]').click();
  await page
    .getByRole("heading", { name: "Sources & imports", exact: true })
    .waitFor();
  await page.locator("tr[data-import-detail]").first().click();
  await page
    .getByRole("heading", { name: "Saved mapping", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.locator('#nav [data-view="attributes"]').click();
  await page.getByText("score", { exact: true }).waitFor();
  const connectionAudience = await (
    await page.request.post(base + "/api/segments", {
      data: {
        name: "Connection QA audience",
        definition: {
          mode: "all",
          rules: [
            { field: "email", op: "eq", value: "connection-qa@example.com" },
          ],
        },
      },
    })
  ).json();
  await page.goto(base + "/connections");
  await page.getByRole("button", { name: "New connection" }).click();
  await page.getByLabel("Connection name").fill("Browser QA connection");
  await page.getByLabel("Source namespace", { exact: true }).fill("pdl");
  await page
    .getByLabel("JavaScript function body")
    .fill("context.log(user.email); return { traits: { tested: true } };");
  await page
    .getByLabel("Audience", { exact: true })
    .selectOption(connectionAudience.id);
  await page
    .getByLabel("Run automatically whenever someone joins this audience")
    .check();
  await page
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Browser QA connection", exact: true })
    .waitFor();
  const connection = (
    await (await page.request.get(base + "/api/connections")).json()
  ).connections[0];
  assert.equal(connection.enabled, 1);
  assert.equal(
    (
      await (
        await page.request.get(`${base}/api/connections/${connection.id}/runs`)
      ).json()
    ).runs.length,
    0,
  );
  const committed = await page.request.post(base + "/api/import", {
    data: { source: "connection_qa", text: "email\nconnection-qa@example.com" },
  });
  assert.equal(committed.status(), 200);
  await expect
    .poll(
      async () => {
        const { runs } = await (
          await page.request.get(
            `${base}/api/connections/${connection.id}/runs`,
          )
        ).json();
        return runs.some((run) => run.status === "succeeded");
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await page.getByRole("button", { name: "Run history" }).click();
  await page
    .getByText("succeeded", { exact: true })
    .waitFor({ timeout: 5000 })
    .catch(async (error) => {
      console.log(
        "Run history debug:",
        await page.locator("#toast").innerText(),
        await page.locator("#overlay").innerText(),
      );
      throw error;
    });
  await page.keyboard.press("Escape");
  await page.goto(base + "/people");
  await page
    .getByPlaceholder("Search by email, name, or identity…")
    .fill("connection-qa@example.com");
  await page.getByRole("button", { name: "Push audience" }).click();
  await page
    .getByLabel("Connection", { exact: true })
    .selectOption(connection.id);
  await page.getByRole("button", { name: "Push 1 people" }).click();
  await expect
    .poll(
      async () => {
        const { runs } = await (
          await page.request.get(
            `${base}/api/connections/${connection.id}/runs`,
          )
        ).json();
        return (
          runs.length === 2 && runs.every((run) => run.status === "succeeded")
        );
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const enrichedState = await (
    await page.request.get(base + "/api/state")
  ).json();
  assert.equal(
    enrichedState.profiles.find((p) => p.email === "connection-qa@example.com")
      .traits["pdl/tested"],
    true,
  );
  await page.request.delete(`${base}/api/connections/${connection.id}`);
  await page.request.delete(`${base}/api/segments/${connectionAudience.id}`);
  await page.locator("tbody tr[data-profile]").click();
  await page
    .getByRole("button", { name: "Delete person", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.locator("tbody tr[data-profile]").count(), 1);
  await page.locator("tbody tr[data-profile]").click();
  await page
    .getByRole("button", { name: "Delete person", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete person", exact: true })
    .click();
  await page
    .getByText("No profiles match these filters.", { exact: true })
    .waitFor();
  await page.request.post(base + "/api/import", {
    data: {
      source: "deletion_qa",
      text: "email\ndelete-qa-1@example.com\ndelete-qa-2@example.com",
    },
  });
  await page.reload();
  await page
    .getByPlaceholder("Search by email, name, or identity…")
    .fill("delete-qa-");
  await page.getByLabel("Select page", { exact: true }).check();
  await page
    .getByRole("button", { name: "Delete selected (2)", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete 2 people", exact: true })
    .click();
  await page
    .getByText("No profiles match these filters.", { exact: true })
    .waitFor();
  const afterDeletion = await (
    await page.request.get(base + "/api/state")
  ).json();
  assert.ok(
    afterDeletion.profiles.every(
      (p) =>
        !p.email?.includes("delete-qa-") &&
        p.email !== "connection-qa@example.com",
    ),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#nav [data-view="overview"]').click();
  await page
    .getByRole("heading", { name: "Your audience, connected." })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: join(tmpdir(), "tpo-cdp-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: overview, search, profile, export, nested segment save/delete, import preview/commit, typed traits, history, attributes, mobile.",
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await exited;
  }
  rmSync(dataDir, { recursive: true, force: true });
}
