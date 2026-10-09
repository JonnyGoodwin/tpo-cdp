# TPO Customer Data Platform

A browser-based customer data platform inspired by Hull. JavaScript throughout: Node.js serves the app and uses its built-in SQLite module; the frontend uses HTML, CSS, and JavaScript. No runtime dependencies or build step.

## Run

Requires Node.js 22.13 or newer (Node.js 24+ recommended).

```sh
npm run dev
```

Open **http://localhost:8787**. Set `PORT` to change the port. The server binds to localhost. On first startup it imports `subscribers.csv`, `app_users.csv`, and `web_events.csv` from the `data/` directory. The original files are never modified. Durable data lives in `data/cdp.sqlite`; include that directory in local backups. Subsequent starts retain your profiles, imports, and segments.

## Use

Each page has its own URL: Overview (`/`), People (`/people`), Segments (`/segments`), Sources & imports (`/sources`), and Attributes (`/attributes`). Pages support direct links, refresh, and browser back/forward navigation.

- **Overview:** audience totals, source summaries, and recently active people.
- **People:** search emails and identities, filter identified/anonymous/subscriber/app profiles, inspect attributes and linked identities, browse event timelines, select profiles, and export filtered or selected people to CSV.
- **Segments:** live audiences using all/any conditions, nested groups, attribute comparisons, dates, event counts, and event name/property matches. Preview membership before saving; edit and delete saved segments.
- **Sources & imports:** upload CSV → choose a source and row type → map columns → validate → review projected changes → import. Click past imports to see saved mappings and rejected record numbers.
- **Attributes:** inspect source namespaces, inferred display types, examples, and population counts.

## Import rules

Files must be UTF-8 CSV with unique, nonempty headers; quoted commas, multiline fields, escaped quotes, BOMs, and CRLF are supported. The upload limit is 20 MB. Map at least one identity column (email, external ID, or visitor ID). For event imports also map a timestamp. A mapped event name is optional and defaults to `Page viewed`.

Emails are trimmed and lowercased, and match across sources. External IDs and visitor IDs are scoped to the source namespace. A visitor record that later includes a known email connects earlier anonymous events to that person. Merging is refused when it would combine different external IDs from the same source. Different identifiers from different sources can coexist on one profile.

Additional columns become `source/attribute` profile traits or event properties. Choose string, number, boolean, or date per column. Nonempty values update existing traits; empty cells preserve existing values. Multiple rows for the same identity apply in CSV order, with the last nonempty value winning. Existing profile traits win when two profiles are merged, then the incoming row applies. Imported timestamps are parsed by JavaScript; use ISO 8601 with an explicit timezone for reliable event times.

Each event is deduplicated by a hash of its source, mapped identities, timestamp, name, and properties. Reimporting the same file with the same mapping adds no duplicate events. A changed mapping, source, or event payload can produce a new event. Validation runs inside a rolled-back transaction; importing applies valid rows atomically and reports rejected rows separately. Record numbers count CSV records, including the header, rather than physical lines in multiline CSVs.

The supplied subscriber file contains eight empty records and two malformed emails; these are reported as rejected. The valid data produces 3,558 profiles (2,930 identified and 628 anonymous) and 10,000 events.

This is a local single-workspace application. It does not yet include multi-user authentication, hosted deployment, live vendor connectors, or account/company entities.

## Code layout

- `server.js`: startup, database location, and server binding.
- `src/cdp/`: SQLite access, CSV parsing and mapping, imports, profile queries, and segmentation.
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
