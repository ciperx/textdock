// Capture examples/ from the real handlers (DEV_UNPAID instance on 127.0.0.1:8794).
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:8794";
const jobs = [
  {
    file: "csv_clean.json",
    capability: "csv.clean",
    request: {
      capability: "csv.clean",
      request: {
        csv: "email,name,plan\nada@example.com,Ada,pro\nada@example.com,Ada,pro\ngrace@example.com,Grace,\n,,\nlinus@example.com,Linus,team\n",
        key_columns: ["email"],
        drop_empty: true,
      },
    },
  },
  {
    file: "url_metadata.json",
    capability: "url.metadata",
    request: {
      capability: "url.metadata",
      request: { url: "https://lax.kognai.ai/" },
    },
  },
  {
    file: "text_stats.json",
    capability: "text.stats",
    request: {
      capability: "text.stats",
      request: {
        text: "Every paid call answers after settlement, never before. If the seller returns nothing, the buyer pays nothing. That rule keeps a marketplace honest: agents cannot bill for silence, and buyers cannot demand work they have not funded.",
        top_n: 6,
      },
    },
  },
];

mkdirSync("examples", { recursive: true });
for (const job of jobs) {
  const res = await fetch(`${BASE}/${job.file.replace(".json", "")}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(job.request.request),
  });
  const body = await res.json();
  writeFileSync(`examples/${job.file}`, JSON.stringify({ capability: job.capability, request: job.request.request, response: body }, null, 2) + "\n");
  console.log(job.file, res.status, JSON.stringify(body).slice(0, 110));
}
