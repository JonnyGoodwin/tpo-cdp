export const $ = (s, root = document) => root.querySelector(s);
export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const num = (v) => Number(v).toLocaleString();
export const date = (v) =>
  v
    ? new Date(v).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
export const initials = (p) =>
  p.email ? p.email.slice(0, 2).toUpperCase() : "AN";
export const displayName = (p) =>
  p.name ||
  (p.email
    ? p.email
        .split("@")[0]
        .replace(/[._\d]+/g, " ")
        .trim()
        .replace(/\b\w/g, (s) => s.toUpperCase())
    : "Anonymous visitor");
export const sourceName = (s) =>
  ({
    subscribers: "Newsletter subscribers",
    app: "App users",
    web: "Website activity",
  })[s] || s.replaceAll("_", " ");
export const state = {
  data: null,
  view: "overview",
  search: "",
  segment: "",
  page: 1,
  selected: new Set(),
};
export async function api(path, body, method = "POST") {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
export function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.style.display = "none"), 4000);
}
export function modal(title, content, footer = "", wide = false) {
  $("#overlay").innerHTML =
    `<div class="overlay-backdrop"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="close" data-action="close" aria-label="Close dialog">×</button></div>${content}${footer ? `<div class="modal-footer">${footer}</div>` : ""}</section></div>`;
  $("#overlay .close")?.focus();
}
export function close() {
  $("#overlay").innerHTML = "";
}
export async function refresh() {
  state.data = await api("/api/state");
  $("#nav-count").textContent = num(state.data.stats.people);
  await loadSegmentIds();
  renderPage();
}
export function go(view) {
  state.view = view;
  history.pushState({}, "", pageRoutes[view]);
  state.page = 1;
  state.selected.clear();
  renderPage();
}
export const heading = (title, sub, actions = "") =>
  `<div class="page-head"><div><h1>${title}</h1><div class="subtitle">${sub}</div></div>${actions}</div>`;
export async function loadSegmentIds() {
  const segmentId = state.segment;
  const s = state.data.segments.find((s) => s.id === segmentId);
  if (!s) {
    state.segmentIds = null;
    return;
  }
  const { ids } = await api("/api/segments/preview", s.definition);
  // A slower response from an earlier selection must not replace the current audience.
  if (state.segment === segmentId) state.segmentIds = new Set(ids);
}

let renderPage;
export function configureRenderer(render) {
  renderPage = render;
}

export const pageRoutes = {
  overview: "/",
  people: "/people",
  segments: "/segments",
  sources: "/sources",
  attributes: "/attributes",
  connections: "/connections",
  assistant: "/assistant",
};
export function viewFromPath(path) {
  return (
    Object.keys(pageRoutes).find((view) => pageRoutes[view] === path) ||
    "overview"
  );
}
export function personCell(p) {
  return `<div class="person-cell"><span class="avatar ${p.email ? "green" : ""}">${esc(initials(p))}</span><div><strong>${esc(displayName(p))}</strong><small>${esc(p.email || p.identities.find((i) => i.kind === "anonymous_id")?.value || p.id)}</small></div></div>`;
}
