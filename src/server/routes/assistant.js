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
      const planned = await planQuestion(question, {
        context,
      });
      if (planned.clarification) return send(res, planned);
      const now = new Date();
      const result = await runQuery(cdp, planned.plan, now);
      const reportId = randomUUID();
      await cdp.run(
        "DELETE FROM assistant_reports WHERE expires<?",
        new Date().toISOString(),
      );
      if (result.definition)
        await cdp.run(
          "INSERT INTO assistant_reports VALUES(?,?,?,?)",
          reportId,
          JSON.stringify(planned.plan),
          JSON.stringify(result.definition),
          new Date(Date.now() + 30 * 60000).toISOString(),
        );
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
      const stored = await cdp.get(
        "SELECT * FROM assistant_reports WHERE id=?",
        reportId,
      );
      const report = stored && {
        plan: JSON.parse(stored.plan),
        definition: JSON.parse(stored.definition),
        expires: Date.parse(stored.expires),
      };
      if (!report || report.expires < Date.now())
        throw new Error(
          "This preview expired. Ask the question again before saving.",
        );
      if (typeof name !== "string" || !name.trim() || name.length > 100)
        throw new Error("Give the segment a name of up to 100 characters");
      validatePlan(report.plan);
      const definition = report.definition;
      const id = randomUUID();
      await cdp.run(
        "INSERT INTO segments VALUES(?,?,?)",
        id,
        name.trim(),
        JSON.stringify(definition),
      );
      await cdp.run("DELETE FROM assistant_reports WHERE id=?", reportId);
      await sync(cdp);
      return send(res, {
        id,
      });
    }
    return false;
  };
}
