import { cancelPeopleRuns } from "../connections/runner.js";
async function deletePeopleImpl(cdp, ids) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => typeof id !== "string" || !id.trim())
  )
    throw new Error("Select at least one valid person");
  const unique = [...new Set(ids)];
  for (const id of unique) {
    if (!(await cdp.get("SELECT id FROM people WHERE id=?", id)))
      throw new Error(
        "One or more profiles no longer exist. Refresh and try again.",
      );
  }
  await cdp.db.exec("BEGIN");
  try {
    for (const id of unique) {
      for (const table of [
        "connection_runs",
        "connection_members",
        "events",
        "identities",
      ])
        await cdp.run(`DELETE FROM ${table} WHERE person_id=?`, id);
      await cdp.run("DELETE FROM people WHERE id=?", id);
    }
    await cdp.db.exec("COMMIT");
  } catch (error) {
    await cdp.db.exec("ROLLBACK");
    throw error;
  }
  cancelPeopleRuns(cdp, new Set(unique));
  return {
    deleted: unique.length,
  };
}

export function deletePeople(cdp, ...args) {
  return cdp.withSession(() => deletePeopleImpl(cdp, ...args));
}
