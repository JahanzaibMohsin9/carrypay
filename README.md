# CarryPay

**Never carry cash across borders again.**

CarryPay is an AI agent that pays a family's hospital and university bills abroad: legally, safely and for less. It emails the institution, reads invoices, checks the home country's foreign-exchange rules, compares every way to pay, prepares the regulatory forms, asks the family for a fingerprint approval, tracks the money, fixes returned transfers, checks the final bill line by line and claims refunds.

Built for the 2026 Shenzhen International FinTech Competition, International Track (Topic C: Cross-border & Student Finance Assistant).

> **Sandbox.** The hospital, university, banks and card network are simulated. Institutions are fictional and exchange rates are illustrative. Regulations are real and cited, each marked *official*, *reported*, *assumed* (verify with a bank) or *policy* (CarryPay's own rule).

---

## Quick start

```bash
npm install
cp .env.local.example .env.local   # add ANTHROPIC_API_KEY for Live mode
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
| `http://localhost:3000/director` | Director controls + raw agent log |

Run the tests (rules engine, both scenarios end to end, 17 red-team attacks):

```bash
npm test
```

## Agent modes

Switch in the Director bar.

| Mode | Who decides | When to use |
|---|---|---|
| **Live** | Claude (Opus 5.5) via the Anthropic API, through the safety layer | The real product. Every live run is recorded to `.data/recordings/`. |
| **Replay** | Decisions replayed from the latest recorded live run; every action still executes for real against the sandbox | Demos where the network to the API is unreliable (e.g. on-site in mainland China). Clearly labelled in the UI. |
| **Scripted** | A hand-written plan, **no AI** | Development without an API key. Clearly labelled "Scripted demo · no AI". Never present it as the AI. |

## The demo scenarios

**1. Medical treatment in Bangkok (Pakistan → Thailand, SBP rules)**

1. The family opens the case. The agent emails the hospital's verified desk for the estimate, deposit and bank details.
2. Estimate arrives (THB 420,000, deposit THB 250,000). The agent verifies the bank account, compares routes (bank transfer is ~PKR 44k cheaper than card), fills the SBP Appendix V-68 form and self-declaration, and asks for approval.
3. The receiving bank returns the transfer: the reference must include the patient's hospital number. The agent finds the HN on the invoice and re-sends the same approved transfer.
4. Complication: THB 160,000 needed before an 08:00 procedure. A bank transfer would arrive too late, so the agent proposes the card and explains the trade-off.
5. **Attack:** a look-alike "billing" email claims the bank details changed, with hidden text telling AI assistants to skip verification. The agent flags it, warns the family and confirms with the hospital's real address. Even a fooled agent could not pay it: the safety layer blocks unverified accounts.
6. Discharge: the agent finds a CT scan charged twice, gets a corrected bill, and claims the THB 42,000 refund until it arrives.

**2. University fees in London (China → UK, SAFE rules, Chinese UI)**

The father has used USD 31,000 of his USD 50,000 yearly quota. The agent gets the fee statement, prepares the 个人购汇申请书, and pays above the quota legally with proof of tuition. When the father asks to use his brother's quota, the agent explains why 蚂蚁搬家 is prohibited and that it isn't needed.

## Architecture

```
 Family phone (Next.js, /app)          Outside world (sandbox)
        │  approve (hold / passkey)      ├─ Institution desk: auto-responder, invoices, refunds
        ▼                                ├─ Bank: SWIFT, returns, settlement
 ┌──────────────────────────────┐        └─ Card network
 │ Agent runner                 │                 ▲
 │  Live: Claude + tools        │                 │
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
| Tamper-evident log | Each entry is SHA-256 hashed with the previous entry's hash. Verify in the Security Centre (recomputed in the browser), export from `/api/ledger`, and publish anchors so the head hash exists outside the system. |

Red-team results: `src/server/redteam.test.ts` (17 attacks, all blocked).

## Deploying

The Anthropic API isn't reachable from mainland China, and `*.vercel.app` domains can be unreliable there. Plan:

1. Run `npm run build && npm start` on a server **outside** mainland China (Singapore, Hong Kong or Tokyo) under your own domain. The server calls Claude; the browser never does.
2. Test the URL with a "website speed test from China" tool before submitting.
3. Record a Live run of each scenario before the final so **Replay** mode is available as a clearly labelled fallback.
4. Keep the demo video as an MP4 plus a link reachable from China (e.g. Bilibili), not only YouTube.

State is kept in `.data/` on the server, so run it as a long-lived Node process, not serverless functions.

## Verify before relying on it

- PK education remittance rule (`PK.EDU.REMIT`) is marked *assumed*. Confirm with a bank.
- Fees, FX markups and the sandbox exchange rates are illustrative.
