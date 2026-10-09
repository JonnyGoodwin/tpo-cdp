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
export function confirmDeletePeople(ids) {
  if (!ids.length) return toast("Select people to delete");
  const people = state.data.profiles.filter((p) => ids.includes(p.id));
  const subject =
    ids.length === 1
      ? esc(people[0]?.email || people[0]?.name || "this person")
      : `${num(ids.length)} selected people`;
  modal(
    "Delete people",
    `<div class="modal-body"><p>Delete <strong>${subject}</strong>?</p><p>Their profiles, linked identities, events, and Connection run history will be permanently removed. Pending function calls will be cancelled.</p><p class="hint">Original CSV files and records in external services stay unchanged. Reimporting their data can recreate these profiles.</p><div id="delete-people-error"></div></div>`,
    `<button class="button" id="cancel-delete-people">Cancel</button><button class="button danger" id="confirm-delete-people">Delete ${ids.length === 1 ? "person" : `${num(ids.length)} people`}</button>`,
  );
  $("#cancel-delete-people").onclick = close;
  $("#confirm-delete-people").onclick = async () => {
    const button = $("#confirm-delete-people");
    button.disabled = true;
    try {
      const { deleted } = await api("/api/people", { ids }, "DELETE");
      state.selected.clear();
      close();
      await refresh();
      toast(`Deleted ${num(deleted)} ${deleted === 1 ? "person" : "people"}`);
    } catch (error) {
      $("#delete-people-error").textContent = error.message;
      button.disabled = false;
    }
  };
}
