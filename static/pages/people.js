import {
  $,
  esc,
  num,
  date,
  state,
  heading,
  loadSegmentIds,
  personCell,
} from "../shared.js";

export function filtered() {
  let list = state.data.profiles.filter(
    (p) =>
      !state.search ||
      [p.email, p.name, ...p.identities.map((i) => i.value)].some((v) =>
        String(v || "")
          .toLowerCase()
          .includes(state.search.toLowerCase()),
      ),
  );
  if (state.filter === "known") list = list.filter((p) => p.email);
  if (state.filter === "anonymous") list = list.filter((p) => !p.email);
  if (state.filter === "subscribers")
    list = list.filter((p) => p.traits["subscribers/status"] === "active");
  if (state.filter === "app")
    list = list.filter((p) => p.traits["app/created_at"]);
  const segment = state.data.segments.find((s) => s.id === state.segment);
  if (segment) list = list.filter((p) => state.segmentIds?.has(p.id));
  return list;
}

export function people() {
  const list = filtered(),
    pageSize = 25,
    pages = Math.max(1, Math.ceil(list.length / pageSize));
  state.page = Math.min(state.page, pages);
  const rows = list.slice((state.page - 1) * pageSize, state.page * pageSize);
  const chosen = state.data.segments.find((s) => s.id === state.segment);
  $("#main").innerHTML =
    heading(
      chosen ? esc(chosen.name) : "People",
      `${num(list.length)} profiles · Understand every person in your audience.`,
      `<div><button class="button" data-action="export">↓ Export CSV${state.selected.size ? ` (${state.selected.size})` : ""}</button> <button class="button primary" data-action="segment">＋ Create segment</button></div>`,
    ) +
    `<section class="panel"><div class="tabs">${[
      ["all", "All people"],
      ["known", "Identified"],
      ["anonymous", "Anonymous"],
      ["subscribers", "Subscribers"],
      ["app", "App users"],
    ]
      .map(
        ([k, label]) =>
          `<button class="${state.filter === k ? "active" : ""}" data-filter="${k}">${label}</button>`,
      )
      .join(
        "",
      )}</div><div class="toolbar"><div class="search"><input id="people-search" placeholder="Search by email, name, or identity…" value="${esc(state.search)}" aria-label="Search people"></div><select id="segment-filter" aria-label="Filter by segment"><option value="">All segments</option>${state.data.segments.map((s) => `<option value="${s.id}" ${state.segment === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>${chosen ? `<button class="button small" data-edit-segment="${chosen.id}">Edit conditions</button>` : ""}</div><div class="table-scroll"><table><thead><tr><th><input type="checkbox" id="select-page" aria-label="Select page" ${rows.length && rows.every((p) => state.selected.has(p.id)) ? "checked" : ""}></th><th>PERSON</th><th>STATUS</th><th>SOURCES</th><th>EVENTS</th><th>LAST SEEN</th></tr></thead><tbody>${
      rows
        .map((p) => {
          const sources = [
            ...new Set([
              ...Object.keys(p.traits).map((k) => k.split("/")[0]),
              ...p.identities
                .filter((i) => i.kind !== "email")
                .map((i) => i.value.split(":")[0]),
            ]),
          ];
          return `<tr class="clickable" data-profile="${p.id}"><td><input type="checkbox" data-select="${p.id}" aria-label="Select ${esc(p.email || "anonymous visitor")}" ${state.selected.has(p.id) ? "checked" : ""}></td><td>${personCell(p)}</td><td><span class="badge ${p.traits["subscribers/status"] === "active" ? "" : p.email ? "blue" : "gray"}">${esc(p.traits["subscribers/status"] || (p.email ? "Identified" : "Anonymous"))}</span></td><td>${sources.map((s) => `<span class="badge gray">${esc(s)}</span>`).join(" ")}</td><td>${num(p.event_count)}</td><td>${date(p.last_seen)}</td></tr>`;
        })
        .join("") ||
      '<tr><td colspan="6" class="empty">No profiles match these filters.</td></tr>'
    }</tbody></table></div><div class="pagination"><span>${list.length ? `${num((state.page - 1) * pageSize + 1)}–${num(Math.min(state.page * pageSize, list.length))}` : "0"} of ${num(list.length)} people</span><div><button class="button small" data-action="prev-page" ${state.page === 1 ? "disabled" : ""}>←</button><span>Page ${state.page} of ${num(pages)}</span><button class="button small" data-action="next-page" ${state.page === pages ? "disabled" : ""}>→</button></div></div></section>`;
  $("#people-search").addEventListener("input", (e) => {
    const pos = e.target.selectionStart;
    state.search = e.target.value;
    state.page = 1;
    people();
    $("#people-search").focus();
    $("#people-search").setSelectionRange(pos, pos);
  });
  $("#segment-filter").addEventListener("change", async (e) => {
    state.segment = e.target.value;
    state.page = 1;
    await loadSegmentIds();
    people();
  });
  $("#select-page").addEventListener("change", (e) => {
    rows.forEach((p) =>
      e.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id),
    );
    people();
  });
}
