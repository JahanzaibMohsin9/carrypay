# CarryPay: technical documentation

*Draft, Oct 14 2026. Sections marked **(update after DeepSeek switch)** change when the provider adapter lands (see [PLAN.md](PLAN.md)).*

## 1. What the system does

CarryPay is an AI agent that pays a family's cross-border bills (hospital treatment, university fees) from the first invoice until the case is closed. It works for days, across several parties (the institution, the banks, the family), and only moves money with the family's biometric approval.

Topic: **C. Cross-border & Student Finance Assistant.**

Two working corridors:

| Corridor | Case | Regulations |
|---|---|---|
| Pakistan → Thailand | Medical treatment | State Bank of Pakistan FE rules, FBR card tax |
| China → United Kingdom | University fees | SAFE personal FX rules |

## 2. Architecture

```
 Family app (Next.js, mobile-first, EN/UR/ZH)
   │  approvals · messages · emergency stop
   ▼
 API (Next.js route handlers) ── SSE stream of changes ──► every screen updates live
   │
   ▼
 Agent runner (event-driven)
   │  wakes on: case opened · email · payment status · approval · family message · follow-up
   │  modes: Live (LLM) · Replay (recorded LLM run) · Scripted (no AI, dev only)
   ▼
 Safety gateway: every tool call passes here
   │  1 emergency stop   2 input schema   3 permission tier
   │  4 verified beneficiary   5 rules engine (limits, documents, forbidden patterns)
   ▼
 Sandbox world                         Hash-chained activity log
   institution auto-responders           SHA-256(entry + previous hash)
   bank: SWIFT, returns, settlement      verified in the browser
   card network, refunds                 exported as execution evidence
```

Code map:

| Path | Role |
|---|---|
| `src/domain/rules/packs/*.json` | Regulations as data, one file per country |
| `src/domain/rules/engine.ts` | Rules engine and route pricing (pure functions, shared by server and UI) |
| `src/domain/market.ts` | Sandbox FX rates and fee schedules |
| `src/server/agent/tools.ts` | 15 tools + the safety gateway (`executeTool`) |
| `src/server/agent/runner.ts` | Agent loop, recording and replay |
| `src/server/agent/prompt.ts` | System prompt and wake-up message |
| `src/server/agent/snapshot.ts` | Compact case state given to the model at each wake-up |
| `src/server/sim/` | Simulated institutions, bank and card rails, scenario beats |
| `src/server/store.ts`, `hash.ts` | World state persistence and the hash-chained ledger |
| `src/components/`, `src/app/` | Family app, demo stage, institution desk, bank console, director |

## 3. Core algorithms

### 3.1 Rules as versioned data

Each rule has an ID, a kind (`limit`, `tax`, `documents`, `requirement`, `forbidden`), the routes and purposes it applies to, its values, its **source** (title + URL), its **status** (`official`, `reported`, `assumed`, `policy`) and effective dates. Taxes keep a dated history; the engine picks the rate in force on the payment date. Example: Pakistan's advance tax on foreign card use is 5% before 2026-07-01 and 0.5% after. A policy change is a one-line edit to a JSON file, not a code change.

### 3.2 Route evaluation

`evaluateRoute()` takes the world, the case, the payer, the route and the amount, and returns:
- **blockers** (the payment must not happen), with the rule ID that blocks it
- **warnings** (allowed with conditions)
- **limits** touched: used, after this payment, cap
- **required documents**, and whether each is already on file

Usage is computed from all counted payments (awaiting approval, approved, in flight, completed) in the current calendar year, plus prior usage declared on the case. Anti-splitting: if one invoice is already being paid on a route by one person and another person is proposed for the same route while a per-person limit is involved, the engine blocks it (`CARRYPAY.NO_SPLITTING`, `CN.FX.NO_SPLITTING`). A payer who is not on the case (e.g. an uncle) is always blocked.

### 3.3 Route pricing and comparison

`priceRoute()` computes the full cost to the family in their home currency: delivered amount at the mid rate + FX markup + fees (flat, percentage with min/max, per-withdrawal, institution card surcharge) + taxes in force. `compareRoutes()` prices every legal route, adds the arrival time and whether it meets the invoice deadline, and sorts by cost. The agent picks the cheapest allowed route that arrives in time and explains the trade-off; the approval screen charts the **extra cost on top of the money itself** so differences between routes are visible.

### 3.4 Event-driven agent

The agent isn't a chat loop. It sleeps until something happens, then gets a fresh snapshot of the case plus what changed, works until it is waiting on someone, writes case notes (its memory between wake-ups), and stops. Triggers that arrive while it is working are queued and coalesced per case. Follow-ups it schedules wake it later (e.g. chase an unanswered email).

### 3.5 Recovery

Returned transfers come back with a reason (e.g. the receiving bank needs the patient's hospital number in the reference). The agent finds the missing data in the documents and calls `resubmit_payment`, which the gateway allows **without a new approval only if the beneficiary and amount are unchanged**, because the family approved exactly that payment.

### 3.6 Bill reconciliation

`reconcile_bill` matches the final bill line by line against payments, detects duplicate lines (same description and amount), and computes the balance or refund due with and without the duplicates. The agent disputes errors with the institution and claims refunds to the original account.

## 4. LLM integration

- **DeepSeek `deepseek-v4-pro`** in thinking mode with function calling, via the OpenAI SDK against `https://api.deepseek.com` (`src/server/agent/llm.ts`, `runner.ts`). Reasons: cost, and DeepSeek is reachable from mainland China.
- DeepSeek requires the model's `reasoning_content` to be sent back on every request when tools are used; the loop keeps it on each assistant message.
- **Fallback:** if DeepSeek returns an API error, the same wake-up is retried on OpenAI (`gpt-5.4-mini`) and the switch is logged. Our own safety checks never trigger a fallback.
- Malformed tool arguments are returned to the model as an error to correct, never executed.
- Tools are defined once as zod schemas, converted to JSON Schema for the API, and validated again by the gateway before running.
- Every tool input carries a `narration`: one sentence for the family's activity feed, in the family's language.
- The model's reasoning summary is logged and shown under "How CarryPay reasoned" in the feed.
- Live runs are recorded (tool name + input per step). Replay mode re-executes those decisions against the sandbox for demos with unreliable network access, labelled as a replay in the UI.

## 5. Tamper-evident activity log

Every action (tool call, policy decision, email, bank event, approval) is a ledger entry: `seq`, wall time, simulated time, actor, type, case, narration, data, `prevHash`, `hash`. The hash is SHA-256 over the canonical JSON (sorted keys) of the entry including the previous hash. Changing any past entry breaks every link after it.

- The Security Centre recomputes the whole chain **in the user's browser** (Web Crypto) and reports the first broken entry, if any.
- `/api/ledger` exports the log with the verification result: this is the execution evidence.
- Anchors record the head hash at a moment in time. Publishing them outside the system (submission email, git commit) prevents someone with database access from silently recomputing the whole chain.

## 6. Data and state

Sandbox state lives in `.data/` (world snapshot, ledger as JSONL, anchors, recordings). In production this would be a database plus an append-only log store. Institutions are fictional; FX rates and fees are illustrative and labelled "sandbox" in the UI.

## 7. Testing

`npm test` runs 31 tests:
- rules engine: tax history, pricing order, Pakistan caps, card limits, carried-cash rule, anti-splitting, SAFE quota and prohibited purposes, deadline-aware comparison
- both scenarios end to end with the scripted agent, including the returned transfer, the scam email, the bill dispute, the refund and a tamper check
- 17 red-team attacks on the safety layer (see [SECURITY.md](SECURITY.md))

## 8. Deployment **(update after deploy)**

Long-running Node process (`npm run build && npm start`) on a server outside mainland China, on our own domain, HTTPS. The server calls the LLM; the browser never does. Demo video hosted as MP4 plus a link reachable from China.
