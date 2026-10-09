import { parentPort, workerData } from "node:worker_threads";
const { code, user, settings, runId } = workerData;
const logs = [];
const log = (...args) => {
  if (logs.length < 30)
    logs.push(
      args
        .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
        .join(" ")
        .slice(0, 2000),
    );
};
try {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const result = await new AsyncFunction("user", "context", code)(user, {
    settings,
    runId,
    fetch,
    log,
  });
  const serialized = JSON.stringify({ result: result ?? null, logs });
  if (serialized.length > 100000)
    throw new Error("Function result exceeds 100 KB");
  parentPort.postMessage({ ok: true, value: JSON.parse(serialized) });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: String(error.message).slice(0, 4000),
    logs,
  });
}
