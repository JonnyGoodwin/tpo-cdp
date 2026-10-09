import {
  $,
  esc,
  num,
  date,
  sourceName,
  state,
  heading,
  personCell,
} from "../shared.js";

export function overview() {
  const { profiles, stats, segments, imports } = state.data;
  const active = profiles.filter(
    (p) => p.traits["subscribers/status"] === "active",
  ).length;
  const app = profiles.filter((p) =>
    p.identities.some(
      (i) => i.kind === "external_id" && i.value.startsWith("app:"),
    ),
  ).length;
  const sourceList = [...new Set(imports.map((i) => i.source))];
  const recent = profiles
    .filter((p) => p.last_seen)
    .sort((a, b) => b.last_seen.localeCompare(a.last_seen))
    .slice(0, 4);

  $("#main").innerHTML =
    heading(
      "Your audience, connected.",
      "A single view of your readers, subscribers, and app users.",
      `<span class="badge gray">${num(stats.sources)} connected sources</span>`,
    ) +
    `<div class="cards">${[
      ["Total profiles", stats.people, "Known and anonymous identities", "♙"],
      [
        "Identified people",
        stats.known,
        "Matched across your data sources",
        "◎",
      ],
      [
        "Tracked events",
        stats.events,
        "Website activity, linked to profiles",
        "↗",
      ],
      ["Active subscribers", active, "Current newsletter membership", "✉"],
    ]
      .map(
        ([label, n, foot, icon]) =>
          `<div class="card"><div class="stat-top">${label}<span class="stat-icon">${icon}</span></div><div class="stat-number">${num(n)}</div><div class="stat-foot"><span class="green">●</span> ${foot}</div></div>`,
      )
      .join("")}</div>
 <div class="grid-two"><section class="panel"><div class="panel-head"><h2>Audience at a glance</h2><span class="badge blue">Unified profiles</span></div><div class="panel-body">${[
   ["Identified people", stats.known],
   ["Anonymous visitors", stats.anonymous],
   ["Active subscribers", active],
   ["App users", app],
 ]
   .map(
     ([name, n]) =>
       `<div class="bar-row"><div class="bar-label"><span>${name}</span><strong>${num(n)}</strong></div><div class="bar"><div style="width:${Math.max((n / stats.people) * 100, 1)}%"></div></div></div>`,
   )
   .join(
     "",
   )}<p class="hint">Email matches connect subscriber and app records. Visitor IDs connect anonymous browsing history when an email becomes known.</p></div></section>
 <section class="panel"><div class="panel-head"><h2>Data sources</h2><button class="link" data-view="sources">Manage sources →</button></div><div class="panel-body">${sourceList
   .map((s, i) => {
     const entries = imports.filter((x) => x.source === s),
       latest = entries[0];
     return `<div class="source-row"><span class="source-icon">${["✉", "◇", "↗"][i % 3]}</span><div class="source-copy"><strong>${esc(sourceName(s))}</strong><small>${esc(latest.filename)} · ${num(latest.result.rows)} rows</small></div><span class="badge">Imported</span></div>`;
   })
   .join(
     "",
   )}<div class="hint">CSV sources · ${num(imports.length)} completed imports</div></div></section></div>
 <div class="callout"><span class="callout-icon">⇄</span><div><h3>Bring your next data source into the picture.</h3><p>Upload a CSV, map your columns, and connect it to your existing audience.</p></div><button class="button" data-action="import">＋ Import a CSV</button></div>
 <div class="grid-two"><section class="panel"><div class="panel-head"><h2>Recently active people</h2><button class="link" data-view="people">View all people →</button></div><div class="table-scroll"><table><thead><tr><th>PERSON</th><th>EVENTS</th><th>LAST SEEN</th></tr></thead><tbody>${recent.map((p) => `<tr class="clickable" data-profile="${p.id}"><td>${personCell(p)}</td><td>${num(p.event_count)}</td><td>${date(p.last_seen)}</td></tr>`).join("")}</tbody></table></div></section><section class="panel"><div class="panel-head"><h2>Your segments</h2><button class="link" data-view="segments">View segments →</button></div><div class="panel-body">${
   segments
     .slice(0, 3)
     .map(
       (s) =>
         `<div class="source-row"><span class="source-icon">◎</span><div class="source-copy"><strong>${esc(s.name)}</strong><small>Live audience · ${s.definition.rules.length} conditions</small></div><strong>${num(s.count)}</strong></div>`,
     )
     .join("") || '<p class="hint">Create your first audience segment.</p>'
 }</div></section></div>`;
}
