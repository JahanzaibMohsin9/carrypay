# Deploying CarryPay

CarryPay is one long-running Node process: the agent, the sandbox world, the timers and the live activity stream (server-sent events) all live in memory, with the world and the hash-chained log saved to a data folder. It needs a small server, not serverless functions.

## What to rent

- **Region:** outside mainland China but close to it, so judges in Shenzhen and families in Pakistan both get a fast page: Singapore, Hong Kong or Tokyo. No ICP licence is needed outside the mainland.
- **Size:** 1 vCPU, 1–2 GB RAM and 10 GB disk are enough. The model runs at DeepSeek/OpenAI, not on the server.
- **Domain:** any domain with an A record pointing at the server (`carrypay.app` and `carrypayments.com` were free on 14 Oct). HTTPS is required: passkeys and installing the app (PWA) only work on HTTPS.
- **Outbound access** to `api.deepseek.com` and `api.openai.com`.

## Run it (Docker)

```bash
git clone https://github.com/JahanzaibMohsin9/carrypay && cd carrypay
cp .env.local.example .env.production     # fill in DEEPSEEK_API_KEY, OPENAI_API_KEY
echo "CARRYPAY_DOMAIN=carrypay.app" > .env  # your domain, read by docker compose
docker compose up -d --build
```

Caddy gets and renews the certificate on its own, and passes the event stream through without buffering (`deploy/Caddyfile`). The world, log, recordings and passkeys are kept in the `carrypay-data` volume, so they survive restarts and rebuilds.

Update: `git pull && docker compose up -d --build`. Logs: `docker compose logs -f app`.

## Without Docker

```bash
npm ci && npm run build
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/ && cp -r recordings .next/standalone/
CARRYPAY_DATA_DIR=/var/lib/carrypay PORT=3000 node .next/standalone/server.js
```

Put it behind any HTTPS reverse proxy that doesn't buffer `text/event-stream` (for nginx: `proxy_buffering off;` on `/api/stream`). Keep it running with systemd or pm2.

## After deploying

1. Open `https://<domain>/director`, load each scenario in **Replay** and play it through: this needs no API key and shows the stream works through the proxy.
2. Switch to **Live** and run one scenario: checks the keys and outbound access.
3. Register a passkey on a phone and approve a payment with it (needs HTTPS and the real domain).
4. Install the app from the browser menu on Android (Chrome) and iPhone (Safari, Share → Add to Home Screen); check it opens full-screen on `/app`.
5. Test the URL with a "website speed test from China" tool, and from Pakistan if possible.

## Known limits of the public demo

- **One shared sandbox.** Everyone who opens the link sees and drives the same world; the Director's Reset starts it over. Fine for judging and the video; a product would give each family its own world.
- **Costs.** Live mode and reading uploaded photos call paid APIs. Keep Replay as the default for the public link, keep provider credit low, and watch usage during judging. The Director page is not protected, by design for the judges.
- **Sandbox only.** No real money, banks or institutions are involved; every institution, account and person in the scenarios is fictional, and the rates are sandbox rates.
