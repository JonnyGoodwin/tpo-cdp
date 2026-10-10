import { validatePlan } from "./planner.js";
export function timeRange(period, now = new Date(), days = 30) {
  const end = new Date(now);
  if (period === "last_month")
    return [
      new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1)),
      new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)),
    ];
  if (period === "this_month")
    return [
      new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)),
      end,
    ];
  if (period === "last_30_days")
    return [new Date(end.getTime() - days * 86400000), end];
  return [null, end];
}
export const readingNames = ["Page viewed", "read_story"];
export function activityRange(rule, now = new Date()) {
  return timeRange(
    rule.activity_period || "last_30_days",
    now,
    rule.window_days || 30,
  );
}
export function readingCount(cdp, personId, rule, now = new Date()) {
  const [from, to] = activityRange(rule, now);
  return cdp.get(
    "SELECT count(*) AS n FROM events WHERE person_id=? AND timestamp>=? AND timestamp<? AND name IN (?,?)",
    personId,
    from?.toISOString() || "0000",
    to.toISOString(),
    ...readingNames,
  ).n;
}
export function definitionFor(plan, now = new Date()) {
  validatePlan(plan);
  const rules = [{ field: "subscribers/signup_date", op: "known", value: "" }];
  if (plan.channel !== "all")
    rules.push({
      field: "subscribers/acquisition_source",
      op: "eq",
      value: plan.channel,
    });
  if (!plan.min_reads) {
    const [from, to] = timeRange(plan.period, now, plan.window_days);
    if (from)
      rules.push(
        {
          field: "subscribers/signup_date",
          op: "after",
          value: new Date(from.getTime() - 1).toISOString(),
        },
        {
          field: "subscribers/signup_date",
          op: "before",
          value: to.toISOString(),
        },
      );
  }
  if (plan.cold_days)
    rules.push(
      {
        field: "subscribers/signup_date",
        op: "older_than_days",
        value: String(plan.cold_days),
      },
      {
        mode: "any",
        rules: [
          { field: "subscribers/last_open_date", op: "unknown", value: "" },
          {
            field: "subscribers/last_open_date",
            op: "older_than_days",
            value: String(plan.cold_days),
          },
        ],
      },
    );
  if (plan.min_reads)
    rules.push({
      field: "event_count",
      op: "gt",
      value: String(plan.min_reads - 1),
      window_days: plan.window_days,
      activity_period: plan.period === "all" ? "last_30_days" : plan.period,
    });
  return { mode: "all", rules };
}
function displayDate(value) {
  return value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString().slice(0, 10)
    : "Not recorded";
}
export function runQuery(cdp, plan, now = new Date()) {
  const definition = definitionFor(plan, now);
  const all = cdp.profiles();
  // Evaluate dynamic segment rules against the same clock used by this report.
  const members = all.filter((person) => cdp.matches(person, definition, now));
  const [activityFrom, activityTo] = timeRange(
    plan.period === "all" ? "last_30_days" : plan.period,
    now,
    plan.window_days,
  );
  const activity = cdp.all(
    "SELECT person_id,count(*) AS reads,max(timestamp) AS last_read FROM events WHERE timestamp>=? AND timestamp<? AND name IN (?,?) GROUP BY person_id",
    activityFrom?.toISOString() || "0000",
    activityTo.toISOString(),
    ...readingNames,
  );
  const scores = new Map(activity.map((row) => [row.person_id, row]));
  const assumptions = [
    "Audience: newsletter subscribers with a recorded signup date.",
    "Channel uses subscribers/acquisition_source. Dates and calendar months use UTC.",
  ];
  if (plan.min_reads)
    assumptions.push(
      `Engagement means at least ${plan.min_reads} recorded web page views or app read_story events in ${plan.period === "all" ? `the past ${plan.window_days} days` : plan.period.replaceAll("_", " ")}; newsletter opens are not counted as reading events.`,
    );
  else if (plan.period !== "all")
    assumptions.push(`Signup cohort: ${plan.period.replaceAll("_", " ")}.`);
  if (plan.cold_days)
    assumptions.push(
      `Cold now: signup at least ${plan.cold_days} days ago, and last recorded newsletter open at least ${plan.cold_days} days ago or missing. This is current status, not a historical cold transition; missing opens do not prove a person never read.`,
    );
  let rows, columns, total;
  if (plan.kind === "first_pages") {
    const selected = new Map(
      members.map((person) => [
        person.id,
        Date.parse(person.traits["subscribers/signup_date"]),
      ]),
    );
    const visited = new Set();
    const counts = new Map();
    const events = cdp.all(
      "SELECT person_id,timestamp,properties FROM events WHERE source='web' ORDER BY timestamp,id",
    );
    for (const event of events) {
      const signup = selected.get(event.person_id);
      if (
        signup === undefined ||
        visited.has(event.person_id) ||
        Date.parse(event.timestamp) < signup ||
        Date.parse(event.timestamp) > now.getTime()
      )
        continue;
      const page = JSON.parse(event.properties)["web/page"];
      if (typeof page !== "string" || !page.trim()) continue;
      let path;
      try {
        path = new URL(page, "https://local.invalid").pathname;
      } catch {
        continue;
      }
      visited.add(event.person_id);
      counts.set(path, (counts.get(path) || 0) + 1);
    }
    rows = [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, plan.limit)
      .map(([page, subscribers]) => ({ page, subscribers }));
    columns = ["page", "subscribers"];
    total = visited.size;
    assumptions.push(
      "First page means earliest recorded web visit on or after the signup timestamp. Day-only signup dates start at midnight UTC. Query strings/fragments are excluded. Same-timestamp ties are ordered by event ID. Subscribers with no eligible recorded visit are excluded.",
    );
    return {
      kind: plan.kind,
      count: total,
      cohort_count: members.length,
      rows,
      columns,
      assumptions,
      definition: null,
      summary: `${total.toLocaleString()} of ${members.length.toLocaleString()} subscribers have a recorded first page after signup.`,
      as_of: now.toISOString(),
    };
  }
  total = members.length;
  rows =
    plan.kind === "count"
      ? []
      : members
          .sort(
            (a, b) =>
              (scores.get(b.id)?.reads || 0) - (scores.get(a.id)?.reads || 0) ||
              a.id.localeCompare(b.id),
          )
          .slice(0, plan.limit)
          .map((person, index) => ({
            reader: `Reader ${index + 1}`,
            channel: [
              "Instagram",
              "Google",
              "Facebook",
              "Twitter",
              "Referral",
              "Direct",
              "Email",
              "YouTube",
              "Organic",
            ].includes(person.traits["subscribers/acquisition_source"])
              ? person.traits["subscribers/acquisition_source"]
              : "Other / unknown",
            signup_date: displayDate(person.traits["subscribers/signup_date"]),
            last_open: displayDate(person.traits["subscribers/last_open_date"]),
            reads: scores.get(person.id)?.reads || 0,
          }));
  columns = ["reader", "channel", "signup_date", "last_open", "reads"];
  assumptions.push(
    "The model receives neither these rows nor the count. Reader labels are per-result display labels, not persistent user identifiers. Saving creates a live segment for all matching subscribers; the table row limit is only a display limit.",
  );
  return {
    kind: plan.kind,
    count: total,
    rows,
    columns,
    assumptions,
    definition,
    summary: `${total.toLocaleString()} subscribers match these criteria${rows.length && rows.length < total ? `; showing the top ${rows.length.toLocaleString()}` : ""}.`,
    as_of: now.toISOString(),
  };
}
