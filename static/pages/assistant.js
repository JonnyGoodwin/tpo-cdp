import {
  $,
  esc,
  num,
  api,
  modal,
  close,
  refresh,
  go,
  heading,
  state,
} from "../shared.js";
let previousResults = [];
let draft = "";
const examples = [
  "How many Instagram signups went cold last month?",
  "Build me a list of our most engaged readers",
  "Which pages do new subscribers hit first?",
];
function resultMarkup(result, index) {
  if (result.clarification)
    return `<section class="panel assistant-answer"><h2>A quick clarification</h2><p>${esc(result.clarification)}</p>${result.suggestion ? `<button class="button" data-assistant-suggestion="${index}">Use this definition</button>` : ""}</section>`;
  return `<section class="panel assistant-answer"><div class="panel-head"><h2>${esc(result.summary)}</h2>${result.report_id ? `<button class="button primary" data-assistant-save="${index}">Save as segment</button>` : ""}</div><div class="panel-body"><p class="hint">As of ${esc(new Date(result.as_of).toLocaleString())} · ${result.planner === "openai" ? "AI plan, local calculation" : "Local plan and calculation"}</p>${result.rows.length ? `<div class="table-scroll"><table><thead><tr>${result.columns.map((column) => `<th>${esc(column.replaceAll("_", " "))}</th>`).join("")}</tr></thead><tbody>${result.rows.map((row) => `<tr>${result.columns.map((column) => `<td>${esc(typeof row[column] === "number" ? num(row[column]) : row[column])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}<details open><summary>How this was calculated</summary><ul>${result.assumptions.map((assumption) => `<li>${esc(assumption)}</li>`).join("")}</ul></details><details><summary>What the AI received</summary><p>No customer records, results, names, emails, IDs, or page URLs are sent to the model.</p><pre>${esc(result.model_context || "Nothing. This query was planned locally.")}</pre></details></div></section>`;
}
export function assistant() {
  $("#main").innerHTML =
    heading(
      "Growth assistant",
      "Ask a question. Get a count, a table, or an audience you can save.",
    ) +
    `<div class="notice">Customer data stays local. AI can only receive approved query concepts—not profiles or your raw question.</div><div class="assistant-examples">${examples.map((example, index) => `<button class="card" data-assistant-example="${index}">${esc(example)}</button>`).join("")}</div><section class="panel assistant-compose"><form id="assistant-form"><label for="assistant-question">What would you like to know?</label><textarea id="assistant-question" rows="3" maxlength="1000" placeholder="Ask about your signups, readers, or first visits…">${esc(draft)}</textarea><div class="assistant-compose-footer"><span class="hint" id="assistant-mode">Checking planner…</span><button class="button primary" id="ask-assistant" type="submit">Ask</button></div></form><div id="assistant-error"></div></section><div id="assistant-results">${previousResults.map(resultMarkup).join("")}</div>`;
  $("#assistant-question").oninput = (e) => {
    draft = e.target.value;
  };
  document.querySelectorAll("[data-assistant-example]").forEach(
    (button) =>
      (button.onclick = () => {
        $("#assistant-question").value =
          examples[Number(button.dataset.assistantExample)];
        draft = $("#assistant-question").value;
        $("#assistant-question").focus();
      }),
  );
  api("/api/assistant/status")
    .then((status) => {
      if (state.view === "assistant" && $("#assistant-mode"))
        $("#assistant-mode").textContent = status.aiConfigured
          ? "AI planning enabled"
          : "Local planning · AI not configured";
    })
    .catch(() => {
      if ($("#assistant-mode"))
        $("#assistant-mode").textContent = "Planner status unavailable";
    });
  $("#assistant-form").onsubmit = async (e) => {
    e.preventDefault();
    const button = $("#ask-assistant");
    button.disabled = true;
    button.textContent = "Working…";
    $("#assistant-error").textContent = "";
    try {
      const result = await api("/api/assistant/ask", {
        question: $("#assistant-question").value,
      });
      previousResults.unshift(result);
      previousResults = previousResults.slice(0, 10);
      if (state.view === "assistant") {
        $("#assistant-results").innerHTML = previousResults
          .map(resultMarkup)
          .join("");
        bindResultActions();
      }
    } catch (error) {
      if ($("#assistant-error"))
        $("#assistant-error").textContent = error.message;
    } finally {
      if ($("#ask-assistant")) {
        $("#ask-assistant").disabled = false;
        $("#ask-assistant").textContent = "Ask";
      }
    }
  };
  bindResultActions();
}
function bindResultActions() {
  document.querySelectorAll("[data-assistant-suggestion]").forEach(
    (button) =>
      (button.onclick = () => {
        const result =
          previousResults[Number(button.dataset.assistantSuggestion)];
        draft = result.suggestion;
        $("#assistant-question").value = draft;
        $("#assistant-form").requestSubmit();
      }),
  );
  document.querySelectorAll("[data-assistant-save]").forEach(
    (button) =>
      (button.onclick = () => {
        const result = previousResults[Number(button.dataset.assistantSave)];
        modal(
          "Save audience as a segment",
          `<div class="modal-body"><p>${num(result.count)} subscribers matched this preview. The saved segment will update as your data changes.</p><div class="field"><label for="assistant-segment-name">Segment name</label><input id="assistant-segment-name" placeholder="e.g. Engaged readers"></div><div id="assistant-save-error"></div></div>`,
          `<button class="button" data-action="close">Cancel</button><button class="button primary" id="assistant-save-confirm">Save segment</button>`,
        );
        $("#assistant-save-confirm").onclick = async () => {
          const saveButton = $("#assistant-save-confirm");
          saveButton.disabled = true;
          try {
            await api("/api/assistant/segments", {
              report_id: result.report_id,
              name: $("#assistant-segment-name").value,
            });
            result.report_id = null;
            close();
            await refresh();
            go("segments");
          } catch (error) {
            $("#assistant-save-error").textContent = error.message;
            saveButton.disabled = false;
          }
        };
      }),
  );
}
