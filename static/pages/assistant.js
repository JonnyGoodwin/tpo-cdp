import {
  $,
  num,
  api,
  modal,
  close,
  refresh,
  go,
  heading,
  state,
  esc,
} from "../shared.js";
import { openImport } from "../dialogs/imports.js";
import { examples, messageMarkup } from "./assistant-chat.js";
const welcome = () => ({
  role: "assistant",
  text: "Hi! What are you working on today? I can help you understand your audience, build a segment, or upload a new list. Ask a question below to get started.",
  actions: ["upload"],
});
let messages = [welcome()];
let draft = "";
let context;
let busy = false;
function addMessage(message) {
  messages.push(message);
  messages = messages.slice(-60);
  renderMessages();
}
function renderMessages() {
  if (state.view !== "assistant" || !$("#assistant-results")) return;
  const log = $("#assistant-results");
  log.innerHTML =
    messages.map(messageMarkup).join("") +
    (busy
      ? '<div class="chat-message chat-assistant chat-pending" role="status">Working on that…</div>'
      : "");
  bindActions();
  log.scrollTop = log.scrollHeight;
}
function setBusy(value) {
  busy = value;
  if (state.view !== "assistant") return;
  $("#ask-assistant").disabled = value;
  $("#ask-assistant").textContent = value ? "Working…" : "Send";
  document
    .querySelectorAll(
      "[data-chat-example], [data-chat-suggestion], [data-chat-upload], [data-chat-followup], #assistant-new-chat",
    )
    .forEach((button) => (button.disabled = value));
}
async function sendMessage(question) {
  if (busy || !question.trim()) return;
  draft = "";
  if ($("#assistant-question")) $("#assistant-question").value = "";
  busy = true;
  addMessage({ role: "user", text: question });
  setBusy(true);
  try {
    const result = await api("/api/assistant/ask", {
      question,
      ...(context ? { context } : {}),
    });
    if (result.plan) context = result.plan;
    addMessage({ role: "assistant", result });
  } catch (error) {
    addMessage({ role: "assistant", text: error.message });
  } finally {
    setBusy(false);
    renderMessages();
    if (state.view === "assistant") $("#assistant-question")?.focus();
  }
}
export function assistant() {
  $("#main").innerHTML =
    heading(
      "Growth assistant",
      "Explore your audience together, one question at a time.",
      '<button class="button" id="assistant-new-chat">New chat</button>',
    ) +
    `<section class="panel assistant-chat"><div class="chat-intro"><span>Conversation</span><span class="hint">Your customer data stays local</span></div><div id="assistant-results" class="chat-thread" role="log" aria-label="Growth assistant conversation" aria-live="polite" aria-relevant="additions"></div><div class="chat-starters">${examples.map((example, index) => `<button class="button small" data-chat-example="${index}">${esc(example)}</button>`).join("")}</div><form id="assistant-form" class="assistant-compose"><label for="assistant-question">Message Growth assistant</label><textarea id="assistant-question" rows="2" maxlength="1000" placeholder="Ask a question or follow up on the last answer…">${esc(draft)}</textarea><div class="assistant-compose-footer"><button class="button small" type="button" data-chat-upload>Upload a list</button><span class="hint">Enter to send · Shift+Enter for a new line</span><button class="button primary" id="ask-assistant" type="submit">Send</button></div><details class="chat-privacy"><summary>Privacy & planning</summary><p>Raw questions, conversation history, and uploaded lists stay local. AI receives only approved query concepts.</p><span id="assistant-mode">Checking planner…</span></details></form></section>`;
  $("#assistant-question").oninput = (e) => (draft = e.target.value);
  $("#assistant-question").onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $("#assistant-form").requestSubmit();
    }
  };
  $("#assistant-form").onsubmit = (e) => {
    e.preventDefault();
    sendMessage($("#assistant-question").value);
  };
  $("#assistant-new-chat").onclick = () => {
    if (busy) return;
    messages = [welcome()];
    context = undefined;
    draft = "";
    assistant();
    $("#assistant-question").focus();
  };
  document
    .querySelectorAll("[data-chat-example]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          sendMessage(examples[Number(button.dataset.chatExample)])),
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
  renderMessages();
  setBusy(busy);
}
function uploadList() {
  if (busy) return;
  openImport({
    onComplete: (result) => {
      addMessage({
        role: "assistant",
        text: `Your list is imported. ${num(result.created)} new profiles, ${num(result.updated)} matched rows, and ${num(result.events)} new events. ${result.rejected ? `${num(result.rejected)} rows were skipped; you can review them in import history.` : "All rows passed validation."} What would you like to explore next?`,
        people: true,
      });
      if (state.view === "assistant") $("#assistant-question")?.focus();
    },
  });
}
function bindActions() {
  document
    .querySelectorAll("[data-chat-upload]")
    .forEach((button) => (button.onclick = uploadList));
  document.querySelectorAll("[data-chat-people]").forEach(
    (button) =>
      (button.onclick = () => {
        state.segment = "";
        state.search = "";
        go("people");
      }),
  );
  document
    .querySelectorAll("[data-chat-segment]")
    .forEach((button) => (button.onclick = () => go("segments")));
  document
    .querySelectorAll("[data-chat-suggestion]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          sendMessage(
            messages[Number(button.dataset.chatSuggestion)].result.suggestion,
          )),
    );
  document.querySelectorAll("[data-chat-followup]").forEach(
    (button) =>
      (button.onclick = () => {
        if (busy) return;
        context = messages[Number(button.dataset.chatFollowup)].result.plan;
        addMessage({
          role: "assistant",
          text: `Let's refine that result: ${context.channel === "all" ? "all channels" : context.channel}, ${context.period.replaceAll("_", " ")}${context.min_reads ? `, at least ${context.min_reads} reads` : ""}${context.cold_days ? `, cold for ${context.cold_days} days` : ""}. What would you like to change?`,
        });
        $("#assistant-question").focus();
      }),
  );
  document
    .querySelectorAll("[data-chat-save]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          saveSegment(messages[Number(button.dataset.chatSave)].result)),
    );
}
function saveSegment(result) {
  modal(
    "Save audience as a segment",
    `<div class="modal-body"><p>${num(result.count)} subscribers matched this preview. The segment will update as your data changes.</p><div class="field"><label for="assistant-segment-name">Segment name</label><input id="assistant-segment-name" placeholder="e.g. Engaged readers"></div><div id="assistant-save-error"></div></div>`,
    '<button class="button" data-action="close">Cancel</button><button class="button primary" id="assistant-save-confirm">Save segment</button>',
  );
  $("#assistant-save-confirm").onclick = async () => {
    const saveButton = $("#assistant-save-confirm");
    saveButton.disabled = true;
    const name = $("#assistant-segment-name").value;
    try {
      const saved = await api("/api/assistant/segments", {
        report_id: result.report_id,
        name,
      });
      result.report_id = null;
      close();
      addMessage({
        role: "assistant",
        text: `Saved “${name.trim()}” as a live segment. You can use it in People or attach a Connection.`,
        segmentId: saved.id,
      });
      await refresh();
    } catch (error) {
      if ($("#assistant-save-error")) {
        $("#assistant-save-error").textContent = error.message;
        saveButton.disabled = false;
      }
    }
  };
}
