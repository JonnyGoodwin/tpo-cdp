import { $, esc, num, date, state, heading } from "../shared.js";

export function attributes() {
  const fields = state.data.fields;
  $("#main").innerHTML =
    heading(
      "Attributes",
      "Source-specific traits make it clear where each piece of data came from.",
    ) +
    `<section class="panel"><div class="panel-head"><h2>Profile schema</h2><span class="badge gray">${fields.length} attributes</span></div><div class="table-scroll"><table><thead><tr><th>ATTRIBUTE</th><th>SOURCE</th><th>TYPE</th><th>POPULATED PROFILES</th><th>EXAMPLE</th></tr></thead><tbody>${fields
      .map((f) => {
        const list = state.data.profiles.filter((p) => p.traits[f] != null),
          v = list[0]?.traits[f];
        return `<tr><td><strong>${esc(f.split("/").slice(1).join("/"))}</strong></td><td><span class="badge gray">${esc(f.split("/")[0])}</span></td><td>${typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? "date" : typeof v}</td><td>${num(list.length)} <span class="hint">(${Math.round((list.length / state.data.stats.people) * 100)}%)</span></td><td>${esc(v)}</td></tr>`;
      })
      .join(
        "",
      )}</tbody></table></div></section><p class="hint">Email, external IDs, and visitor IDs are stored as identities. Event properties live on the event timeline.</p>`;
}
