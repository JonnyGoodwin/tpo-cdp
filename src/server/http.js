export function send(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
export async function body(req) {
  // Vercel may provide a parsed body after consuming the incoming stream.
  if (req.body !== undefined) {
    const value =
      typeof req.body === "string" || Buffer.isBuffer(req.body)
        ? JSON.parse(req.body.toString() || "{}")
        : req.body;
    if (Buffer.byteLength(JSON.stringify(value)) > 20 * 1024 * 1024)
      throw new Error("Upload exceeds the 20 MB limit");
    return value;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024)
      throw new Error("Upload exceeds the 20 MB limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
export const csvCell = (v) =>
  '"' +
  String(v ?? "")
    .replaceAll('"', '""')
    .replace(/^[=+@\-]/, "'$&") +
  '"';
