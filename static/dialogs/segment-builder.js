import {
  $,
  esc,
  num,
  date,
  state,
  api,
  toast,
  modal,
  close,
  refresh,
  go,
} from "../shared.js";

let builder,
  builderCount = 0;
function usesDatePicker(rule) {
  if (["after", "before"].includes(rule.op)) return true;
  if (rule.op === "event") return false;
  if (rule.field === "last_seen") return true;
  const mappedDate = state.data.imports.some((entry) =>
    entry.mapping.some(
      (column) =>
        column.target === "trait" &&
        column.type === "date" &&
        `${entry.source}/${column.name || column.column}` === rule.field,
    ),
  );
  if (mappedDate) return true;
  return state.data.profiles.some((person) => {
    const value = person.traits[rule.field];
    return (
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) &&
      !Number.isNaN(Date.parse(value))
    );
  });
}
function dateInputValue(value) {
  return /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(String(value || ""))
    ? String(value).slice(0, 10)
    : "";
}
function updateValueInput(key) {
  const rule = ruleAt(key).rule;
  const input = [...document.querySelectorAll("[data-rule-value]")].find(
    (element) => element.dataset.ruleValue === key,
  );
  const isDate = usesDatePicker(rule);
  input.type = isDate ? "date" : "text";
  if (isDate) rule.value = dateInputValue(rule.value);
  input.value = rule.value || "";
  const noValue = ["known", "unknown"].includes(rule.op);
  input.disabled = noValue;
  input.hidden = noValue;
  input.closest(".rule").classList.toggle("no-value", noValue);
}
export function openBuilder(id) {
  const s = state.data.segments.find((s) => s.id === id);
  builder = s
    ? structuredClone(s)
    : {
        name: "",
        definition: {
          mode: "all",
          rules: [{ field: "subscribers/status", op: "eq", value: "active" }],
        },
      };
  builderView();
}
export function ruleMarkup(r, k, prefix = "") {
  const key = prefix ? `${prefix}.${k}` : String(k);
  if (r.rules)
    return `<div class="builder"><div class="builder-head">Group matches <select data-group-mode="${key}" aria-label="Group matching mode"><option value="all" ${r.mode === "all" ? "selected" : ""}>all</option><option value="any" ${r.mode === "any" ? "selected" : ""}>any</option></select> conditions <button class="close" data-remove-rule="${key}" aria-label="Remove group">×</button></div>${r.rules.map((v, n) => ruleMarkup(v, n, key)).join("")}<button class="button small" data-add-group-rule="${key}">＋ Add condition</button></div>`;
  const fields = ["email", "event_count", "last_seen", ...state.data.fields];
  const noValue = ["known", "unknown"].includes(r.op);
  if (r.field && !fields.includes(r.field)) fields.push(r.field);
  return `<div class="rule${noValue ? " no-value" : ""}"><select data-rule-field="${key}" aria-label="Condition attribute">${fields.map((f) => `<option value="${esc(f)}" ${r.field === f ? "selected" : ""}>${esc(f.replaceAll("_", " "))}</option>`).join("")}</select><select data-rule-op="${key}" aria-label="Condition operator">${[
    ["eq", "is equal to"],
    ["neq", "is not equal to"],
    ["contains", "contains"],
    ["known", "is known"],
    ["unknown", "is unknown"],
    ["gt", "is greater than"],
    ["lt", "is less than"],
    ["after", "is after date"],
    ["before", "is before date"],
    ["event", "has event containing"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${r.op === v ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select><input type="${usesDatePicker(r) ? "date" : "text"}" data-rule-value="${key}" aria-label="Condition value" value="${esc(usesDatePicker(r) ? dateInputValue(r.value) : r.value)}" ${noValue ? "hidden disabled" : ""} placeholder="Value"><button class="close" data-remove-rule="${key}" aria-label="Remove condition">×</button></div>`;
}
export function ruleAt(key) {
  let rules = builder.definition.rules;
  const parts = key.split(".").map(Number);
  for (const p of parts.slice(0, -1)) rules = rules[p].rules;
  return { rules, index: parts.at(-1), rule: rules[parts.at(-1)] };
}
export function builderView() {
  modal(
    builder.id ? "Edit segment" : "Create a segment",
    `<div class="modal-body"><div class="field"><label for="segment-name">Segment name</label><input id="segment-name" value="${esc(builder.name)}" placeholder="e.g. Engaged newsletter readers"></div><div class="builder"><div class="builder-head">People matching <select id="builder-mode" aria-label="Matching mode"><option value="all" ${builder.definition.mode === "all" ? "selected" : ""}>all</option><option value="any" ${builder.definition.mode === "any" ? "selected" : ""}>any</option></select> of the following conditions</div>${builder.definition.rules.map((r, k) => ruleMarkup(r, k)).join("")}<button class="button small" id="add-rule">＋ Add attribute</button> <button class="button small" id="add-event">＋ Add event</button> <button class="button small" id="add-group">＋ Add group</button></div><p class="hint">Event conditions search event names and property values. Date conditions compare against a date such as 2026-09-01.</p><div class="notice" id="segment-preview">Calculating matching people…</div><div id="builder-error"></div></div>`,
    `<div>${builder.id ? '<button class="button danger" id="delete-segment">Delete segment</button>' : '<span class="hint">Membership updates with your data</span>'}</div><button class="button primary" id="save-segment">Save segment</button>`,
    true,
  );
  $("#segment-name").oninput = (e) => (builder.name = e.target.value);
  $("#builder-mode").onchange = (e) => {
    builder.definition.mode = e.target.value;
    previewBuilder();
  };
  const add = () => ({ field: "email", op: "known", value: "" });
  $("#add-rule").onclick = () => {
    builder.definition.rules.push(add());
    builderView();
  };
  $("#add-event").onclick = () => {
    builder.definition.rules.push({
      field: "event_count",
      op: "event",
      value: "/subscribe",
    });
    builderView();
  };
  $("#add-group").onclick = () => {
    builder.definition.rules.push({ mode: "any", rules: [add()] });
    builderView();
  };
  document.querySelectorAll("[data-rule-field]").forEach(
    (e) =>
      (e.onchange = () => {
        ruleAt(e.dataset.ruleField).rule.field = e.value;
        updateValueInput(e.dataset.ruleField);
        previewBuilder();
      }),
  );
  document.querySelectorAll("[data-rule-op]").forEach(
    (e) =>
      (e.onchange = () => {
        ruleAt(e.dataset.ruleOp).rule.op = e.value;
        updateValueInput(e.dataset.ruleOp);
        previewBuilder();
      }),
  );
  document.querySelectorAll("[data-rule-value]").forEach(
    (e) =>
      (e.oninput = () => {
        ruleAt(e.dataset.ruleValue).rule.value = e.value;
        clearTimeout(previewBuilder.timer);
        previewBuilder.timer = setTimeout(previewBuilder, 250);
      }),
  );
  document.querySelectorAll("[data-remove-rule]").forEach(
    (e) =>
      (e.onclick = () => {
        const r = ruleAt(e.dataset.removeRule);
        r.rules.splice(r.index, 1);
        builderView();
      }),
  );
  document.querySelectorAll("[data-group-mode]").forEach(
    (e) =>
      (e.onchange = () => {
        ruleAt(e.dataset.groupMode).rule.mode = e.value;
        previewBuilder();
      }),
  );
  document.querySelectorAll("[data-add-group-rule]").forEach(
    (e) =>
      (e.onclick = () => {
        ruleAt(e.dataset.addGroupRule).rule.rules.push(add());
        builderView();
      }),
  );
  $("#save-segment").onclick = async () => {
    try {
      if (!builder.name.trim()) throw new Error("Give this segment a name");
      await api("/api/segments", {
        id: builder.id,
        name: builder.name,
        definition: builder.definition,
      });
      close();
      await refresh();
      go("segments");
      toast("Segment saved");
    } catch (e) {
      $("#builder-error").innerHTML =
        `<div class="notice error">${esc(e.message)}</div>`;
    }
  };
  if ($("#delete-segment"))
    $("#delete-segment").onclick = async () => {
      try {
        await api("/api/segments/" + builder.id, {}, "DELETE");
        state.segment = "";
        close();
        await refresh();
        go("segments");
        toast("Segment deleted");
      } catch (e) {
        toast(e.message);
      }
    };
  previewBuilder();
}
export async function previewBuilder() {
  const token = ++builderCount;
  try {
    const r = await api("/api/segments/preview", builder.definition);
    if (token === builderCount && $("#segment-preview"))
      $("#segment-preview").innerHTML =
        `<strong>${num(r.ids.length)} people</strong> match these conditions. ${builder.definition.rules.length ? "" : "No conditions selects everyone."}`;
  } catch (e) {
    if ($("#segment-preview")) $("#segment-preview").textContent = e.message;
  }
}
