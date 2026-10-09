import { connections } from "./pages/connections.js";
import { pushPeople } from "./dialogs/connections.js";
import {
  $,
  esc,
  state,
  toast,
  close,
  refresh,
  go,
  loadSegmentIds,
  configureRenderer,
  viewFromPath,
} from "./shared.js";
import { overview } from "./pages/overview.js";
import { people, filtered } from "./pages/people.js";
import { segments } from "./pages/segments.js";
import { sources } from "./pages/sources.js";
import { attributes } from "./pages/attributes.js";
import { profile } from "./dialogs/profile.js";
import { openImport, importDetail } from "./dialogs/imports.js";
import { openBuilder } from "./dialogs/segment-builder.js";
function render() {
  const names = {
    overview: "Overview",
    people: "People",
    segments: "Segments",
    sources: "Sources & imports",
    attributes: "Attributes",
    connections: "Connections",
  };
  $("#breadcrumb").innerHTML = `Workspace <b>/</b> ${names[state.view]}`;
  document
    .querySelectorAll("#nav [data-view]")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.view === state.view),
    );
  ({
    overview: overview,
    people: people,
    segments: segments,
    sources: sources,
    attributes: attributes,
    connections,
  })[state.view]();
}

configureRenderer(render);
state.view = viewFromPath(location.pathname);
window.addEventListener("popstate", () => {
  state.view = viewFromPath(location.pathname);
  state.page = 1;
  state.selected.clear();
  render();
});
document.addEventListener("click", async (e) => {
  const button = e.target.closest("button, a[data-view]");
  if (e.target.closest("[data-select]")) {
    e.stopPropagation();
    return;
  }
  if (button?.dataset.view) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(button.dataset.view);
    return;
  }
  if (button?.dataset.action) {
    const action = button.dataset.action;
    if (action === "close") close();
    if (action === "import") openImport();
    if (action === "segment") openBuilder();
    if (action === "prev-page") {
      state.page--;
      people();
    }
    if (action === "next-page") {
      state.page++;
      people();
    }
    if (action === "push")
      await pushPeople(
        state.selected.size ? [...state.selected] : filtered().map((p) => p.id),
      );
    if (action === "export") {
      const ids = state.selected.size
        ? [...state.selected]
        : filtered().map((p) => p.id);
      if (!ids.length) return toast("No profiles to export");
      try {
        const response = await fetch("/api/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!response.ok) throw new Error("Export failed");
        const url = URL.createObjectURL(await response.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = "people.csv";
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        toast(e.message);
      }
    }
    return;
  }
  const edit = e.target.closest("[data-edit-segment]");
  if (edit) {
    openBuilder(edit.dataset.editSegment);
    return;
  }
  const segment = e.target.closest("[data-show-segment]");
  if (segment) {
    state.segment = segment.dataset.showSegment;
    state.search = "";
    await loadSegmentIds();
    go("people");
    return;
  }
  const person = e.target.closest("[data-profile]");
  if (person) {
    profile(person.dataset.profile);
    return;
  }
  const detail = e.target.closest("[data-import-detail]");
  if (detail) {
    importDetail(detail.dataset.importDetail);
    return;
  }
  if (e.target.classList.contains("overlay-backdrop")) close();
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.select) {
    e.target.checked
      ? state.selected.add(e.target.dataset.select)
      : state.selected.delete(e.target.dataset.select);
    people();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") close();
  if (e.key === "Tab" && $('#overlay [role="dialog"]')) {
    const els = [
      ...$("#overlay").querySelectorAll(
        "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
      ),
    ];
    const first = els[0],
      last = els.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
});
$("#global-import").onclick = openImport;
refresh().catch((e) => {
  $("#main").innerHTML =
    `<div class="notice error">Could not load workspace: ${esc(e.message)}. Refresh to retry.</div>`;
});
