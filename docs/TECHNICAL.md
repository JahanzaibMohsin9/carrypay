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

The agent isn't a chat loop. It sleeps until something happens, then gets a fresh snapshot of the case plus what changed, works until it is waiting on someone, writes case notes (its memory between wake-ups), and stops. Events raised at the same moment (an approval and the card payment it settles) share one wake-up; triggers that arrive while it is working are queued and coalesced per case.

Avoiding loops and wasted wake-ups:
- The snapshot links each email the agent sent to the reply that answered it (`answered_by` or "awaiting reply") and lists the topics each reply answered, so the agent can see what has already been asked and answered.
- Follow-ups carry a `skip_if` condition (institution replied, payment completed, family decided, new invoice, refund received). When a follow-up falls due, code checks the condition and skips it without waking the agent if it has been met. The agent can also `cancel_followup`; at most four can be open per case.

### 3.4a Sandbox institutions

The hospital and university are rule-based auto-responders (`src/server/sim/institution.ts`). Like a competent back office, they answer **every** question in an email in one numbered reply: estimate or fee statement, bank details (signed letter once, then "unchanged"), fraud alerts, payment status, bill disputes, refunds, statements and admission confirmation. Things that don't exist yet get a real answer ("the final bill comes on discharge, around 8 November"; "the transfer hasn't arrived; we'll send the receipt, no need to check again"). A repeated refund request reports the refund's status instead of starting a second refund.

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
- Live runs are recorded (tool name + input per step). Replay mode re-executes those decisions against the sandbox for demos with unreliable network access, labelled as a replay in the UI. Curated best runs live in `recordings/<scenario>.json` (committed); Replay prefers them over the newest local run.
- Token usage is logged per wake-up (`agent.usage`), including DeepSeek's cache hits, so each case's AI cost is measured, not estimated.

### 4.1 Privacy firewall

Before each wake-up, `buildVault` (`src/server/agent/privacy.ts`) collects the case's personal data: names (full names, name parts, Chinese given names), hospital or student numbers, card labels, passport numbers, and medical terms. Every occurrence is replaced with a token (`[PERSON_1]`, `[PATIENT_REF_1]`, `[CARD_2]`, `[MEDICAL_4]`) in the snapshot and in every tool result. The model writes with the tokens ("reference HN [PATIENT_REF_1]"); the runner restores the real values in the tool input before the gateway runs it, so the hospital gets the real name and HN and the model never sees them. Recordings keep the tokens, and Replay restores them the same way. Each wake-up logs a `privacy.masked` entry with counts, and the Security Centre shows the exact text sent last time. Institution names, amounts, dates and verified bank accounts stay visible: the agent needs them and they are not personal data.

### 4.2 Passkey approvals

Approvals use WebAuthn passkeys without a third-party library (`src/server/passkey.ts`, `src/lib/passkey.ts`). Registration stores the credential's public key (SPKI) with attestation "none". For each approval the server issues a challenge equal to SHA-256 over the canonical payment (amount, currency, route, payer, beneficiary, reference) plus a one-time nonce, then verifies `clientDataJSON` (type, challenge, origin), the authenticator data (RP ID hash, user-present and user-verified flags) and the ES256/RS256/EdDSA signature with Node's `crypto`. Because the digest is recomputed from the payment at verification, a signature can't approve a changed amount or account, and it can't be replayed. The ledger entry for the approval records the method, device and challenge. "Hold to approve" stays as a fallback.

### 4.3 Scenario 3: a fake admission (Pakistan → UK)

A family brings an "unconditional offer" from Kingsgate University that came through an education consultant: fees and a "visa guarantee fee" are to be paid to the consultant's company account, the letter's contact is a gmail address, and they have already handed over PKR 350,000 in cash. The agent flags the letter, asks the university through its verified address whether the offer is real, and tells the family to hold off. The sandbox university checks its admissions records (`students` in the institution registry), finds no applicant, and says so. The agent then tells the family gently that it isn't their fault, that nothing has been paid, not to send the agent anything more, to keep the evidence and to report it. A day later the consultant pressures them to pay his personal account; the agent says no and explains why. Independently, the rules engine refuses tuition on any route until an institution-issued admission letter exists, and no invoice exists for a student who never applied.

### 4.4 Chaos mode

The Director can break the outside world mid-case, and the agent isn't told: it finds out the way it would in real life. **Bank outage**: the beneficiary bank bounces the next transfer ("temporarily unable to accept incoming payments"); the agent resends it unchanged, which the gateway allows without a new approval because beneficiary and amount are the same. **Card declined**: the issuer refuses the next card payment, nothing is charged, and the agent is woken with `payment_declined` to find another legal route or card before the deadline. **Institution silent**: the institution stops answering for 36 hours, then answers everything at once; the agent's follow-ups (with `skip_if`) carry the case through the silence. Each fault is logged (`chaos.injected`) and consumed when it fires.

### 4.5 Family and bank interfaces added Oct 14

- **Rule chips explain themselves.** Every rule ID shown in the app (approval checks, activity, threats, the bank view) opens a sheet with a plain-language explanation in the family's language, the rule's status (official, reported, assumed, CarryPay policy), the date in force and the source. Numbers in the explanations are read from the rule pack (`src/domain/rules/explain.ts`); a test fails if any rule lacks an explanation.
- **Across currencies** (Money tab): what left the family's account in PKR or CNY, what arrived in THB or GBP, the cost by route, exchange markup plus fees and tax, refunds back in home currency, and the all-in rate next to the mid-market rate. All from the engine-priced payments.
- **Bank officer view** (`/bank/officer`): the remittance package a bank's FX desk would review: applicant (with passport number, which the AI never sees), verified beneficiary, the rules engine's checks with rule chips, required documents with their origin and signature state, the family's passkey approval and payment digest, the audit trail, and a draft SWIFT MT103 built from the payment.
- **Case pack** (`/pack`): one printable page per case (Save as PDF) for insurance claims, tax records or a bank's questions; also the human-readable execution evidence.
- **Installable web app**: `app/manifest.ts`, icons generated with `next/og` (`/pwa-icon/192`, `/512`, `/maskable`, `apple-icon`), standalone display starting at `/app`.

## 5. Tamper-evident activity log

Every action (tool call, policy decision, email, bank event, approval) is a ledger entry: `seq`, wall time, simulated time, actor, type, case, narration, data, `prevHash`, `hash`. The hash is SHA-256 over the canonical JSON (sorted keys) of the entry including the previous hash. Changing any past entry breaks every link after it.

- The Security Centre recomputes the whole chain **in the user's browser** (Web Crypto) and reports the first broken entry, if any.
- `/api/ledger` exports the log with the verification result: this is the execution evidence.
- Anchors record the head hash at a moment in time. Publishing them outside the system (submission email, git commit) prevents someone with database access from silently recomputing the whole chain.

## 6. Data and state

Sandbox state lives in `.data/` (world snapshot, ledger as JSONL, anchors, recordings). In production this would be a database plus an append-only log store. Institutions are fictional; FX rates and fees are illustrative and labelled "sandbox" in the UI.

## 7. Testing

`npm test` runs 48 tests:
- rules engine: tax history, pricing order, Pakistan caps, card limits, carried-cash rule, anti-splitting, SAFE quota and prohibited purposes, deadline-aware comparison
- both scenarios end to end with the scripted agent, including the returned transfer, the scam email, the bill dispute, the refund and a tamper check, scored by the same evaluator as the live runs
- 17 red-team attacks on the safety layer (see [SECURITY.md](SECURITY.md))
- sandbox institutions: multi-question replies, "final bill on discharge", transfer in flight, refund started once, follow-up skipping and cancelling
- privacy firewall: nothing personal in the masked snapshot, real values restored in tool inputs, Chinese names
- passkeys: a software P-256 authenticator signs approvals; changed amount, replay, missing user verification, wrong site, forged signature and unknown key are all rejected

Beyond unit tests:
- `node scripts/eval.mjs run <scenario> <n>` plays a scenario Live end to end N times and scores each run with `src/server/evaluate.ts` (task checks, safety checks, wake-ups, emails, tokens, AI cost, money saved vs paying by card). `report` writes [EVAL.md](EVAL.md) and a chart.
- `npm run redteam:llm` runs 20 attacks against the live model, with an ablation using a naive prompt (`REDTEAM_AGENT=naive`); see [redteam/REPORT.md](redteam/REPORT.md).

## 8. Deployment **(update after deploy)**

Long-running Node process (`npm run build && npm start`) on a server outside mainland China, on our own domain, HTTPS. The server calls the LLM; the browser never does. Demo video hosted as MP4 plus a link reachable from China.
