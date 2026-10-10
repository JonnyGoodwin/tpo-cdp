import { randomUUID } from "node:crypto";
import { send, body } from "../http.js";
import {
  planQuestion,
  validatePlan,
  outboundRequest,
} from "../../assistant/planner.js";
import { runQuery } from "../../assistant/queries.js";
import { sync } from "../../connections/store.js";
import { chatReply } from "../../assistant/conversation.js";
export function assistantRoutes(cdp) {
  const reports = new Map();
  return async (req, res, url) => {
    if (req.method === "GET" && url.pathname === "/api/assistant/status")
      return send(res, {
        aiConfigured: Boolean(process.env.OPENAI_API_KEY),
        planner: process.env.OPENAI_API_KEY ? "openai" : "local",
      });
    if (req.method === "POST" && url.pathname === "/api/assistant/ask") {
      const { question, context } = await body(req);
      const reply = chatReply(question);
      if (reply) return send(res, reply);
      const planned = await planQuestion(question, { context });
      if (planned.clarification) return send(res, planned);
      const now = new Date();
      const result = runQuery(cdp, planned.plan, now);
      const reportId = randomUUID();
      for (const [id, report] of reports)
        if (report.expires < Date.now()) reports.delete(id);
      if (reports.size >= 100) reports.delete(reports.keys().next().value);
      if (result.definition)
        reports.set(reportId, {
          plan: planned.plan,
          definition: result.definition,
          expires: Date.now() + 30 * 60000,
        });
      const { definition, ...publicResult } = result;
      return send(res, {
        ...publicResult,
        report_id: result.definition ? reportId : null,
        planner: planned.planner,
        plan: planned.plan,
        model_context:
          planned.planner === "openai"
            ? outboundRequest(planned.plan).input
            : null,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/assistant/segments") {
      const { report_id: reportId, name } = await body(req);
      const report = reports.get(reportId);
      if (!report || report.expires < Date.now())
        throw new Error(
          "This preview expired. Ask the question again before saving.",
        );
      if (typeof name !== "string" || !name.trim() || name.length > 100)
        throw new Error("Give the segment a name of up to 100 characters");
      validatePlan(report.plan);
      const definition = report.definition;
      const id = randomUUID();
      cdp.run(
        "INSERT INTO segments VALUES(?,?,?)",
        id,
        name.trim(),
        JSON.stringify(definition),
      );
      reports.delete(reportId);
      sync(cdp);
      return send(res, { id });
    }
    return false;
  };
}
