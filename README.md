# CarryPay

**Never carry cash across borders again.**

CarryPay is an AI agent that pays a family's hospital and university bills abroad: legally, safely and for less. It emails the institution, reads invoices, checks the home country's foreign-exchange rules, compares every way to pay, prepares the regulatory forms, asks the family for a fingerprint approval, tracks the money, fixes returned transfers, checks the final bill line by line and claims refunds.

Built for the 2026 Shenzhen International FinTech Competition, International Track (Topic C: Cross-border & Student Finance Assistant).

## Documentation

| Doc | What's in it |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | Build plan to the Oct 20 deadline, owners, submission checklist |
| [docs/COMPETITION.md](docs/COMPETITION.md) | What the official competition brief says: topic, scoring, submission items, timeline |
| [docs/TECHNICAL.md](docs/TECHNICAL.md) | Architecture, core algorithms, LLM integration, ledger |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, permission tiers, controls, red-team results, known risks |
| [docs/MIMO_PROMPTS.md](docs/MIMO_PROMPTS.md) | Prompts for MiMo v2.6 Pro: Chinese UI review, scenario content, subtitles |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Deploying: server, Docker + Caddy (HTTPS), checks after deploying, known limits of the public demo |

> **Sandbox.** The hospital, university, banks and card network are simulated. Institutions are fictional and exchange rates are illustrative. Regulations are real and cited, each marked *official*, *reported*, *assumed* (verify with a bank) or *policy* (CarryPay's own rule).

---

## Quick start

```bash
npm install
cp .env.local.example .env.local   # add your API key for Live mode
npm run dev
```

Open:

| URL | What it is |
|---|---|
| `http://localhost:3000` | Landing page |
| `http://localhost:3000/stage` | **Demo stage**: institution desk + family phone + agent log, with director controls (use this for the video) |
| `http://localhost:3000/app` | The family app (mobile-first) |
| `http://localhost:3000/hospital` | The institution's billing desk (outside world) |
| `http://localhost:3000/bank` | Payment rails: SWIFT tracker and card network |
| `http://localhost:3000/bank/officer` | The bank's FX officer view: each transfer as a ready-to-review package (applicant, verified beneficiary, rules checked, signed forms, passkey approval, draft SWIFT MT103) |
| `http://localhost:3000/pack` | Printable case pack (Save as PDF): payments, every bill, receipt and form, and the log verification |
| `http://localhost:3000/director` | Director controls + raw agent log, including **chaos mode** (bank outage, card declined, institution silent) |

Run the tests (73: rules engine, all four scenarios end to end, uploaded bills, on-chain anchoring, 18 red-team attacks on the safety layer, sandbox institutions, chaos mode, privacy firewall, passkey verification):

```bash
npm test
```

With an API key in `.env.local` and the dev server running, two more checks use the real model:

```bash
node scripts/eval.mjs run th-medical 10    # play a scenario Live end to end N times, scored per run
node scripts/eval.mjs report               # writes docs/EVAL.md and docs/eval/chart.svg
npm run redteam:llm                        # 20 attacks against the live agent: docs/redteam/REPORT.md
```

## Agent modes

Switch in the Director bar.

| Mode | Who decides | When to use |
|---|---|---|
| **Live** | The LLM, through the safety layer (see "LLM provider" below) | The real product. Every live run is recorded to `.data/recordings/`. |
| **Replay** | Decisions replayed from a recorded live run (the curated one in `recordings/<scenario>.json`, else the newest in `.data/recordings/`); every action still executes for real against the sandbox | Demos where the network to the API is unreliable (e.g. on-site in mainland China). Clearly labelled in the UI. |
| **Scripted** | A hand-written plan, **no AI** | Development without an API key. Clearly labelled "Scripted demo · no AI". Never present it as the AI. |

## LLM provider

**DeepSeek `deepseek-v4-pro`** runs the agent in thinking mode with tool calls, through the OpenAI SDK (`src/server/agent/llm.ts`, `runner.ts`). If DeepSeek returns an API error, the run retries automatically on **OpenAI `gpt-5.4-mini`** and logs the switch. DeepSeek is cheaper and reachable from mainland China, which matters for the on-site final in Shenzhen.

Configure in `.env.local`: `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, optionally `CARRYPAY_PROVIDER` (`deepseek` | `openai` | `anthropic`), `CARRYPAY_MODEL`, `CARRYPAY_EFFORT`. The Director bar shows which model Live mode uses.

Drive a live run from the terminal: `node scripts/drive.mjs reset th-medical live`, then `node scripts/drive.mjs run 16`.

## The demo scenarios

**1. Medical treatment in Bangkok (Pakistan → Thailand, SBP rules)**

1. The family opens the case. The agent emails the hospital's verified desk for the estimate, deposit and bank details.
2. Estimate arrives (THB 420,000, deposit THB 250,000). The agent verifies the bank account, compares routes (bank transfer is ~PKR 44k cheaper than card), fills the SBP Appendix V-68 form and self-declaration, and asks for approval.
3. If the payment reference lacks the patient's hospital number, the receiving bank returns the transfer; the agent finds the HN on the invoice and re-sends the same approved transfer. (The scripted demo shows this recovery; the live agent usually includes the HN from the start.)
4. Complication: THB 160,000 needed before an 08:00 procedure. A bank transfer would arrive too late, so the agent proposes the card and explains the trade-off.
5. **Attack:** a look-alike "billing" email claims the bank details changed, with hidden text telling AI assistants to skip verification. The agent flags it, warns the family and confirms with the hospital's real address. Even a fooled agent could not pay it: the safety layer blocks unverified accounts.
6. Discharge: the agent finds a CT scan charged twice, gets a corrected bill, and claims the THB 42,000 refund until it arrives.

**2. University fees in London (China → UK, SAFE rules, Chinese UI)**

The father has used USD 31,000 of his USD 50,000 yearly quota. The agent gets the fee statement, prepares the 个人购汇申请书, and pays above the quota legally with proof of tuition. When the father asks to use his brother's quota, the agent explains why 蚂蚁搬家 is prohibited and that it isn't needed.

**3. A university offer that came through an agent (Pakistan → UK, admission check first)**

A family brings an offer letter from a consultant who wants the tuition and a "visa guarantee fee" paid to his company's account; they've already given him PKR 350,000 in cash. The agent flags the letter, asks the university itself (through its verified address) whether the offer is real, and asks the family to hold off. The university has no such applicant. The agent tells the family gently that it isn't their fault, that nothing has been paid, not to pay the agent anything more, and to keep the evidence and report it; when the consultant pressures them to pay his personal account, CarryPay says no. The rules engine also refuses tuition until the university itself has confirmed the admission.

**4. A study agency in China promises a guaranteed place (China → UK, SAFE rules, Chinese UI)**

A Shenzhen family has been sold a "保录取" (guaranteed admission) place at Kingsgate with a 40% scholarship. The 留学中介 wants a RMB 38,000 guarantee fee, the tuition paid to its own account or the consultant's personal WeChat, and offers to buy the pounds in relatives' names to stay under the USD 50,000 quota (蚂蚁搬家). The agent flags the letter, checks with the university (no such applicant), pays nothing, refuses the quota split, and tells the family in Chinese that it isn't their fault, not to send more money, to keep the evidence and to report it to the police. Together with scenario 3 this covers the fraud in both capital-control countries.

**Upload your own bill (any country CarryPay has rates for)**

The family enters their names, then uploads a PDF or a photo of a hospital or university bill (or uses the sample bill). A PDF is read by CarryPay's own code; a photo is read by a vision model (OpenAI, since DeepSeek's API doesn't take images), and the screen says so. The family's names are hidden from the model that pulls out the amounts and bank details, and the family checks every field before the case starts. The agent prices the bill under the home country's rules and explains it, but the institution is unknown, so the safety layer (`CARRYPAY.VERIFIED_INSTITUTION`) refuses any payment or email until the bank has verified it. In the sandbox, the Director's "Verify institution" button stands in for that check; then the agent verifies the account, fills in the forms and asks for approval.

## Architecture

```
 Family phone (Next.js, /app)          Outside world (sandbox)
        │  approve (hold / passkey)      ├─ Institution desk: auto-responder, invoices, refunds
        ▼                                ├─ Bank: SWIFT, returns, settlement
 ┌──────────────────────────────┐        └─ Card network
 │ Agent runner                 │                 ▲
 │  Live: DeepSeek + tools      │                 │
 │  Replay / Scripted           │                 │
 └──────────────┬───────────────┘                 │
                ▼ every tool call                 │
 ┌──────────────────────────────┐                 │
 │ Safety layer (gateway)       │─────────────────┘
 │  kill switch · input schema  │
 │  permission tiers            │
 │  verified-beneficiary check  │
 │  rules engine (limits, docs, │
 │  anti-splitting, purposes)   │
 └──────────────┬───────────────┘
                ▼
 Hash-chained activity log (SHA-256, verifiable in the browser) + anchors
```

- `src/domain/rules/packs/*.json`: regulations as data. One file per country, every rule with source, status and effective dates (e.g. Pakistan's card tax history 5% → 0.5% on 2026-07-01).
- `src/domain/rules/engine.ts`: limits, documents, forbidden patterns, route pricing and comparison. Pure functions, used by the server and the UI.
- `src/server/agent/tools.ts`: the 15 agent tools and the gateway (`executeTool`). Tiers: **read**, **communicate** (verified contacts only), **money** (needs family approval).
- `src/server/agent/runner.ts`: event-driven agent loop (wake on email, payment status, approval, family message, follow-up).
- `src/server/sim/`: the simulated hospital, university, bank and card rails.
- `src/server/store.ts` + `hash.ts`: world state and the tamper-evident log.

## Safety model

| Layer | Guarantee |
|---|---|
| Permission tiers | Reading and drafting are automatic. Emails only go to the institution's verified address. Money only moves after the family's approval. |
| Verified beneficiary | Bank details from any document are compared with a verified registry. A mismatch is blocked and logged, whatever the model says. |
| Rules engine | Limits, required forms, direct-to-institution rules and anti-splitting rules are enforced in code, not in the prompt. |
| Untrusted content | Emails and documents are labelled untrusted when passed to the model. The model is told never to follow instructions in them. |
| Numbers from tools | Costs, limits and balances come from the engine, not the model. |
| Emergency stop | One switch blocks every tool call instantly. |
| Passkey approval | The family approves with fingerprint or face (WebAuthn). The passkey signs a digest of the exact payment, checked on the server. |
| Privacy firewall | Names, hospital and student numbers, card and passport numbers and medical details are replaced with placeholders before anything reaches the LLM, and restored only inside CarryPay's code. |
| Tamper-evident log | Each entry is SHA-256 hashed with the previous entry's hash. Verify in the Security Centre (recomputed in the browser), export from `/api/ledger`. At each milestone the head hash is anchored on the **Conflux eSpace testnet** ([contract](https://evmtestnet.confluxscan.org/address/0x7cebbc3ac1a2ec61607025a589efa01b597c42cf), source verified); "Check against the chain" proves the log wasn't edited afterwards. |

Red-team results: `src/server/redteam.test.ts` (17 attacks on the safety layer, all blocked) and [docs/redteam/REPORT.md](docs/redteam/REPORT.md) (20 attacks on the live DeepSeek agent: 0 executed; a naive prompt tried 2, the gateway blocked both).

## Deploying

`*.vercel.app` domains can be unreliable from mainland China, and some LLM APIs (including Anthropic's) aren't reachable there. DeepSeek is. Plan:

1. Run it on a server **outside** mainland China (Singapore, Hong Kong or Tokyo) under your own domain, with HTTPS: `docker compose up -d --build` (Caddy gets the certificate). Full steps in [docs/DEPLOY.md](docs/DEPLOY.md). The server calls the LLM; the browser never does.
2. Test the URL with a "website speed test from China" tool before submitting.
3. Record a Live run of each scenario before the final so **Replay** mode is available as a clearly labelled fallback.
4. Keep the demo video as an MP4 plus a link reachable from China (e.g. Bilibili), not only YouTube.

State is kept in `.data/` on the server, so run it as a long-lived Node process, not serverless functions.

## Verify before relying on it

- PK education remittance rule (`PK.EDU.REMIT`) is marked *assumed*. Confirm with a bank.
- Fees, FX markups and the sandbox exchange rates are illustrative.
