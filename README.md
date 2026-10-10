# TPO Customer Data Platform

A browser-based customer data platform inspired by Hull. JavaScript throughout: Node.js serves the app and uses its built-in SQLite module; the frontend uses HTML, CSS, and JavaScript. No runtime dependencies or build step.

## Run

Requires Node.js 22.13 or newer (Node.js 24+ recommended).

```sh
npm run dev
```

Open **http://localhost:8787**. Set `PORT` to change the port. The server binds to localhost. On first startup it imports `subscribers.csv`, `app_users.csv`, and `web_events.csv` from the `data/` directory. The original files are never modified. Durable data lives in `data/cdp.sqlite`; include that directory in local backups. Subsequent starts retain your profiles, imports, and segments.

## Use

Each page has its own URL: Overview (`/`), People (`/people`), Segments (`/segments`), Sources & imports (`/sources`), Attributes (`/attributes`), and Connections (`/connections`). Pages support direct links, refresh, and browser back/forward navigation.

- **Overview:** audience totals, source summaries, and recently active people.
- **People:** search emails and identities, filter by segment, inspect attributes and linked identities, browse event timelines, select profiles, and export filtered or selected people to CSV, push them to a Connection, and delete individual or selected people after confirmation.
- **Segments:** live audiences using all/any conditions, nested groups, attribute comparisons, dates, event counts, and event name/property matches. Preview membership before saving; edit and delete saved segments.
- **Sources & imports:** upload CSV → choose a source and row type → map columns → validate → review projected changes → import. Click past imports to see saved mappings and rejected record numbers.
- **Attributes:** inspect source namespaces, inferred display types, examples, and population counts.
- **Connections:** write functions, select audiences, enable automatic entry triggers, manually push people, and inspect run history.

Deleting a person removes their profile, identities, events, audience memberships, and Connection history, and cancels queued or active function calls. Bulk deletion is atomic. Original source CSVs and copies already sent to external services are unchanged; importing their data again can recreate the profile.

## Connections

Open `/connections`, create a Connection, and write the body of an async JavaScript function. It receives `user` (a profile snapshot) and `context`, containing `fetch`, `settings`, `log`, and a unique `runId`. Settings are a JSON object of strings; API keys belong here rather than in the function source. Saved values are not returned by the listing API. They are stored locally in the ignored SQLite database, including snapshots for queued calls; they are not encrypted at rest. Only write trusted functions: workers enforce a 30-second timeout and memory limit, but are not a security sandbox.

Select a segment and enable the automatic trigger to run when a profile enters that audience. Existing members become the baseline without being pushed. Imports and segment edits detect entries immediately; a five-second check also handles changes from enrichment or time-based rules. Reimporting unchanged members does not queue another call; leaving and later re-entering queues a new call. Pausing and re-enabling starts with the current audience as the baseline. Check “Also push the current audience when I save” to explicitly backfill existing members.

From People, use **Push audience** for the current filtered audience, or select rows and use **Push** for just those people. Manual pushes work even when the automatic trigger is off. Every call stores its code, settings, and profile snapshot so later edits do not change queued calls. Calls run sequentially while the server is running. Queued calls survive restarts; interrupted calls become failed and are not automatically retried because an external action may already have happened. Run history shows the latest 100 calls, results, and errors. Use `context.runId` as an idempotency key where a destination supports one.

Set the Connection’s Source namespace to `pdl`. Returning `{ traits: { job_title: "Editor" } }` then saves attributes under `pdl/job_title`, preserving attributes from other sources. These traits can be used in segment rules. Starter templates use [Beehiiv’s create-subscription API](https://developers.beehiiv.com/api-reference/subscriptions/create) and [People Data Labs’ person-enrichment API](https://docs.peopledatalabs.com/docs/person-enrichment-api). Supply your own service credentials. Failed service responses are recorded as failed calls.

## App event webhook

Send `POST /webhooks/app` with a JSON body:

```json
{
  "event_id": "evt_9f3a1c",
  "event": "read_story",
  "user_id": "u_2b6447a3",
  "device_id": "d_4b21e8",
  "timestamp": "2026-09-28T14:22:05Z",
  "properties": { "story": "supreme-court-ruling-explained" }
}
```

Supported events are `app_open`, `read_story`, `link_click`, and `login`. Supply a nonempty `event_id` and `device_id`, an ISO datetime with a timezone, and a properties object. `user_id` must be a string or explicitly `null`; login requires a user ID. Known IDs are resolved using the email mapping in `data/app_users.csv`, joining subscriber profiles by normalized email. Unknown user IDs still create profiles with an `app:` external identity.

Device identities are scoped to `app`. When a device identifies its user, its existing anonymous events merge into that user's profile. Anonymous events arriving after login also resolve through that device link, even if their timestamps precede login. Arrival order never overwrites event time; `last_seen` is the latest event timestamp. Conflicting app user identities are rejected atomically instead of merging two different accounts.

Event IDs deduplicate persisted webhook events. The first delivery returns HTTP 201 with `{ "event_id": "...", "person_id": "...", "duplicate": false }`; retries return HTTP 200 and `duplicate: true`, retaining the first payload. Invalid payloads return HTTP 400 without creating identities or events. Device links and deduplication survive restarts. Properties are stored under the `app/` namespace, for example `app/story`, and event names are preserved as sent.

Successful calls are immediately available from `/api/state`, `/api/people/:id`, and segment previews, and update Connection audience membership. Refresh the workspace to load the latest events in the UI; no server restart is needed for event ingestion. The development server remains bound to localhost.

## Growth assistant

Open `/assistant` to ask for signup counts, currently cold subscribers, engaged readers, or first web pages after signup. Results include the calculation rules and the exact approved intent sent to AI, when AI is enabled. Count and audience results can be saved as live segments; first-page reports are aggregate tables. Saving uses all matching subscribers, not just the displayed top rows. Report previews expire after 30 minutes and on server restart.

The page is a conversational chat with chronological user/assistant messages, inline tables, and action buttons. Follow-ups such as “just Instagram”, “what about last month?”, “show the top 20”, “at least 5 reads”, and “how many is that?” refine the last approved query while preserving its other filters. **Refine this result** selects an earlier result as the context for your next question. **Save as segment** reports completion in chat; **View segment** opens the segment page. **Upload a list** opens the CSV upload, mapping, and review flow, then **Return to chat** adds an import summary. You can also type “I want to upload a list”. Neither uploaded files nor conversation history are sent to AI. Follow-up requests include only the previous validated enum/numeric plan, which is replaced by the current approved intent before calling the model. Chat history stays in browser memory across page navigation, and clears on reload or **New chat**. Enter sends a message; Shift+Enter inserts a newline.

The assistant works immediately with a local, constrained language parser. To enable optional OpenAI planning, copy `.env.example` to `.env`, set `OPENAI_API_KEY`, and restart the server. `OPENAI_MODEL` defaults to `gpt-5-mini`. `.env` is ignored by Git and loaded by `npm run dev` / `npm start`; the browser never receives the key. This is a bounded Growth assistant rather than an unrestricted chatbot: unsupported wording, personal details, negation, and unsupported filters ask for clarification rather than silently running arbitrary queries.

The privacy boundary is structural:

1. Raw questions stay on your computer. An allowlist recognizes supported Growth vocabulary and converts it into seven enum/numeric fields: report kind, acquisition channel, period, reading window, inactivity threshold, minimum reads, and row limit. It rejects unfamiliar terms and personal identifiers before any model request.
2. Only these approved values and a fixed schema are sent to OpenAI. No profiles, names, emails, user/device IDs, custom traits, URLs, raw questions, result counts, or rows are included. Responses requests use `store: false` and [strict Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses). This does not mean OpenAI's other API retention policies are disabled; the important protection is keeping identifying data out of the request entirely.
3. The server validates every returned field and requires it to preserve the locally interpreted intent. The model cannot provide SQL, code, arbitrary field names, tools, or new filters. Invalid, incomplete, or changed plans never execute.
4. SQLite and the existing segment engine calculate exact results locally. The UI renders those results directly; they are never sent back to the model for summarization. Reader tables use per-report `Reader 1` labels, with no persistent person identifiers. Page paths and any identifying path components remain local as well.
5. Saving a segment requires an explicit click and a server-issued preview token. Names and segment membership stay local. Questions and report history are not persisted; recent reports live only in browser/server memory.

Definitions are explicit: cold now means signup at least 30 days ago and a last newsletter open at least 30 days ago or missing. Missing opens do not prove inactivity. Historical “went cold last month” requires email-open history that this dataset does not contain, so the assistant asks whether you mean last month's signups that are cold now. Engagement defaults to at least three recorded `Page viewed` / `read_story` events in the past 30 days, ranked by read count; app opens and newsletter opens do not count. First pages use the earliest recorded web visit on or after signup, with query strings and fragments removed. Calendar months and date-only signups use UTC. New subscribers defaults to the past 30 days.

Supported examples include “How many Instagram signups last month?”, “How many Instagram signups from last month are cold now?”, “Build me a list of our most engaged readers”, “List engaged readers with at least 5 reads in the past 30 days”, and “Which pages do new subscribers hit first?”. Automatic tests verify outbound payloads, blocked personal details, invalid model plans, date boundaries, counts, ranking, first-page ordering, and saved segment membership. Live OpenAI requests require your own API key.

## Import rules

Files must be UTF-8 CSV with unique, nonempty headers; quoted commas, multiline fields, escaped quotes, BOMs, and CRLF are supported. The upload limit is 20 MB. Map at least one identity column (email, external ID, or visitor ID). For event imports also map a timestamp. A mapped event name is optional and defaults to `Page viewed`.

Emails are trimmed and lowercased, and match across sources. External IDs and visitor IDs are scoped to the source namespace. A visitor record that later includes a known email connects earlier anonymous events to that person. Merging is refused when it would combine different external IDs from the same source. Different identifiers from different sources can coexist on one profile.

Additional columns become `source/attribute` profile traits or event properties. Choose string, number, boolean, or date per column. Nonempty values update existing traits; empty cells preserve existing values. Multiple rows for the same identity apply in CSV order, with the last nonempty value winning. Existing profile traits win when two profiles are merged, then the incoming row applies. Imported timestamps are parsed by JavaScript; use ISO 8601 with an explicit timezone for reliable event times.

Each event is deduplicated by a hash of its source, mapped identities, timestamp, name, and properties. Reimporting the same file with the same mapping adds no duplicate events. A changed mapping, source, or event payload can produce a new event. Validation runs inside a rolled-back transaction; importing applies valid rows atomically and reports rejected rows separately. Record numbers count CSV records, including the header, rather than physical lines in multiline CSVs.

The supplied subscriber file contains eight empty records and two malformed emails; these are reported as rejected. The valid data produces 3,558 profiles (2,930 identified and 628 anonymous) and 10,000 events.

This is a local single-workspace application. It does not yet include multi-user authentication, hosted deployment or account/company entities.

## Code layout

- `server.js`: startup, database location, and server binding.
- `src/cdp/`: SQLite access, CSV parsing and mapping, imports, profile queries, and segmentation.
- `src/connections/`: durable audience membership and run queue, function workers, and execution history.
- `src/assistant/`: approved query vocabulary, optional AI planning, and local analytics execution.
- `src/server/`: initial data loading, HTTP helpers, and API routes grouped by feature.
- `static/app.js`: frontend startup, page routing, and shared event handling.
- `static/pages/`: one module per page.
- `static/dialogs/`: profile drawer, import wizard, and segment builder.
- `static/shared.js`: shared state, API client, and UI helpers.
- `static/styles/`: styles grouped by layout and component; `static/style.css` loads them in order.
- `data/`: source CSVs and the persistent SQLite database.
- `tests/` and `scripts/`: data tests and browser checks.

Use `npm run format` to format the code or `npm run format:check` to check formatting. The app still runs without a build step.

## Verify

```sh
npm test
```

Tests cover CSV parsing, typed mapping, dry-run rollback, persistence, identity conflicts, anonymous history merging, segmentation, and reimporting the supplied datasets.

Optional browser smoke check:

```sh
npm install
npm run test:browser
```

The smoke check starts its own server with an isolated temporary SQLite database, verifies import previews and commits, exports, profile search, nested segments, import history, attributes, and mobile layout, then removes the temporary database. Your workspace database is unchanged. It uses locally installed Google Chrome on macOS by default; set `CHROME_PATH` to use another Chrome/Chromium executable. Screenshots are saved in the system temporary directory.
