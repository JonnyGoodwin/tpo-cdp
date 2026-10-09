import {
  $,
  esc,
  num,
  date,
  state,
  api,
  modal,
  close,
  refresh,
  go,
} from "../shared.js";

let importState;
export function openImport() {
  importState = {
    step: 1,
    text: "",
    filename: "",
    source: "",
    type: "people",
    mapping: [],
    preview: null,
    result: null,
  };
  importView();
}
export function importView() {
  const i = importState;
  const steps = `<div class="steps">${["Upload CSV", "Map columns", "Review & import"].map((s, k) => `<span class="${i.step === k + 1 ? "active" : ""}">${k + 1}. ${s}</span>`).join("")}</div>`;
  let content, footer;
  if (i.step === 1) {
    content = `<div class="modal-body"><h3>Add a new data source</h3><p class="hint">Import people or events from any CSV. Existing identities will be matched to your audience.</p><div class="dropzone"><div class="upload-icon">⇧</div><h3>${esc(i.filename || "Choose a CSV or drop it here")}</h3><p class="hint">UTF-8 CSV · Up to 20 MB · Your original file stays unchanged</p><input type="file" accept=".csv,text/csv" id="csv-file" aria-label="Upload CSV"></div><div class="form-grid"><div class="field"><label for="source-name">Source namespace</label><input id="source-name" placeholder="e.g. subscribers, salesforce" value="${esc(i.source)}"></div><div class="field"><label for="import-type">What does each row represent?</label><select id="import-type"><option value="people" ${i.type === "people" ? "selected" : ""}>A person / profile</option><option value="events" ${i.type === "events" ? "selected" : ""}>An event / activity</option></select></div></div>${i.preview ? `<div class="notice">${num(i.preview.count)} rows · ${i.preview.headers.length} columns detected</div>` : ""}<div id="import-error"></div></div>`;
    footer = `<span class="hint">Step 1 of 3</span><button class="button primary" id="import-next" ${!i.preview ? "disabled" : ""}>Map columns →</button>`;
  }
  if (i.step === 2) {
    content = `<div class="modal-body"><div class="notice">Map an email, external ID, or visitor ID to identify each row. Other columns become attributes under <strong>${esc(i.source)}/</strong>. Blank values do not erase existing data.${i.type === "events" ? " Events also require a timestamp." : ""}</div><div class="table-scroll"><table class="mapping-table"><thead><tr><th>CSV COLUMN / EXAMPLE</th><th>MAP TO</th><th>ATTRIBUTE NAME</th><th>TYPE</th></tr></thead><tbody>${i.mapping
      .map(
        (m, k) =>
          `<tr><td>${esc(m.column)}<small>${esc(i.preview.rows[0]?.[m.column] || "(blank)")}</small></td><td><select data-map-target="${k}">${[
            ["skip", "Ignore column"],
            ["email", "Email identity"],
            ["external_id", "External ID"],
            ["anonymous_id", "Visitor / anonymous ID"],
            ["name", "Display name"],
            [
              "trait",
              i.type === "events" ? "Event property" : "Profile attribute",
            ],
            ...(i.type === "events"
              ? [
                  ["timestamp", "Event timestamp"],
                  ["event_name", "Event name"],
                ]
              : []),
          ]
            .map(
              ([v, l]) =>
                `<option value="${v}" ${m.target === v ? "selected" : ""}>${l}</option>`,
            )
            .join(
              "",
            )}</select></td><td><input data-map-name="${k}" value="${esc(m.name)}" ${m.target !== "trait" ? "disabled" : ""} aria-label="Attribute name for ${esc(m.column)}"></td><td><select data-map-type="${k}" ${m.target !== "trait" ? "disabled" : ""}>${["string", "number", "boolean", "date"].map((t) => `<option ${m.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><p class="hint">External IDs and visitor IDs are scoped to this source. Emails match across all sources. Default event name: Page viewed.</p><div id="import-error"></div></div>`;
    footer = `<button class="button" id="import-back">← Back</button><button class="button primary" id="import-review">Validate mapping →</button>`;
  }
  if (i.step === 3) {
    const r = i.result;
    content = `<div class="modal-body"><h3>Ready to import ${esc(i.filename)}</h3><p class="hint">These are the projected changes. No data has been written yet.</p>${resultGrid(r)}${r.rejected ? `<div class="notice error">${num(r.rejected)} ${r.rejected === 1 ? "row" : "rows"} will be skipped. Valid rows will still import.</div>${errorTable(r.errors)}` : '<div class="notice">All rows passed validation. Matching identities will update existing profiles; anonymous history will move with merged profiles.</div>'}<div id="import-error"></div></div>`;
    footer = `<button class="button" id="import-back">← Back</button><button class="button primary" id="import-commit" ${r.rows === r.rejected ? "disabled" : ""}>Import ${num(r.rows - r.rejected)} valid ${r.rows - r.rejected === 1 ? "row" : "rows"}</button>`;
  }
  if (i.step === 4) {
    content = `<div class="modal-body"><div class="success"><div class="success-icon">✓</div><h2>Import complete</h2><p class="hint">${esc(i.filename)} is now part of your customer data.</p></div>${resultGrid(i.result)}${errorTable(i.result.errors)}${i.result.errors.length ? '<button class="button small" id="download-errors">↓ Download rejected rows</button>' : ""}</div>`;
    footer = `<span class="hint">Mapping saved in import history</span><button class="button primary" id="import-done">View people →</button>`;
  }
  modal("Import customer data", steps + content, footer, true);
  if (i.step === 1) {
    $("#csv-file").onchange = async (e) => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024)
          throw new Error("Upload exceeds the 20 MB limit");
        i.text = await file.text();
        i.filename = file.name;
        i.source =
          $("#source-name").value ||
          file.name
            .replace(/\.csv$/i, "")
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, "_");
        i.type = $("#import-type").value;
        i.preview = await api("/api/csv/preview", { text: i.text });
        if (i.preview.headers.includes("timestamp")) i.type = "events";
        i.mapping = i.preview.mapping;
        importView();
      } catch (e) {
        importError(e);
      }
    };
    $("#import-next").onclick = () => {
      i.source = $("#source-name").value.trim().toLowerCase();
      i.type = $("#import-type").value;
      if (!/^[a-z0-9_-]{1,50}$/.test(i.source))
        return importError(
          new Error(
            "Choose a source with 1–50 letters, numbers, underscores or hyphens",
          ),
        );
      i.mapping = i.mapping.map((m) => ({
        ...m,
        target:
          i.type === "people" && ["timestamp", "event_name"].includes(m.target)
            ? "trait"
            : m.target,
      }));
      i.step = 2;
      importView();
    };
  }
  if (i.step === 2) {
    document.querySelectorAll("[data-map-target]").forEach(
      (el) =>
        (el.onchange = () => {
          i.mapping[el.dataset.mapTarget].target = el.value;
          importView();
        }),
    );
    document
      .querySelectorAll("[data-map-name]")
      .forEach(
        (el) =>
          (el.oninput = () => (i.mapping[el.dataset.mapName].name = el.value)),
      );
    document
      .querySelectorAll("[data-map-type]")
      .forEach(
        (el) =>
          (el.onchange = () => (i.mapping[el.dataset.mapType].type = el.value)),
      );
    $("#import-review").onclick = async () => {
      const btn = $("#import-review");
      btn.disabled = true;
      btn.textContent = "Validating…";
      try {
        i.result = await api("/api/import", {
          ...importPayload(),
          dryRun: true,
        });
        i.step = 3;
        importView();
      } catch (e) {
        importError(e);
        btn.disabled = false;
        btn.textContent = "Validate mapping →";
      }
    };
  }
  if (i.step === 3)
    $("#import-commit").onclick = async () => {
      const btn = $("#import-commit");
      btn.disabled = true;
      btn.textContent = "Importing…";
      try {
        i.result = await api("/api/import", importPayload());
        i.step = 4;
        await refresh();
        importView();
      } catch (e) {
        importError(e);
        btn.disabled = false;
        btn.textContent = "Retry import";
      }
    };
  if ($("#import-back"))
    $("#import-back").onclick = () => {
      i.step--;
      importView();
    };
  if (i.step === 4) {
    $("#import-done").onclick = () => {
      close();
      state.segment = "";
      state.filter = "all";
      state.search = "";
      go("people");
    };
    if ($("#download-errors"))
      $("#download-errors").onclick = () => downloadErrors(i.result.errors);
  }
}
export function importPayload() {
  const { text, source, filename, type, mapping } = importState;
  return { text, source, filename, type, mapping };
}
export function importError(e) {
  $("#import-error").innerHTML =
    `<div class="notice error">${esc(e.message)}</div>`;
}
export function resultGrid(r) {
  return `<div class="review-grid">${[
    ["New profiles", r.created],
    ["Matched rows", r.updated],
    ["Profiles merged", r.merged],
    ["New events", r.events],
    ["Duplicate events", r.duplicates],
    ["Rejected rows", r.rejected],
  ]
    .map(
      ([s, n]) =>
        `<div class="review-stat"><strong>${num(n)}</strong><span>${s}</span></div>`,
    )
    .join("")}</div>`;
}
export function errorTable(errors) {
  return errors.length
    ? `<div class="table-scroll"><table><thead><tr><th>CSV RECORD</th><th>REASON</th></tr></thead><tbody>${errors
        .slice(0, 30)
        .map(
          (e) =>
            `<tr><td>${e.line}</td><td class="error-text">${esc(e.message)}</td></tr>`,
        )
        .join(
          "",
        )}</tbody></table></div>${errors.length > 30 ? '<p class="hint">Showing the first 30 rejected rows.</p>' : ""}`
    : "";
}
export function downloadErrors(errors) {
  const value = [
    "record,message",
    ...errors.map((e) => `${e.line},"${e.message.replaceAll('"', '""')}"`),
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([value], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "import-errors.csv";
  a.click();
  URL.revokeObjectURL(url);
}
export async function importDetail(id) {
  const i = state.data.imports.find((i) => i.id === id);
  modal(
    "Import details",
    `<div class="modal-body"><h3>${esc(i.filename)}</h3><p class="hint">${esc(i.source)} · ${esc(i.type)} · ${date(i.created_at)}</p>${resultGrid(i.result)}<h3>Saved mapping</h3><div class="table-scroll"><table><thead><tr><th>COLUMN</th><th>DESTINATION</th><th>TYPE</th></tr></thead><tbody>${i.mapping.map((m) => `<tr><td>${esc(m.column)}</td><td>${esc(m.target === "trait" ? `${i.source}/${m.name}` : m.target)}</td><td>${esc(m.type)}</td></tr>`).join("")}</tbody></table></div>${errorTable(i.result.errors)}</div>`,
    `<span class="hint">${i.result.rows} rows processed</span>${i.result.errors.length ? '<button class="button" id="history-errors">Download errors</button>' : ""}`,
  );
  if ($("#history-errors"))
    $("#history-errors").onclick = () => downloadErrors(i.result.errors);
}
