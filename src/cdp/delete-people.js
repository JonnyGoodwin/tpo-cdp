import { cancelPeopleRuns } from "../connections/runner.js";
export function deletePeople(cdp, ids) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => typeof id !== "string" || !id.trim())
  )
    throw new Error("Select at least one valid person");
  const unique = [...new Set(ids)];
  if (unique.some((id) => !cdp.get("SELECT id FROM people WHERE id=?", id)))
    throw new Error(
      "One or more profiles no longer exist. Refresh and try again.",
    );
  cdp.db.exec("BEGIN");
  try {
    for (const id of unique) {
      for (const table of [
        "connection_runs",
        "connection_members",
        "events",
        "identities",
      ])
        cdp.run(`DELETE FROM ${table} WHERE person_id=?`, id);
      cdp.run("DELETE FROM people WHERE id=?", id);
    }
    cdp.db.exec("COMMIT");
  } catch (error) {
    cdp.db.exec("ROLLBACK");
    throw error;
  }
  cancelPeopleRuns(cdp, new Set(unique));
  return { deleted: unique.length };
}
