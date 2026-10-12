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
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
      },
    });
    if (cdp) {
      if (!activeRuns.has(cdp)) activeRuns.set(cdp, new Map());
      activeRuns.get(cdp).set(run.id, {
        personId: run.person_id,
        worker,
      });
    }
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Function exceeded the 30-second limit"));
    }, timeout);
    let checking = false;
    const cancellation = cdp?.postgres
      ? setInterval(async () => {
          if (checking) return;
          checking = true;
          try {
            if (
              !(await cdp.get(
                "SELECT id FROM connection_runs WHERE id=?",
                run.id,
              ))
            )
              worker.terminate();
          } catch (error) {
            console.error("Connection cancellation:", error.message);
          } finally {
            checking = false;
          }
        }, 1000)
      : undefined;
    const finish = () => {
      if (cdp) activeRuns.get(cdp)?.delete(run.id);
      clearTimeout(timer);
      clearInterval(cancellation);
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
      clearInterval(cancellation);
      if (code !== 0) reject(new Error(`Function worker exited (${code})`));
      else reject(new Error("Function exited without a result"));
    });
  });
}
export async function drain(cdp, { timeout = 30000, budgetMs = 240000 } = {}) {
  const deadline = Date.now() + budgetMs;
  let lease;
  if (cdp.postgres) {
    lease = await cdp.pool.connect();
    const { rows } = await lease.query(
      "SELECT pg_try_advisory_lock(8675310) AS acquired",
    );
    if (!rows[0].acquired) {
      lease.release();
      return;
    }
  }
  try {
    if (cdp.postgres)
      await cdp.withSession(() =>
        cdp.run(
          "UPDATE connection_runs SET status='failed',error='Worker interrupted; inspect the destination before pushing again.',finished_at=? WHERE status='running' AND (started_at IS NULL OR started_at<?)",
          new Date().toISOString(),
          new Date(Date.now() - 60000).toISOString(),
        ),
      );
    while (Date.now() + timeout + 5000 < deadline) {
      const run = await cdp.withSession(async () => {
        const next = await cdp.get(
          "SELECT * FROM connection_runs WHERE status='queued' ORDER BY created_at,rowid LIMIT 1",
        );
        if (!next) return null;
        const claimed = await cdp.run(
          "UPDATE connection_runs SET status='running',started_at=? WHERE id=? AND status='queued'",
          new Date().toISOString(),
          next.id,
        );
        return claimed.changes ? next : null;
      });
      if (!run) break;
      try {
        const message = await execute(run, timeout, cdp);
        if (!message.ok) throw new Error(message.error);
        await cdp.withSession(async () => {
          const pending = await cdp.get(
            "SELECT id FROM connection_runs WHERE id=? AND status='running'",
            run.id,
          );
          if (!pending) return;
          const traits = message.value.result?.traits;
          if (traits !== undefined) {
            if (!traits || typeof traits !== "object" || Array.isArray(traits))
              throw new Error("Returned traits must be an object");
            const current = await cdp.get(
              "SELECT traits FROM people WHERE id=?",
              run.person_id,
            );
            if (!current) throw new Error("Profile no longer exists");
            const update = JSON.parse(current.traits);
            for (const [key, value] of Object.entries(traits)) {
              if (
                !key ||
                ["__proto__", "constructor", "prototype"].includes(key)
              )
                throw new Error("Invalid trait name");
              update[
                `${run.namespace || `connection_${run.connection_id}`}/${key}`
              ] = value;
            }
            await cdp.run(
              "UPDATE people SET traits=? WHERE id=?",
              JSON.stringify(update),
              run.person_id,
            );
          }
          await cdp.run(
            "UPDATE connection_runs SET status='succeeded',result=?,finished_at=? WHERE id=?",
            JSON.stringify(message.value),
            new Date().toISOString(),
            run.id,
          );
          if (traits !== undefined) await sync(cdp);
        });
      } catch (error) {
        await cdp.withSession(() =>
          cdp.run(
            "UPDATE connection_runs SET status='failed',error=?,finished_at=? WHERE id=?",
            error.message,
            new Date().toISOString(),
            run.id,
          ),
        );
      }
    }
  } finally {
    if (lease) {
      await lease.query("SELECT pg_advisory_unlock(8675310)").catch(() => {});
      lease.release();
    }
  }
}
let backgroundRun;
export function processQueue(cdp) {
  if (!backgroundRun)
    backgroundRun = (async () => {
      await sync(cdp);
      await drain(cdp);
    })()
      .catch((error) => console.error("Connections:", error.message))
      .finally(() => {
        backgroundRun = undefined;
      });
  return backgroundRun;
}
export async function startRunner(cdp) {
  if (!cdp.postgres)
    await cdp.run(
      "UPDATE connection_runs SET status='failed',error='Interrupted by server restart; inspect the destination before pushing again.',finished_at=? WHERE status='running'",
      new Date().toISOString(),
    );
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await sync(cdp);
      await drain(cdp);
    } catch (error) {
      console.error("Connections:", error.message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 5000);
  await tick();
  return () => clearInterval(timer);
}
