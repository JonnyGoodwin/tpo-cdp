import {
  $,
  esc,
  num,
  state,
  api,
  modal,
  close,
  refresh,
  toast,
} from "../shared.js";
import { templates } from "./connection-templates.js";
export function editConnection(existing) {
  const template = templates.custom;
  modal(
    existing ? "Edit connection" : "New connection",
    `<div class="modal-body connection-editor">
    <div class="form-grid"><div class="field"><label for="connection-name">Connection name</label><input id="connection-name" value="${esc(existing?.name || "")}" placeholder="e.g. Sync newsletter subscribers"></div><div class="field"><label for="connection-template">Start from a template</label><select id="connection-template">${Object.entries(
      templates,
    )
      .map(([key, t]) => `<option value="${key}">${esc(t.label)}</option>`)
      .join("")}</select></div></div>
    <div class="field"><label for="connection-namespace">Source namespace</label><input id="connection-namespace" value="${esc(existing?.namespace || template.namespace)}" placeholder="e.g. pdl"><p class="hint">Returned traits are saved under this source, for example pdl/job_title.</p></div>
    <div class="field"><label for="connection-code">JavaScript function body</label><textarea id="connection-code" class="code-editor" spellcheck="false">${esc(existing?.code || template.code)}</textarea></div>
    <p class="hint">Receives <code>user</code> and <code>context</code>. Use <code>context.fetch</code> for requests, <code>context.settings</code> for keys, and return <code>{ traits: { ... } }</code> to enrich the profile.</p>
    <div class="field"><label for="connection-settings">Settings and API keys (JSON)</label><textarea id="connection-settings" class="settings-editor" spellcheck="false" placeholder='{"API_KEY":"your key"}'>${existing ? "" : esc(JSON.stringify(template.settings, null, 2))}</textarea></div>
    ${existing ? `<p class="hint">Saved keys: ${esc(existing.settingKeys.join(", ") || "none")}. Leave blank to keep saved values. Enter JSON to replace them.</p>` : ""}
    <div class="field"><label for="connection-audience">Audience</label><select id="connection-audience"><option value="">Manual pushes only</option>${state.data.segments.map((s) => `<option value="${s.id}" ${existing?.segment_id === s.id ? "selected" : ""}>${esc(s.name)} (${num(s.count)} people)</option>`).join("")}</select></div>
    <p><label><input type="checkbox" id="connection-enabled" ${existing?.enabled ? "checked" : ""}> Run automatically whenever someone joins this audience</label></p>
    <p><label><input type="checkbox" id="connection-backfill"> Also push the current audience when I save</label></p>
    <p class="hint">Automatic triggers apply to future entries. Calls run while the app server is running.</p><div id="connection-error"></div>
  </div>`,
    `<div>${existing ? '<button class="button danger" id="delete-connection">Delete connection</button>' : ""}</div><button class="button primary" id="save-connection">Save connection</button>`,
    true,
  );
  $("#connection-template").onchange = (e) => {
    const t = templates[e.target.value];
    $("#connection-code").value = t.code;
    $("#connection-namespace").value = t.namespace;
    $("#connection-settings").value = JSON.stringify(t.settings, null, 2);
    if (!existing) $("#connection-name").value = t.label;
  };
  $("#save-connection").onclick = async () => {
    const button = $("#save-connection");
    button.disabled = true;
    try {
      const segmentId = $("#connection-audience").value;
      const backfill = $("#connection-backfill").checked;
      if (backfill && !segmentId)
        throw new Error("Select an audience to push its current members");
      const settingsText = $("#connection-settings").value.trim();
      const { id } = await api("/api/connections", {
        id: existing?.id,
        name: $("#connection-name").value,
        code: $("#connection-code").value,
        segmentId,
        namespace: $("#connection-namespace").value,
        enabled: $("#connection-enabled").checked,
        ...(settingsText ? { settings: JSON.parse(settingsText) } : {}),
      });
      if (backfill) {
        const segment = state.data.segments.find((s) => s.id === segmentId);
        const { ids } = await api("/api/segments/preview", segment.definition);
        if (ids.length) await api(`/api/connections/${id}/push`, { ids });
      }
      close();
      await refresh();
      toast("Connection saved");
    } catch (error) {
      $("#connection-error").innerHTML =
        `<div class="notice error">${esc(error.message)}</div>`;
      button.disabled = false;
    }
  };
  if (existing)
    $("#delete-connection").onclick = async () => {
      try {
        await api(`/api/connections/${existing.id}`, {}, "DELETE");
        close();
        await refresh();
        toast("Connection deleted");
      } catch (error) {
        toast(error.message);
      }
    };
}
export async function pushPeople(ids) {
  try {
    if (!ids.length) return toast("No people to push");
    const { connections } = await api("/api/connections");
    if (!connections.length) return toast("Create a Connection first");
    modal(
      "Push to a Connection",
      `<div class="modal-body"><p>Queue a function call for each of these <strong>${num(ids.length)} people</strong>.</p><div class="field"><label for="push-connection">Connection</label><select id="push-connection">${connections.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div><div id="push-error"></div></div>`,
      `<span class="hint">This runs the saved function for each person.</span><button class="button primary" id="queue-push">Push ${num(ids.length)} people</button>`,
    );
    $("#queue-push").onclick = async () => {
      $("#queue-push").disabled = true;
      try {
        const { runs } = await api(
          `/api/connections/${$("#push-connection").value}/push`,
          { ids },
        );
        close();
        toast(`Queued ${num(runs.length)} function calls`);
      } catch (error) {
        $("#push-error").textContent = error.message;
        $("#queue-push").disabled = false;
      }
    };
  } catch (error) {
    toast(error.message);
  }
}
export async function showRuns(id) {
  try {
    const { runs, counts } = await api(`/api/connections/${id}/runs`);
    modal(
      "Connection run history",
      `<div class="modal-body"><p class="hint">${counts.map((c) => `${num(c.count)} ${esc(c.status)}`).join(" · ") || "No runs yet"}</p><div class="table-scroll"><table><thead><tr><th>PERSON</th><th>TRIGGER</th><th>STATUS</th><th>RESULT</th></tr></thead><tbody>${runs.map((r) => `<tr><td>${esc(r.email || r.person_id)}</td><td>${esc(r.trigger === "manual" ? "Manual push" : "Joined audience")}</td><td><span class="badge ${r.status === "failed" ? "gray" : ""}">${esc(r.status)}</span><small>${esc(new Date(r.created_at).toLocaleString())}</small></td><td><pre class="run-result">${esc(r.error || (r.result ? JSON.stringify(r.result, null, 2) : "Waiting to run"))}</pre></td></tr>`).join("") || '<tr><td colspan="4">No calls yet. Push people or enable an audience trigger.</td></tr>'}</tbody></table></div><p class="hint">Showing the latest 100 calls. Failed calls are kept here; pushing again creates a new call.</p></div>`,
      `<span class="hint">Runs are saved across restarts</span><button class="button" id="refresh-runs">Refresh history</button>`,
      true,
    );
    $("#refresh-runs").onclick = () => showRuns(id);
  } catch (error) {
    toast(error.message);
  }
}
