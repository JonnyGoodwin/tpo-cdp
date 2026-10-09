import { Worker } from "node:worker_threads";
import { sync } from "./store.js";
const activeRuns = new WeakMap();
export function cancelPeopleRuns(cdp, ids) {
  for (const { personId, worker } of activeRuns.get(cdp)?.values() || []) {
    if (ids.has(personId)) worker.terminate();
  }
}
export function execute(run, timeout = 30000, cdp) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      workerData: {
        code: run.code,
        user: JSON.parse(run.payload),
        settings: JSON.parse(run.settings),
        runId: run.id,
      },
      resourceLimits: { maxOldGenerationSizeMb: 64 },
    });
    if (cdp) {
      if (!activeRuns.has(cdp)) activeRuns.set(cdp, new Map());
      activeRuns.get(cdp).set(run.id, { personId: run.person_id, worker });
    }
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Function exceeded the 30-second limit"));
    }, timeout);
    const finish = () => {
      if (cdp) activeRuns.get(cdp)?.delete(run.id);
      clearTimeout(timer);
      worker.terminate();
    };
    worker.once("message", (message) => {
      finish();
      resolve(message);
    });
    worker.once("error", (error) => {
      finish();
      reject(error);
    });
    worker.once("exit", (code) => {
      if (cdp) activeRuns.get(cdp)?.delete(run.id);
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Function worker exited (${code})`));
      else reject(new Error("Function exited without a result"));
    });
  });
}
export async function drain(cdp, { timeout = 30000 } = {}) {
  let run;
  while (
    (run = cdp.get(
      "SELECT * FROM connection_runs WHERE status='queued' ORDER BY created_at,rowid LIMIT 1",
    ))
  ) {
    cdp.run("UPDATE connection_runs SET status='running' WHERE id=?", run.id);
    let enriched = false;
    try {
      const message = await execute(run, timeout, cdp);
      if (!message.ok) throw new Error(message.error);
      const traits = message.value.result?.traits;
      if (traits !== undefined) {
        if (!traits || typeof traits !== "object" || Array.isArray(traits))
          throw new Error("Returned traits must be an object");
        const current = cdp.get(
          "SELECT traits FROM people WHERE id=?",
          run.person_id,
        );
        if (!current) throw new Error("Profile no longer exists");
        const update = JSON.parse(current.traits);
        for (const [key, value] of Object.entries(traits)) {
          if (!key || ["__proto__", "constructor", "prototype"].includes(key))
            throw new Error("Invalid trait name");
          update[
            `${run.namespace || `connection_${run.connection_id}`}/${key}`
          ] = value;
        }
        cdp.run(
          "UPDATE people SET traits=? WHERE id=?",
          JSON.stringify(update),
          run.person_id,
        );
        enriched = true;
      }
      cdp.run(
        "UPDATE connection_runs SET status='succeeded',result=?,finished_at=? WHERE id=?",
        JSON.stringify(message.value),
        new Date().toISOString(),
        run.id,
      );
    } catch (error) {
      cdp.run(
        "UPDATE connection_runs SET status='failed',error=?,finished_at=? WHERE id=?",
        error.message,
        new Date().toISOString(),
        run.id,
      );
    }
    if (enriched) sync(cdp);
  }
}
export function startRunner(cdp) {
  cdp.run(
    "UPDATE connection_runs SET status='failed',error='Interrupted by server restart; inspect the destination before pushing again.',finished_at=? WHERE status='running'",
    new Date().toISOString(),
  );
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      sync(cdp);
      await drain(cdp);
    } catch (error) {
      console.error("Connections:", error.message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 5000);
  tick();
  return () => clearInterval(timer);
}
