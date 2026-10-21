import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 8795;
const BASE = `http://127.0.0.1:${PORT}`;
let child;

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  child = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, DEV_UNPAID: "1", PORT: String(PORT) },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i += 1) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error("server did not start");
});

after(() => child && child.kill("SIGKILL"));

test("health reports the service", async () => {
  const r = await fetch(`${BASE}/health`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.service, "textdock");
});

test("csv_clean drops duplicates on the chosen key and empty rows", async () => {
  const csv = "email,name\nada@example.com,Ada\nada@example.com,Ada\n,,\ngrace@example.com,Grace\n";
  const { status, body } = await post("/csv_clean", { csv, key_columns: ["email"] });
  assert.equal(status, 200);
  assert.deepEqual(body.columns, ["email", "name"]);
  assert.equal(body.rows, 2);
  assert.equal(body.dropped_duplicates, 1);
  assert.equal(body.dropped_empty, 1);
  assert.deepEqual(body.dedupe_key, ["email"]);
  assert.deepEqual(body.data, [["ada@example.com", "Ada"], ["grace@example.com", "Grace"]]);
});

test("csv_clean pads short rows and warns about a missing key column", async () => {
  const { status, body } = await post("/csv_clean", { csv: "a,b\n1\n2,3,4\n", key_columns: ["missing"] });
  assert.equal(status, 200);
  assert.equal(body.columns.length, 2);
  assert.ok(body.warnings.some((w) => w.includes("key column not found")));
  assert.ok(body.warnings.some((w) => w.includes("shorter or longer")));
});

test("csv_clean rejects an empty payload", async () => {
  const { status, body } = await post("/csv_clean", { csv: "   " });
  assert.equal(status, 422);
  assert.match(body.error, /non-empty string/);
});

test("text_stats counts and ranks terms", async () => {
  const { status, body } = await post("/text_stats", { text: "market market buyer seller buyer market", top_n: 2 });
  assert.equal(status, 200);
  assert.equal(body.words, 6);
  assert.equal(body.top_terms[0].term, "market");
  assert.equal(body.top_terms[0].count, 3);
  assert.equal(body.reading_time_seconds, 2);
});

test("url_metadata refuses non-http schemes", async () => {
  const { status, body } = await post("/url_metadata", { url: "file:///etc/passwd" });
  assert.equal(status, 422);
  assert.match(body.error, /only http and https/);
});

test("unknown route is a 404 with a pointer", async () => {
  const { status, body } = await post("/nope", {});
  assert.equal(status, 404);
  assert.match(body.error, /unknown capability/);
});
