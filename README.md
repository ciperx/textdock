# Textdock

A paid agent that sells deterministic text and table utilities per call, priced in USDC on Base over
x402. No model in the loop: the same input always returns the same answer, which is what a buyer
wants when they are paying $0.01 for a transformation rather than for prose.

- Live endpoint: **https://textdock.ggez.my.id**
- Health (free): `GET https://textdock.ggez.my.id/health`
- LAX listing: *pending* — the listing fee is 0.01 USDC on Base and the operator wallet is empty at
  the time of writing. Everything else in this repository is finished and tested.
- Payout address: `0x226ea74D26E2aA98973Dc35ffE7E66fa2e3B2588`
- Refuses: anything that is not an http(s) URL on `/url_metadata`, empty payloads, bodies over 1 MB,
  and any request without a settled x402 payment.

## Capabilities and price

| capability   | price  | what it returns |
| ------------ | ------ | --------------- |
| `csv.clean`     | $0.01 | trimmed cells, dedupe on chosen key, counts of dropped duplicate and empty rows, warnings |
| `url.metadata`  | $0.02 | status, final URL, title, description, Open Graph tags, link and JSON-LD counts, 12 s cap |
| `text.stats`    | $0.01 | characters, words, sentences, paragraphs, reading time at 220 wpm, top terms |

Each price is per call. Unpaid calls answer `402` with the x402 terms for `network: base`, asset
USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, paid straight to the payout address.

## Install and run

```bash
npm install
npm test          # 7 tests over the real HTTP handlers
PORT=8793 npm start
```

`DEV_UNPAID=1` turns the paywall off for a local instance so examples can be captured from the same
handlers; production never sets it.

## Run it behind a tunnel

The live instance runs on a small VPS behind a Cloudflare tunnel:

```bash
cloudflared tunnel create textdock
cloudflared tunnel --config ~/.cloudflared/textdock.yml route dns --overwrite-dns textdock textdock.ggez.my.id
systemctl enable --now cloudflared-textdock textdock
```

## Examples

`examples/` holds three real request/response pairs, captured from the handlers by
`capture.mjs`: `csv_clean.json`, `url_metadata.json`, `text_stats.json`. Their shapes match the
`input_schema` and `output_schema` in `lax-offer.json`.

```bash
DEV_UNPAID=1 PORT=8794 node server.js &
node capture.mjs
```

## Cost

There is no metered upstream: the agent makes no paid API calls. The only cost is the VPS slice it
shares with other services and the Cloudflare tunnel, both flat and already paid for. Marginal cost
per call is bandwidth and CPU, well under a tenth of a cent, so a $0.01 call is profitable at any
volume the tunnel will carry.

## What is verified and what is not

- Verified: `npm test` 7/7 over HTTP; public endpoint answers `200` on `/health` and `402` with Base
  USDC terms on every priced route.
- Not verified: an end-to-end settlement, because the operator wallet holds less than one call's
  price. The 402 terms are produced by `x402-express` against the default facilitator; the first
  funded call is the remaining proof.

## Files

- `server.js` — express app, three handlers, x402 middleware
- `lax-offer.json` — the LAX offer with per-capability schemas and prices
- `test/server.test.js` — seven tests, spawning the real server
- `capture.mjs` — writes `examples/` from the dev instance
