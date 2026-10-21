// Paid agent: three deterministic text/data capabilities behind x402 (USDC on Base).
// No LLM calls, no secrets, no user data stored. Every response is computed in one request.
const express = require("express");
const { paymentMiddleware } = require("x402-express");

const PAY_TO = process.env.PAY_TO || "0x226ea74D26E2aA98973Dc35ffE7E66fa2e3B2588";
const PORT = Number(process.env.PORT || 8793);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "textdock", version: "1.0.0" }));

// DEV_UNPAID=1 runs the same handlers with the paywall off, bound to localhost only.
// It exists so examples/ can be captured from the real code paths; production keeps the 402.
if (process.env.DEV_UNPAID !== "1") {
app.use(
  paymentMiddleware(
    PAY_TO,
    {
      "POST /csv_clean": {
        price: "$0.01",
        network: "base",
        config: { description: "Normalise a CSV: trim, dedupe, drop empty rows, report what changed." },
      },
      "POST /url_metadata": {
        price: "$0.02",
        network: "base",
        config: { description: "Fetch a URL and return status, final URL, title, description, OG tags, link and JSON-LD counts." },
      },
      "POST /text_stats": {
        price: "$0.01",
        network: "base",
        config: { description: "Word/character/sentence counts, reading time, top terms for a text block." },
      },
    },
    { url: process.env.FACILITATOR_URL || "https://x402.org/facilitator" },
  ),
);
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { header: [], rows: [] };
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((l) => splitCsvLine(l).map((v) => v.trim()));
  return { header, rows };
}

app.post("/csv_clean", (req, res) => {
  const { csv, key_columns, drop_empty = true } = req.body || {};
  if (typeof csv !== "string" || csv.trim() === "") {
    return res.status(422).json({ error: "csv must be a non-empty string" });
  }
  const { header, rows } = parseCsv(csv);
  if (header.length === 0) return res.status(422).json({ error: "no header row found" });
  const width = header.length;
  const warnings = [];
  let dropped_empty = 0;
  let dropped_duplicates = 0;
  const kept = [];
  const seen = new Set();
  const keyIdx = Array.isArray(key_columns) && key_columns.length
    ? key_columns.map((k) => {
        const i = header.indexOf(k);
        if (i < 0) warnings.push(`key column not found: ${k}`);
        return i;
      }).filter((i) => i >= 0)
    : header.map((_, i) => i);

  for (const r of rows) {
    const row = r.slice(0, width);
    while (row.length < width) row.push("");
    if (drop_empty && row.every((v) => v === "")) { dropped_empty += 1; continue; }
    if (row.length !== r.length) warnings.push("row shorter or longer than header; padded or trimmed");
    const sig = keyIdx.map((i) => row[i]).join("\u0001");
    if (seen.has(sig)) { dropped_duplicates += 1; continue; }
    seen.add(sig);
    kept.push(row);
  }
  return res.json({
    columns: header,
    rows: kept.length,
    data: kept,
    dropped_empty,
    dropped_duplicates,
    dedupe_key: keyIdx.map((i) => header[i]),
    warnings: [...new Set(warnings)],
  });
});

app.post("/url_metadata", async (req, res) => {
  const { url } = req.body || {};
  let target;
  try { target = new URL(String(url)); } catch { return res.status(422).json({ error: "url must be an absolute http(s) URL" }); }
  if (!/^https?:$/.test(target.protocol)) return res.status(422).json({ error: "only http and https are allowed" });
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(target.href, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "textdock/1.0 (+lax paid agent)", accept: "text/html,*/*;q=0.5" },
    });
    clearTimeout(timer);
    const buf = Buffer.from(await r.arrayBuffer());
    const html = buf.subarray(0, 400000).toString("utf8");
    const pick = (re) => { const m = html.match(re); return m ? m[1].trim().slice(0, 500) : null; };
    const og = {};
    for (const m of html.matchAll(/<meta[^>]+property=["']og:([a-z:_]+)["'][^>]+content=["']([^"']*)["']/gi)) og[m[1]] = m[2].slice(0, 300);
    const titleTag = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDesc = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
    return res.json({
      url: target.href,
      status: r.status,
      final_url: r.url,
      content_type: r.headers.get("content-type"),
      bytes: buf.length,
      elapsed_ms: Date.now() - started,
      title: og.title || titleTag,
      description: og.description || metaDesc,
      og,
      links: (html.match(/<a\s/gi) || []).length,
      jsonld_blocks: (html.match(/application\/ld\+json/gi) || []).length,
      is_html: /html/i.test(r.headers.get("content-type") || ""),
    });
  } catch (err) {
    const msg = err && err.name === "AbortError" ? "fetch timed out after 12s" : `fetch failed: ${err.message}`;
    return res.status(502).json({ error: msg, url: target.href });
  }
});

app.post("/text_stats", (req, res) => {
  const { text, top_n = 10 } = req.body || {};
  if (typeof text !== "string" || text.trim() === "") return res.status(422).json({ error: "text must be a non-empty string" });
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) || [];
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().length > 0).length;
  const freq = new Map();
  const stop = new Set("the a an and or but if then than that this these those of in on at to for from with by as is are was were be been it its i you we they he she not no do does did so very can will just".split(" "));
  for (const w of words) if (!stop.has(w) && w.length > 2) freq.set(w, (freq.get(w) || 0) + 1);
  const top_terms = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, Math.min(Number(top_n) || 10, 50));
  return res.json({
    characters: text.length,
    characters_no_spaces: text.replace(/\s/g, "").length,
    words: words.length,
    sentences,
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
    reading_time_seconds: Math.round((words.length / 220) * 60),
    avg_word_length: words.length ? Number((words.reduce((s, w) => s + w.length, 0) / words.length).toFixed(2)) : 0,
    top_terms: top_terms.map(([term, count]) => ({ term, count })),
  });
});

app.use((_req, res) => res.status(404).json({ error: "unknown capability; see GET /health" }));

app.listen(PORT, "127.0.0.1", () => console.log(`textdock listening on 127.0.0.1:${PORT} payTo=${PAY_TO}`));
