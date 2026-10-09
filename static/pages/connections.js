import { $, esc, state, api, heading, toast } from "../shared.js";
import { editConnection, showRuns } from "../dialogs/connections.js";
export async function connections() {
  $("#main").innerHTML =
    heading(
      "Connections",
      "Run a function when someone joins an audience.",
      '<button class="button primary" id="new-connection">＋ New connection</button>',
    ) + '<div class="loading">Loading connections…</div>';
  $("#new-connection").onclick = () => editConnection();
  try {
    const { connections: items } = await api("/api/connections");
    if (state.view !== "connections") return;
    $("#main .loading").outerHTML = items.length
      ? `<div class="segment-grid">${items.map((c) => `<section class="card"><span class="source-icon">⌘</span><h2 style="margin:20px 0 10px">${esc(c.name)}</h2><span class="badge ${c.enabled ? "" : "gray"}">${c.enabled ? "Automatic trigger on" : "Automatic trigger off"}</span><p class="hint">Audience: ${esc(c.segment_name || "Manual pushes only")}</p><div class="connection-actions"><button class="button small" data-connection-edit="${c.id}">Edit function</button><button class="button small" data-connection-runs="${c.id}">Run history</button></div></section>`).join("")}</div>`
      : '<section class="panel empty"><h2>Connect your audience to the tools you use</h2><p>Start with a custom function, Beehiiv, or People Data Labs.</p><p>Choose an audience to run automatically for new members, or push people manually from the People page.</p></section>';
    document
      .querySelectorAll("[data-connection-edit]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            editConnection(
              items.find((c) => c.id === b.dataset.connectionEdit),
            )),
      );
    document
      .querySelectorAll("[data-connection-runs]")
      .forEach((b) => (b.onclick = () => showRuns(b.dataset.connectionRuns)));
  } catch (error) {
    toast(error.message);
  }
}
