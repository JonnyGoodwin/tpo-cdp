import {
  $,
  esc,
  num,
  date,
  initials,
  displayName,
  api,
  toast,
  modal,
  close,
} from "../shared.js";
import { confirmDeletePeople } from "./delete-people.js";

export async function profile(id) {
  try {
    const p = await api("/api/people/" + id);
    $("#overlay").innerHTML =
      `<div class="overlay-backdrop drawer-wrap"><section class="drawer" role="dialog" aria-modal="true" aria-label="Person profile"><div class="modal-head"><h2>Person profile</h2><button class="close" data-action="close" aria-label="Close profile">×</button></div><div class="profile-hero"><div class="avatar green">${esc(initials(p))}</div><h2>${esc(displayName(p))}</h2><div class="subtitle">${esc(p.email || "Anonymous visitor")}</div><div class="profile-stats"><div><strong>${num(p.event_count)}</strong><small>Tracked events</small></div><div><strong>${p.identities.length}</strong><small>Linked identities</small></div><div><strong>${date(p.last_seen)}</strong><small>Last activity</small></div></div></div><div class="profile-section"><h3>Linked identities</h3>${p.identities.map((i) => `<div class="trait-row"><span>${esc(i.kind.replaceAll("_", " "))}</span><span>${esc(i.value)}</span></div>`).join("")}</div><div class="profile-section"><h3>Attributes</h3>${
        Object.entries(p.traits)
          .map(
            ([k, v]) =>
              `<div class="trait-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`,
          )
          .join("") || '<p class="hint">No profile traits yet.</p>'
      }</div><div class="profile-section"><h3>Activity timeline <span class="hint">· ${num(p.events.length)} events</span></h3>${
        p.events
          .slice(0, 200)
          .map(
            (e) =>
              `<div class="timeline-item"><strong>${esc(e.name)}</strong><small>${date(e.timestamp)}</small><p>${esc(e.properties[`${e.source}/page`] || "")}<br>${new Date(e.timestamp).toLocaleTimeString()} · ${esc(e.source)}${e.properties[`${e.source}/utm_source`] ? ` · ${esc(e.properties[`${e.source}/utm_source`])}` : ""}</p>${Object.entries(
                e.properties,
              )
                .filter(
                  ([key]) =>
                    ![`${e.source}/page`, `${e.source}/utm_source`].includes(
                      key,
                    ),
                )
                .map(
                  ([key, value]) =>
                    `<p><strong>${esc(key)}:</strong> ${esc(typeof value === "object" ? JSON.stringify(value) : value)}</p>`,
                )
                .join("")}</div>`,
          )
          .join("") || '<p class="hint">No tracked events for this person.</p>'
      }${p.events.length > 200 ? '<p class="hint">Showing the latest 200 events.</p>' : ""}</div></section></div>`;
    $("#overlay .close").focus();
    const section = document.createElement("div");
    section.className = "profile-section";
    section.innerHTML =
      '<button class="button danger" id="delete-person">Delete person</button>';
    $("#overlay .drawer").append(section);
    $("#delete-person").onclick = () => confirmDeletePeople([id]);
  } catch (e) {
    toast(e.message);
  }
}
