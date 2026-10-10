// This module never accepts database contents. Raw questions never cross the model boundary.
export const channels = [
  "all",
  "Instagram",
  "Google",
  "Facebook",
  "Twitter",
  "Referral",
  "Direct",
  "Email",
  "YouTube",
  "Organic",
];
const vocabulary = new Set(
  "how many instagram google facebook twitter referral direct email youtube organic signups signup signed up subscribers subscriber people users readers reader went go gone cold inactive dormant last month this months days day week weeks current currently now build me a an list of our the most highly engaged active engagement reading reads stories story pages page do does new hit visit visits first which what are is show count total did we get got gained give us can you tell find generate having out about those than within during calendar acquisition referred came coming since joined joining audience segment create save for from in on with and who have has no not opened opens open activity past top at least more than events please i want to see compare sources source traffic acquisition channel all recently new after before newsletter web app website".split(
    " ",
  ),
);
export const planSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "channel",
    "period",
    "window_days",
    "cold_days",
    "min_reads",
    "limit",
  ],
  properties: {
    kind: { type: "string", enum: ["count", "audience", "first_pages"] },
    channel: { type: "string", enum: channels },
    period: {
      type: "string",
      enum: ["all", "last_month", "this_month", "last_30_days"],
    },
    window_days: { type: "integer", minimum: 1, maximum: 365 },
    cold_days: { type: "integer", minimum: 0, maximum: 365 },
    min_reads: { type: "integer", minimum: 0, maximum: 1000 },
    limit: { type: "integer", minimum: 1, maximum: 200 },
  },
};
export function interpret(question, context) {
  if (
    typeof question !== "string" ||
    !question.trim() ||
    question.length > 1000
  )
    return {
      clarification: "Ask a Growth question in up to 1,000 characters.",
    };
  const text = question.toLowerCase().replace(/[’']/g, "");
  if (context) {
    validatePlan(context);
    const followup = text.trim().replace(/[?.!]+$/, "");
    const channel = followup.match(
      /^(?:what about|how about|only|just|same for|filter to|from) (all(?: channels| subscribers)?|instagram|google|facebook|twitter|referral|direct|email|youtube|organic)$/,
    );
    const period = followup.match(
      /^(?:what about |how about |same for |for |use )?(last month|this month|the past \d{1,3} days|past \d{1,3} days|last \d{1,3} days)$/,
    );
    const top = followup.match(
      /^(?:show |show me |just |only )?(?:the )?top (\d{1,3})(?: readers| rows)?$/,
    );
    const minimum = followup.match(
      /^(?:with |use |make it )?at least (\d{1,3}) (?:reads|stories)$/,
    );
    let next;
    if (channel)
      next = {
        ...context,
        channel: channels.find((c) => c.toLowerCase() === channel[1]) || "all",
      };
    else if (period)
      next = {
        ...context,
        period:
          period[1] === "last month"
            ? "last_month"
            : period[1] === "this month"
              ? "this_month"
              : "last_30_days",
        ...(period[1].match(/\d+/)
          ? { window_days: Number(period[1].match(/\d+/)[0]) }
          : {}),
      };
    else if (top) next = { ...context, limit: Number(top[1]) };
    else if (minimum) next = { ...context, min_reads: Number(minimum[1]) };
    else if (
      /^(?:show (?:me )?(?:them|that|this|it) as (?:a )?list|build (?:me )?(?:a )?list|show (?:the )?(?:readers|audience))$/.test(
        followup,
      ) &&
      context.kind !== "first_pages"
    )
      next = { ...context, kind: "audience" };
    else if (
      /^(?:how many(?: is that)?|count them|show (?:the )?count)$/.test(
        followup,
      ) &&
      context.kind !== "first_pages"
    )
      next = { ...context, kind: "count" };
    if (next) {
      try {
        return { intent: validatePlan(next) };
      } catch {
        return {
          clarification:
            "Use 1–365 days, up to 1,000 reads, and at most 200 rows.",
        };
      }
    }
  }
  if (/@|https?:|\b(?:u_|d_|v_)[a-z0-9]+|\d{6,}/i.test(text))
    return {
      clarification:
        "Ask about an audience or trend without names, emails, IDs, or personal links. The question was not sent to AI.",
    };
  const words = text.match(/[a-z]+|\d+/g) || [];
  if (words.some((word) => !vocabulary.has(word) && !/^\d{1,3}$/.test(word)))
    return {
      clarification:
        "I can help with signup counts, currently cold audiences, engaged readers, and first pages after signup. Please use one of the examples or rephrase without personal details. The question was not sent to AI.",
    };
  const cold = /\b(cold|inactive|dormant)\b/.test(text);
  if (
    /\b(not|except|exclude|before|after|week|weeks|since|compare|sources)\b/.test(
      text,
    ) ||
    /\b(no|never)\b/.test(text) ||
    /\b(opened|opens|open)\b/.test(text)
  )
    return {
      clarification:
        "That filter is not supported yet. Try a signup count, a currently cold audience, engaged readers, or first pages after signup using the examples.",
    };
  if (cold && /\b(went|gone)\b/.test(text))
    return {
      clarification:
        "Exact historical cold transitions need email-open history, which is not recorded. Did you mean subscribers who signed up last month and are cold now (no recorded opens in the past 30 days)?",
      suggestion: `How many ${channels.find((channel) => channel !== "all" && text.includes(channel.toLowerCase())) || ""} signups from last month are cold now?`,
    };
  const engaged = /\b(engaged|engagement|active|reads|reading)\b/.test(text);
  const firstPages = /\b(pages|page)\b/.test(text) && /\bfirst\b/.test(text);
  if (
    !firstPages &&
    !cold &&
    !engaged &&
    !/\b(signups|signup|subscribers|subscriber|people|users|readers|count|total)\b/.test(
      text,
    )
  )
    return {
      clarification:
        "Try asking for a signup count, an engaged audience, or the first pages new subscribers visit.",
    };
  if (/\b(compare|sources)\b/.test(text))
    return {
      clarification:
        "Choose one acquisition channel or ask about all subscribers. Channel comparison is not supported yet.",
    };
  const matches = channels.filter(
    (channel) =>
      channel !== "all" &&
      words.includes(channel.toLowerCase()) &&
      (channel !== "Email" ||
        /\b(from email|email signups|email signup)\b/.test(text)),
  );
  if (matches.length > 1)
    return { clarification: "Choose one acquisition channel for this query." };
  const numeric = words.filter((w) => /^\d+$/.test(w));
  const top = text.match(/\btop\s+(\d{1,3})\b/);
  const minimum = text.match(
    /\bat least\s+(\d{1,3})\s+(?:reads|stories|events)\b/,
  );
  const days = text.match(/\b(?:past|last)\s+(\d{1,3})\s+days\b/);
  if (numeric.length !== [top, minimum, days].filter(Boolean).length)
    return {
      clarification:
        "Use numbers with “top 20”, “at least 5 reads”, or “past 30 days”.",
    };
  const period = /\blast month\b/.test(text)
    ? "last_month"
    : /\bthis month\b/.test(text)
      ? "this_month"
      : days || (firstPages && /\bnew\b/.test(text))
        ? "last_30_days"
        : "all";
  const kind = firstPages
    ? "first_pages"
    : /\b(how many|count|total)\b/.test(text)
      ? "count"
      : "audience";
  const plan = {
    kind,
    channel: matches[0] || "all",
    period,
    window_days: Number(days?.[1] || 30),
    cold_days: cold ? Number(days?.[1] || 30) : 0,
    min_reads: engaged ? Number(minimum?.[1] || 3) : 0,
    limit: Number(top?.[1] || (firstPages ? 20 : 100)),
  };
  try {
    validatePlan(plan);
  } catch {
    return {
      clarification:
        "Use 1–365 days, 0–1,000 reads, and at most 200 result rows.",
    };
  }
  return { intent: plan };
}
export function validatePlan(plan) {
  if (
    !plan ||
    typeof plan !== "object" ||
    Array.isArray(plan) ||
    Object.keys(plan).length !== planSchema.required.length
  )
    throw new Error("Invalid Growth query plan");
  for (const [key, rule] of Object.entries(planSchema.properties)) {
    const value = plan[key];
    if (
      rule.enum
        ? !rule.enum.includes(value)
        : !Number.isInteger(value) ||
          value < rule.minimum ||
          value > rule.maximum
    )
      throw new Error("Invalid Growth query plan");
  }
  return plan;
}
export function outboundRequest(intent, model = "gpt-5-mini") {
  validatePlan(intent);
  // Reconstruct from enums/numbers only; never serialize the question, caller extras, or records.
  const safe = Object.fromEntries(
    planSchema.required.map((key) => [key, intent[key]]),
  );
  return {
    model,
    store: false,
    instructions:
      "Produce the Growth query plan described by the approved intent. Preserve every supplied filter, period, threshold, and limit. Return only the specified structured plan. No SQL, code, tools, external queries, or follow-up requests are allowed.",
    input: JSON.stringify({ approved_intent: safe }),
    text: {
      format: {
        type: "json_schema",
        name: "growth_query",
        strict: true,
        schema: planSchema,
      },
    },
    max_output_tokens: 4096,
  };
}
export async function planQuestion(
  question,
  {
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL || "gpt-5-mini",
    fetchImpl = fetch,
    context,
  } = {},
) {
  const interpreted = interpret(question, context);
  if (interpreted.clarification) return interpreted;
  const expected = interpreted.intent;
  if (!apiKey) return { plan: expected, planner: "local" };
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(outboundRequest(expected, model)),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(
      "AI planner is unavailable. Your data was not sent; try again or use local planning.",
    );
  const data = await response.json();
  if (data.status !== "completed")
    throw new Error("AI planning did not complete. No query was executed.");
  const output = data.output
    ?.filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("");
  let plan;
  try {
    plan = validatePlan(JSON.parse(output));
  } catch {
    throw new Error("AI returned an unsupported plan. No query was executed.");
  }
  if (planSchema.required.some((key) => plan[key] !== expected[key]))
    throw new Error("AI changed a requested filter. No query was executed.");
  return { plan, planner: "openai" };
}
