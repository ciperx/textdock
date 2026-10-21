// Paid agent: three deterministic text/data capabilities behind x402 (USDC on Base),
// exposed both as plain REST routes and as an MCP streamable-HTTP endpoint.
// No LLM calls, no secrets, no user data stored. Every response is computed in one request.
const express = require("express");
const { paymentMiddleware, x402ResourceServer } = require("@x402/express");
const { ExactEvmScheme } = require("@x402/evm/exact/server");
const { HTTPFacilitatorClient } = require("@x402/core/server");
const { declareDiscoveryExtension } = require("@x402/extensions/bazaar");

const PAY_TO = process.env.PAY_TO || "0x226ea74D26E2aA98973Dc35ffE7E66fa2e3B2588";
const PORT = Number(process.env.PORT || 8793);

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "textdock", version: "1.1.0" }));

// Discovery for x402 indexers (x402scan, Bazaar): OpenAPI first, .well-known as compatibility.
const RESOURCES = [
  "https://textdock.ggez.my.id/csv_clean",
  "https://textdock.ggez.my.id/url_metadata",
  "https://textdock.ggez.my.id/text_stats",
  "https://textdock.ggez.my.id/mcp",
];
const OWNER = [PAY_TO];

app.get("/.well-known/x402", (_req, res) => res.json({ version: 1, resources: RESOURCES, ownershipProofs: OWNER }));

const payInfo = (amount, desc) => ({
  price: { mode: "fixed", currency: "USD", amount },
  protocols: ["x402"],
  network: "base",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: PAY_TO,
  description: desc,
});
const op402 = (desc) => ({
  description: desc,
  responses: {
    200: { description: "Result" },
    402: {
      description: "Payment required (x402)",
      headers: { "Payment-Required": { schema: { type: "string" } } },
    },
  },
});
app.get("/openapi.json", (_req, res) => res.json({
  openapi: "3.1.0",
  info: { title: "Textdock", version: "1.1.0", description: "Deterministic CSV, URL and text utilities sold per call in USDC on Base.", "x-guidance": "POST a JSON body to any path. Without X-PAYMENT the server returns 402 with the exact USDC amount on Base; pay it and retry with the X-PAYMENT header to get the result." },
  "x-discovery": { ownershipProofs: OWNER },
  servers: [{ url: "https://textdock.ggez.my.id" }],
  paths: {
    "/csv_clean": {
      post: {
        ...op402("Trim, dedupe, drop empty rows from a CSV and report what changed."),
        "x-payment-info": payInfo("0.01", "csv_clean"),
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["csv"], properties: { csv: { type: "string" }, key_columns: { type: "array", items: { type: "string" } }, drop_empty: { type: "boolean" } } } } } },
      },
    },
    "/url_metadata": {
      post: {
        ...op402("Fetch an http(s) URL and return status, final URL, title, description, OG tags, link and JSON-LD counts."),
        "x-payment-info": payInfo("0.02", "url_metadata"),
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string" } } } } } },
      },
    },
    "/text_stats": {
      post: {
        ...op402("Characters, words, sentences, reading time and top terms for a text block."),
        "x-payment-info": payInfo("0.01", "text_stats"),
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["text"], properties: { text: { type: "string" }, top_n: { type: "integer" } } } } } },
      },
    },
    "/mcp": {
      post: {
        ...op402("MCP streamable-HTTP endpoint exposing the same three tools."),
        "x-payment-info": payInfo("0.01", "mcp tools/call"),
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["jsonrpc", "method"], properties: { jsonrpc: { type: "string" }, id: {}, method: { type: "string" }, params: { type: "object" } } } } } },
      },
    },
  },
}));

// MCP handshake must answer 200 to marketplace probes (initialize, tools/list, ping);
// only tools/call is metered. Registered before the paywall so probes are not charged.
app.use((req, res, next) => {
  const m = req.body && req.body.method;
  if (req.method === "POST" && req.path === "/mcp" && ["initialize", "tools/list", "ping"].includes(m)) {
    return handleMcp(req, res);
  }
  return next();
});

// Paywall: x402 v2 (eip155:8453) so indexers and v2 clients can buy. DEV_UNPAID=1 skips it
// so examples/ can be captured from the very same handlers; production always charges.
const facilitatorClient = new HTTPFacilitatorClient({
  url: process.env.FACILITATOR_URL || "https://facilitator.daydreams.systems",
});
const resourceServer = new x402ResourceServer(facilitatorClient).register("eip155:8453", new ExactEvmScheme());

const ROUTES = {
  "POST /csv_clean": {
    accepts: { scheme: "exact", price: "$0.01", network: "eip155:8453", payTo: PAY_TO },
    extensions: {
      ...declareDiscoveryExtension({
        input: { csv: "id,name\n1,ada\n1,ada\n2,grace", key_columns: ["id"], drop_empty: true },
        inputSchema: {
          properties: { csv: { type: "string" }, key_columns: { type: "array", items: { type: "string" } }, drop_empty: { type: "boolean" } },
          required: ["csv"],
        },
        bodyType: "json",
        output: { example: { columns: ["id", "name"], rows: 2, data: [["1", "ada"], ["2", "grace"]], dropped_empty: 0, dropped_duplicates: 1, dedupe_key: ["id"], warnings: [] } },
      }),
    },
  },
  "POST /url_metadata": {
    accepts: { scheme: "exact", price: "$0.02", network: "eip155:8453", payTo: PAY_TO },
    extensions: {
      ...declareDiscoveryExtension({
        input: { url: "https://example.com" },
        inputSchema: { properties: { url: { type: "string" } }, required: ["url"] },
        bodyType: "json",
        output: { example: { url: "https://example.com/", http_status: 200, final_url: "https://example.com/", title: "Example Domain", bytes: 1256, elapsed_ms: 180, links: 1, jsonld_blocks: 0 } },
      }),
    },
  },
  "POST /text_stats": {
    accepts: { scheme: "exact", price: "$0.01", network: "eip155:8453", payTo: PAY_TO },
    extensions: {
      ...declareDiscoveryExtension({
        input: { text: "market market buyer seller", top_n: 10 },
        inputSchema: { properties: { text: { type: "string" }, top_n: { type: "integer" } }, required: ["text"] },
        bodyType: "json",
        output: { example: { characters: 26, words: 4, sentences: 1, paragraphs: 1, reading_time_seconds: 1, top_terms: [{ term: "market", count: 2 }, { term: "buyer", count: 1 }] } },
      }),
    },
  },
  "POST /mcp": {
    accepts: { scheme: "exact", price: "$0.01", network: "eip155:8453", payTo: PAY_TO },
    extensions: {
      ...declareDiscoveryExtension({
        input: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "text_stats", arguments: { text: "hello world" } } },
        inputSchema: {
          properties: { jsonrpc: { type: "string" }, id: {}, method: { type: "string" }, params: { type: "object" } },
          required: ["jsonrpc", "method"],
        },
        bodyType: "json",
        output: { example: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "{\"words\":2}" }], isError: false } } },
      }),
    },
  },
};

if (process.env.DEV_UNPAID !== "1") {
  app.use(paymentMiddleware(ROUTES, resourceServer));
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

function csvClean(body) {
  const { csv, key_columns, drop_empty = true } = body || {};
  if (typeof csv !== "string" || csv.trim() === "") {
    return { status: 422, body: { error: "csv must be a non-empty string" } };
  }
  const { header, rows } = parseCsv(csv);
  if (header.length === 0) return { status: 422, body: { error: "no header row found" } };
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
    if (r.length !== width) warnings.push("row shorter or longer than header; padded or trimmed");
    const sig = keyIdx.map((i) => row[i]).join("\u0001");
    if (seen.has(sig)) { dropped_duplicates += 1; continue; }
    seen.add(sig);
    kept.push(row);
  }
  return {
    status: 200,
    body: {
      columns: header,
      rows: kept.length,
      data: kept,
      dropped_empty,
      dropped_duplicates,
      dedupe_key: keyIdx.map((i) => header[i]),
      warnings: [...new Set(warnings)],
    },
  };
}

async function urlMetadata(body) {
  const { url } = body || {};
  let target;
  try { target = new URL(String(url)); } catch { return { status: 422, body: { error: "url must be an absolute http(s) URL" } }; }
  if (!/^https?:$/.test(target.protocol)) return { status: 422, body: { error: "only http and https are allowed" } };
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(target.href, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "textdock/1.1 (+lax paid agent)", accept: "text/html,*/*;q=0.5" },
    });
    clearTimeout(timer);
    const buf = Buffer.from(await r.arrayBuffer());
    const html = buf.subarray(0, 400000).toString("utf8");
    const pick = (re) => { const m = html.match(re); return m ? m[1].trim().slice(0, 500) : null; };
    const og = {};
    for (const m of html.matchAll(/<meta[^>]+property=["']og:([a-z:_]+)["'][^>]+content=["']([^"']*)["']/gi)) og[m[1]] = m[2].slice(0, 300);
    const titleTag = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDesc = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
    return {
      status: 200,
      body: {
        url: target.href,
        http_status: r.status,
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
      },
    };
  } catch (err) {
    const msg = err && err.name === "AbortError" ? "fetch timed out after 12s" : `fetch failed: ${err.message}`;
    return { status: 502, body: { error: msg, url: target.href } };
  }
}

function textStats(body) {
  const { text, top_n = 10 } = body || {};
  if (typeof text !== "string" || text.trim() === "") return { status: 422, body: { error: "text must be a non-empty string" } };
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) || [];
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().length > 0).length;
  const freq = new Map();
  const stop = new Set("the a an and or but if then than that this these those of in on at to for from with by as is are was were be been it its i you we they he she not no do does did so very can will just".split(" "));
  for (const w of words) if (!stop.has(w) && w.length > 2) freq.set(w, (freq.get(w) || 0) + 1);
  const top_terms = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, Math.min(Number(top_n) || 10, 50));
  return {
    status: 200,
    body: {
      characters: text.length,
      characters_no_spaces: text.replace(/\s/g, "").length,
      words: words.length,
      sentences,
      paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
      reading_time_seconds: Math.round((words.length / 220) * 60),
      avg_word_length: words.length ? Number((words.reduce((s, w) => s + w.length, 0) / words.length).toFixed(2)) : 0,
      top_terms: top_terms.map(([term, count]) => ({ term, count })),
    },
  };
}

const send = (res, out) => res.status(out.status).json(out.body);

app.post("/csv_clean", (req, res) => send(res, csvClean(req.body)));
app.post("/url_metadata", async (req, res) => send(res, await urlMetadata(req.body)));
app.post("/text_stats", (req, res) => send(res, textStats(req.body)));

// ---- MCP over streamable HTTP (JSON-RPC 2.0) ----
const TOOLS = [
  {
    name: "csv_clean",
    description: "Trim cells, drop empty rows, dedupe on chosen key columns, and report what changed.",
    inputSchema: {
      type: "object",
      required: ["csv"],
      properties: {
        csv: { type: "string", description: "CSV text with a header row" },
        key_columns: { type: "array", items: { type: "string" }, description: "columns defining a duplicate; all when omitted" },
        drop_empty: { type: "boolean", default: true },
      },
    },
  },
  {
    name: "url_metadata",
    description: "Fetch an http(s) URL (12s cap) and return status, final URL, title, description, OG tags, link and JSON-LD counts.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: { url: { type: "string", description: "absolute http or https URL" } },
    },
  },
  {
    name: "text_stats",
    description: "Characters, words, sentences, paragraphs, reading time at 220 wpm, and top terms.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string" }, top_n: { type: "integer", default: 10 } },
    },
  },
];

async function callTool(name, args) {
  if (name === "csv_clean") return csvClean(args);
  if (name === "url_metadata") return urlMetadata(args);
  if (name === "text_stats") return textStats(args);
  return { status: 404, body: { error: `unknown tool: ${name}` } };
}

async function handleMcp(req, res) {
  const msg = req.body || {};
  const id = msg.id === undefined ? null : msg.id;
  const reply = (result) => res.json({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => res.json({ jsonrpc: "2.0", id, error: { code, message } });

  if (msg.method === "initialize") {
    return reply({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "textdock", version: "1.1.0" },
      instructions: "Deterministic CSV, URL and text utilities, priced per call in USDC on Base.",
    });
  }
  if (msg.method === "tools/list") return reply({ tools: TOOLS });
  if (msg.method === "ping") return reply({});
  if (msg.method === "tools/call") {
    const name = msg.params && msg.params.name;
    const args = (msg.params && msg.params.arguments) || {};
    const out = await callTool(name, args);
    return reply({ content: [{ type: "text", text: JSON.stringify(out.body) }], isError: out.status >= 400 });
  }
  return fail(-32601, `method not found: ${msg.method}`);
}

// tools/call goes through the paywall registered above; the handshake is answered earlier.
app.post("/mcp", handleMcp);

app.use((_req, res) => res.status(404).json({ error: "unknown capability; see GET /health or POST /mcp" }));

app.listen(PORT, "127.0.0.1", () => console.log(`textdock listening on 127.0.0.1:${PORT} payTo=${PAY_TO}`));
