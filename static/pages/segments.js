import { $, esc, num, state, heading } from "../shared.js";

export function segments() {
  $("#main").innerHTML =
    heading(
      "Segments",
      "Build live audiences from attributes and activity.",
      `<button class="button primary" data-action="segment">＋ Create segment</button>`,
    ) +
    `<div class="segment-grid">${state.data.segments.map((s) => `<section class="card segment-card" data-show-segment="${s.id}"><span class="source-icon">◎</span><h2 style="margin-top:20px">${esc(s.name)}</h2><div class="count">${num(s.count)}</div><div class="subtitle">people in this audience</div><span class="badge">Live segment</span><footer><span>${s.definition.mode === "any" ? "Any" : "All"} of ${s.definition.rules.length} conditions</span><button class="link" data-edit-segment="${s.id}">Edit →</button></footer></section>`).join("") || '<div class="empty">Create a segment to group your audience.</div>'}</div>`;
}
