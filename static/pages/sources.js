import { $, esc, num, date, sourceName, state, heading } from "../shared.js";

export function sources() {
  const imports = state.data.imports;
  $("#main").innerHTML =
    heading(
      "Sources & imports",
      "Bring data together. Every import keeps its own attribute namespace.",
      `<button class="button primary" data-action="import">＋ Import CSV</button>`,
    ) +
    `<div class="segment-grid">${[...new Set(imports.map((i) => i.source))]
      .map((s) => {
        const group = imports.filter((i) => i.source === s);
        return `<div class="card"><div class="source-icon">⇄</div><h2 style="margin-top:20px">${esc(sourceName(s))}</h2><p class="hint">Namespace: ${esc(s)}/</p><div class="stat-number">${num(group.reduce((n, i) => n + i.result.rows, 0))}</div><div class="hint">Rows processed across ${group.length} imports</div><div style="margin-top:20px"><span class="badge">CSV source</span></div></div>`;
      })
      .join(
        "",
      )}</div><section class="panel" style="margin-top:26px"><div class="panel-head"><h2>Import history</h2><span class="hint">Newest first</span></div><div class="table-scroll"><table><thead><tr><th>FILE / SOURCE</th><th>IMPORTED</th><th>ROWS</th><th>CREATED / UPDATED</th><th>EVENTS</th><th>RESULT</th></tr></thead><tbody>${imports.map((i) => `<tr class="clickable" data-import-detail="${i.id}"><td><strong>${esc(i.filename)}</strong><div class="hint">${esc(i.source)} · ${esc(i.type)}</div></td><td>${date(i.created_at)}</td><td>${num(i.result.rows)}</td><td>${num(i.result.created)} / ${num(i.result.updated)}</td><td>${num(i.result.events)}</td><td><span class="badge ${i.result.rejected ? "gray" : ""}">${i.result.rejected ? `${num(i.result.rejected)} rejected` : "Complete"}</span></td></tr>`).join("")}</tbody></table></div></section>`;
}
