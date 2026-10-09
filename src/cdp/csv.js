export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (quoted || value === "") quoted = !quoted;
      else throw new Error("Unexpected quote in CSV");
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      if (row.length > 1 || row.some((v) => v !== "")) rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  row.push(value);
  if (row.length > 1 || row.some((v) => v !== "")) rows.push(row);
  const headers = (rows.shift() || []).map((s) => s.trim());
  if (
    !headers.length ||
    headers.some((h) => !h) ||
    new Set(headers).size !== headers.length
  )
    throw new Error("CSV needs unique, nonempty column headers");
  return {
    headers,
    rows: rows.map((r, index) => ({
      line: index + 2,
      values: r,
      data: Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])),
    })),
  };
}
export function defaultMapping(headers) {
  return headers.map((column) => ({
    column,
    target:
      {
        email: "email",
        user_id: "external_id",
        visitor_id: "anonymous_id",
        timestamp: "timestamp",
        event_name: "event_name",
        name: "name",
      }[column] || "trait",
    name: column,
    type: /_at$|_date$|timestamp/.test(column) ? "date" : "string",
  }));
}
export function convert(v, type) {
  if (type === "number") {
    if (!Number.isFinite(Number(v))) throw new Error("Invalid number");
    return Number(v);
  }
  if (type === "boolean") {
    if (!/^(true|false|1|0|yes|no)$/i.test(v))
      throw new Error("Invalid boolean");
    return /^(true|1|yes)$/i.test(v);
  }
  if (type === "date") {
    if (Number.isNaN(Date.parse(v))) throw new Error("Invalid date");
    return new Date(v).toISOString();
  }
  return v.trim();
}
