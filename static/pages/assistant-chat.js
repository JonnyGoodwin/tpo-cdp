import { esc, num } from "../shared.js";
export const examples = [
  "How many Instagram signups went cold last month?",
  "Build me a list of our most engaged readers",
  "Which pages do new subscribers hit first?",
];
export function messageMarkup(message, index) {
  if (message.role === "user")
    return `<article class="chat-message chat-user"><div class="chat-speaker">You</div><p>${esc(message.text)}</p></article>`;
  const result = message.result;
  let content = `<p>${esc(message.text || result?.message || result?.clarification || "")}</p>`;
  if (result?.summary)
    content = `<h2>${esc(result.summary)}</h2><p class="hint">As of ${esc(new Date(result.as_of).toLocaleString())}</p>${result.rows.length ? `<div class="table-scroll"><table><thead><tr>${result.columns.map((c) => `<th>${esc(c.replaceAll("_", " "))}</th>`).join("")}</tr></thead><tbody>${result.rows.map((row) => `<tr>${result.columns.map((c) => `<td>${esc(typeof row[c] === "number" ? num(row[c]) : row[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}<details><summary>How this was calculated</summary><ul>${result.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></details><details><summary>Privacy details</summary><p>Customer records, results, and conversation history stay local.</p><pre>${esc(result.model_context || "Nothing was sent to AI. This query was planned locally.")}</pre></details>`;
  return `<article class="chat-message chat-assistant assistant-answer"><div class="chat-speaker">Growth assistant</div>${content}<div class="chat-actions">${result?.suggestion ? `<button class="button small" data-chat-suggestion="${index}">Use this definition</button>` : ""}${result?.report_id ? `<button class="button small primary" data-chat-save="${index}">Save as segment</button>` : ""}${result?.plan ? `<button class="button small" data-chat-followup="${index}">Refine this result</button>` : ""}${(message.actions || result?.actions || []).includes("upload") ? '<button class="button small" data-chat-upload>Upload a list</button>' : ""}${message.segmentId ? `<button class="button small" data-chat-segment="${index}">View segment</button>` : ""}${message.people ? '<button class="button small" data-chat-people>View people</button>' : ""}</div>${result?.plan ? '<p class="hint">Try “just Instagram”, “what about last month?”, or “show the top 20”.</p>' : ""}</article>`;
}
