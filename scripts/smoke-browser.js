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
  env: {
    ...process.env,
    PORT: "0",
    CDP_DATA_DIR: dataDir,
    OPENAI_API_KEY: "",
    APP_WEBHOOK_SECRET: "browser-test-secret",
  },
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
    ["/assistant", "Growth assistant"],
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
  await page.locator('[data-rule-field="0"]').selectOption("last_seen");
  assert.equal(
    await page.locator('[data-rule-value="0"]').getAttribute("type"),
    "date",
  );
  await page.locator('[data-rule-field="0"]').selectOption("email");
  assert.equal(
    await page.locator('[data-rule-value="0"]').getAttribute("type"),
    "text",
  );
  await page.locator('[data-rule-op="0"]').selectOption("before");
  assert.equal(
    await page.locator('[data-rule-value="0"]').getAttribute("type"),
    "date",
  );
  await page.locator('[data-rule-field="0"]').selectOption("app/created_at");
  await page.locator('[data-rule-value="0"]').fill("2026-11-01");
  await page.getByRole("button", { name: "Add group", exact: false }).click();
  await page.locator('[data-rule-field="1.0"]').selectOption("last_seen");
  await page.locator('[data-rule-op="1.0"]').selectOption("after");
  await page.locator('[data-rule-value="1.0"]').fill("2026-01-01");
  await page.getByRole("button", { name: "Save segment", exact: true }).click();
  await page.getByRole("heading", { name: "Segments", exact: true }).waitFor();
  const segment = page
    .locator(".segment-card")
    .filter({ hasText: "Browser QA temporary" });
  await segment.getByRole("button", { name: "Edit" }).click();
  assert.equal(
    await page.locator('[data-rule-value="0"]').inputValue(),
    "2026-11-01",
  );
  assert.equal(
    await page.locator('[data-rule-value="1.0"]').inputValue(),
    "2026-01-01",
  );
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
  const appEvent = {
    event_id: "webhook-qa-anonymous",
    event: "read_story",
    user_id: null,
    device_id: "webhook-qa-device",
    timestamp: "2026-09-28T14:22:05Z",
    properties: { story: "webhook-qa-story" },
  };
  for (const authorization of [
    undefined,
    "Bearer wrong-secret",
    "browser-test-secret",
  ]) {
    const rejected = await page.request.post(base + "/webhooks/app", {
      headers: authorization ? { Authorization: authorization } : {},
      data: appEvent,
    });
    assert.equal(rejected.status(), 401);
  }
  const anonymousResponse = await page.request.post(base + "/webhooks/app", {
    headers: { Authorization: "Bearer browser-test-secret" },
    data: appEvent,
  });
  assert.equal(anonymousResponse.status(), 201);
  const anonymousEvent = await anonymousResponse.json();
  const loginResponse = await page.request.post(base + "/webhooks/app", {
    headers: { Authorization: "Bearer browser-test-secret" },
    data: {
      ...appEvent,
      event_id: "webhook-qa-login",
      event: "login",
      user_id: "u_2b6447a3",
      timestamp: "2026-09-28T15:00:00Z",
      properties: {},
    },
  });
  assert.equal(loginResponse.status(), 201);
  const loggedIn = await loginResponse.json();
  assert.notEqual(loggedIn.person_id, anonymousEvent.person_id);
  const lateResponse = await page.request.post(base + "/webhooks/app", {
    headers: { Authorization: "Bearer browser-test-secret" },
    data: {
      ...appEvent,
      event_id: "webhook-qa-late",
      timestamp: "2026-09-28T13:00:00Z",
    },
  });
  assert.equal((await lateResponse.json()).person_id, loggedIn.person_id);
  const retryResponse = await page.request.post(base + "/webhooks/app", {
    headers: { Authorization: "Bearer browser-test-secret" },
    data: appEvent,
  });
  assert.equal(retryResponse.status(), 200);
  assert.equal((await retryResponse.json()).duplicate, true);
  const lookup = await (
    await page.request.get(`${base}/api/people/${loggedIn.person_id}`)
  ).json();
  assert.equal(lookup.email, "julia.evans230@gmail.com");
  assert.equal(
    lookup.events.filter((event) => event.id.startsWith("app_webhook:")).length,
    3,
  );
  const preview = await page.request.post(base + "/api/segments/preview", {
    data: {
      rules: [{ field: "event_count", op: "event", value: "webhook-qa-story" }],
    },
  });
  assert.ok((await preview.json()).ids.includes(loggedIn.person_id));
  await page.goto(base + "/people");
  await page
    .getByPlaceholder("Search by email, name, or identity…")
    .fill("julia.evans230@gmail.com");
  await page.locator("tbody tr[data-profile]").click();
  await page.getByText("webhook-qa-story", { exact: false }).first().waitFor();
  await page.keyboard.press("Escape");
  await page.goto(base + "/assistant");
  await page.locator('[data-chat-example="0"]').click();
  await expect(page.locator(".assistant-answer").last()).toContainText(
    "Exact historical cold transitions",
  );
  await page.getByRole("button", { name: "Use this definition" }).click();
  await expect(page.locator(".assistant-answer").last()).toContainText(
    "subscribers match",
  );
  const answerPromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/assistant/ask") && r.request().method() === "POST",
  );
  await page.locator('[data-chat-example="1"]').click();
  const answer = await (await answerPromise).json();
  assert.equal(answer.planner, "local");
  assert.equal(answer.model_context, null);
  assert.equal(answer.plan.min_reads, 3);
  assert.ok(answer.rows.every((row) => !row.email && !row.name && !row.id));
  await expect(page.locator(".chat-user").last()).toContainText(
    "most engaged readers",
  );
  await page.getByRole("button", { name: "Save as segment" }).last().click();
  await page.locator("#assistant-segment-name").fill("QA assistant readers");
  await page.locator("#assistant-save-confirm").click();
  await expect(page.locator(".assistant-answer").last()).toContainText(
    "Saved “QA assistant readers”",
  );
  assert.equal(new URL(page.url()).pathname, "/assistant");
  const savedState = await (await page.request.get(base + "/api/state")).json();
  const savedAudience = savedState.segments.find(
    (s) => s.name === "QA assistant readers",
  );
  assert.equal(
    savedAudience.definition.rules.find((r) => r.field === "event_count")
      .window_days,
    30,
  );
  assert.equal(savedAudience.count, answer.count);
  const privateQuestion = await (
    await page.request.post(base + "/api/assistant/ask", {
      data: { question: "How many signups for alice@example.com?" },
    })
  ).json();
  assert.ok(privateQuestion.clarification);
  const firstPages = await (
    await page.request.post(base + "/api/assistant/ask", {
      data: { question: "Which pages do new subscribers hit first?" },
    })
  ).json();
  assert.equal(firstPages.kind, "first_pages");
  assert.equal(firstPages.report_id, null);
  // Follow-ups retain the last approved filters without sending the transcript to AI.
  await page.locator("#assistant-question").fill("just Instagram");
  const followupPromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/assistant/ask") && r.request().method() === "POST",
  );
  await page.locator("#assistant-question").press("Enter");
  const followup = await (await followupPromise).json();
  assert.equal(followup.plan.channel, "Instagram");
  assert.equal(followup.plan.min_reads, 3);
  assert.equal(followup.plan.kind, "audience");
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  await page.locator("#assistant-question").fill("I want to upload a list");
  await page.locator("#assistant-question").press("Enter");
  await expect(page.locator(".assistant-answer").last()).toContainText(
    "choose a CSV",
  );
  await page
    .locator(".assistant-answer")
    .last()
    .getByRole("button", { name: "Upload a list" })
    .click();
  await page.locator("#source-name").fill("chat_upload");
  await page.locator("#csv-file").setInputFiles({
    name: "chat-list.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "email,name\nchat-upload@example.com,Private Chat Name",
    ),
  });
  await page.locator("#import-next").click();
  await page.locator("#import-review").click();
  await page.locator("#import-commit").click();
  await page
    .getByRole("heading", { name: "Import complete", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Return to chat", exact: true })
    .click();
  await expect(page.locator(".assistant-answer").last()).toContainText(
    "Your list is imported. 1 new profiles",
  );
  assert.equal(new URL(page.url()).pathname, "/assistant");
  assert.ok(
    !(await page.locator("#assistant-results").textContent()).includes(
      "Private Chat Name",
    ),
  );
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  assert.equal(await page.locator(".chat-user").count(), 0);
  await page.locator("#assistant-question").fill("just Instagram");
  await page.locator("#assistant-question").press("Enter");
  await expect(page.locator(".assistant-answer").last()).toContainText(
    "rephrase",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
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
