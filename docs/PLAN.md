# CarryPay build plan (Oct 14 – Oct 20, 2026)

**Deadline:** 20 Oct 2026, 23:59 Beijing time = **20:59 Pakistan time**. Submissions can be updated until then; the latest version counts. Target: full package submitted on **Oct 19 night**, final resubmit by **Oct 20, 14:00 PKT**.

**Where we are (end of Oct 14):** the core product is built and committed (`193ab81`). The original Days 1–3 are done, which leaves four days to add features and polish.

Owners: **C** = Claude (code), **Y** = you, **T** = teammates, **M** = MiMo v2.6 Pro (Chinese language work, prompts in [MIMO_PROMPTS.md](MIMO_PROMPTS.md)).

---

## Done (Oct 14)

- [x] Rules engine + rule packs: Pakistan (SBP/FBR) and China (SAFE), each rule with source, status and dates
- [x] Route pricing and comparison (bank transfer, card, ATM cash, carried cash), limits, required documents, anti-splitting
- [x] Agent runner with Live / Replay / Scripted modes, 15 tools, event-driven wake-ups
- [x] Safety gateway: permission tiers, verified-beneficiary check, kill switch, input validation
- [x] Sandbox world: hospital and university auto-responders, bank (SWIFT, returns, settlement), card network, refunds
- [x] Two scenarios: Bangkok medical (PK→TH) and London tuition (CN→GB, Chinese UI)
- [x] SHA-256 hash-chained log, in-browser verification, anchors, tamper demo, export
- [x] Family app (EN/UR/ZH), approval sheet, Activity, Money, Documents, Security Centre, New case
- [x] Demo stage for the video, institution desk, bank console, director controls, landing page
- [x] Tests: 31 passing (rules engine, both scenarios end to end, 17 red-team attacks)

---

## Decision: LLM provider = DeepSeek

Claude is too expensive for this budget. We have DeepSeek and OpenAI credits.

| | Choice |
|---|---|
| Main agent | **DeepSeek `deepseek-v4-pro`** (thinking mode, tool calls) |
| Cheap / high-volume work (red-team runs, extraction) | **DeepSeek `deepseek-flash`** |
| Fallback if DeepSeek is down or misbehaves | **OpenAI** (same adapter, different base URL and key) |
| Chinese copy, subtitles | **MiMo v2.6 Pro**, run by you outside the app |

Why DeepSeek also helps us win: it is **reachable from mainland China**, so the live demo can work at the on-site final in Shenzhen, and a China-built model fits the judges' ecosystem. Replay mode stays as the labelled backup.

How (C, Oct 15):
- DeepSeek's API is OpenAI-compatible (`https://api.deepseek.com`, also an Anthropic-format endpoint at `/anthropic`). Use the **OpenAI SDK** with a provider adapter, so one code path serves both DeepSeek and OpenAI credits.
- Config: `CARRYPAY_PROVIDER=deepseek|openai|anthropic`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `CARRYPAY_MODEL`.
- Convert our zod tool schemas to OpenAI `tools` format (already generated as JSON Schema). Keep our own validation, since DeepSeek's strict mode doesn't support `minLength`/`maxItems`.
- Thinking mode with tools: follow DeepSeek's Thinking Mode guide for passing reasoning content back between tool calls; show the reasoning summary in the activity feed like today.
- Keep the safety layer exactly as is. It doesn't trust any model, so switching providers doesn't weaken it.
- Verify current model IDs on [api-docs.deepseek.com](https://api-docs.deepseek.com/) when implementing; names change.

Risk: tool-calling reliability over a 15-tool, multi-step case is unproven on DeepSeek. Mitigation: run both scenarios Live on Oct 15, tune the prompt and tool descriptions, record the best runs for Replay, and keep the OpenAI fallback.

---

## Day plan

### Oct 14 (today), rest of the day
- [ ] **Y/T** Form the team (2–5 students, ≥60% non-Chinese nationals), email the registration form + passport bio pages
- [ ] **Y** Put DeepSeek and OpenAI keys in `.env.local` (never commit it)
- [ ] **Y** Send MiMo prompt 1 and 2 ([MIMO_PROMPTS.md](MIMO_PROMPTS.md))

### Oct 15: Real AI
- [ ] **C** DeepSeek/OpenAI provider adapter; Live mode on DeepSeek
- [ ] **C+Y** Run both scenarios Live; fix prompt/tool issues; record the best runs (Replay)
- [ ] **C** Agent eval: a script that runs each scenario Live N times and reports success rate, steps, cost, failures
- [ ] **Y** Call or visit a bank's FX desk: medical remittance process, form name, documents, timing. Write down what they say.
- [ ] **M** Chinese UI and content review (prompts 1–2); **C** merges and reviews

### Oct 16: Prove it's safe with the real model
- [ ] **C** LLM-level red-team set (~20 attacks): forged invoices, hidden instructions, look-alike senders, "the hospital says skip verification", family pressure to split quotas, fake urgency, instructions in a PDF, requests to email a new address. Run against DeepSeek with and without the safety layer; report attack success rate before/after. This becomes the core of the security report.
- [ ] **C** Real passkey approval (WebAuthn: register once, fingerprint/face per approval), with hold-to-approve as fallback
- [ ] **C** Upload your own bill: photo or PDF of an invoice → extraction (vision model via OpenAI credits if DeepSeek vision isn't available) → agent works from it. Strong live-demo moment: "show us any hospital bill".
- [ ] **T** Draft the demo video script ([VIDEO_SCRIPT.md](VIDEO_SCRIPT.md), to create)

### Oct 17: More reasons to win
Pick by value; the first three are the strongest.
- [ ] **C** Third corridor, **PK→GB university fees** (rules already in `pk-sbp.json`): shows the "one agent, new rules file" claim live
- [ ] **C** "Why?" on every rule chip: tap a rule ID to see a plain-language explanation and its source, in the family's language
- [ ] **C** Receipt pack: one-tap PDF of all invoices, receipts, forms and the verified log, for insurance claims and tax records (and the "execution evidence" deliverable)
- [ ] **C** WhatsApp-style notifications (simulated): families in Pakistan live on WhatsApp; show the agent's messages arriving there
- [ ] **C** Family roles: the attendant can follow everything, but only the payer approves money
- [ ] **C** Impact panel on the landing page: time saved, fees saved, steps handled, using the scenario numbers
- [ ] **Y** Urdu review of the UI and agent messages (you're the native speaker)

### Oct 18: Polish and deploy, then feature freeze
- [ ] **C** Accessibility pass (contrast, focus states, screen-reader labels), dark mode check, empty and error states, loading skeletons
- [ ] **C** Sound and motion polish for the video: approval success, payment arrival
- [ ] **C+Y** Deploy to a server outside mainland China (Singapore/HK/Tokyo) on our own domain (`carrypay.app` / `carrypayments.com` were free on Oct 14); HTTPS; long-running Node process
- [ ] **Y** Test the URL with a "website speed test from China" tool
- [ ] **All** End of day: **feature freeze.** Only fixes after this.

### Oct 19: Make the package
- [ ] **T+Y** Record the video (stage at 1920×1080, Live or Replay, voiceover recorded separately)
- [ ] **M** Bilingual subtitles 中英双语 from the final script (prompt 4), then **a native Chinese speaker checks them**
- [ ] **T** Deck (≤10 min, ~12 slides)
- [ ] **C** Finalise [TECHNICAL.md](TECHNICAL.md) and [SECURITY.md](SECURITY.md) with the DeepSeek results and the red-team numbers
- [ ] **C** Export execution evidence: ledger JSON + verification + anchors for each scenario
- [ ] **All** **Submit the full package tonight**

### Oct 20: Buffer
- [ ] Re-watch the video fresh, fix anything slow
- [ ] Final resubmit by **14:00 PKT** (deadline 20:59 PKT)

---

## Submission checklist

| Required item | Source |
|---|---|
| Technical documentation (architecture, core algorithm, security design) | [TECHNICAL.md](TECHNICAL.md) |
| Presentation deck (≤10 min) | to make Oct 19 |
| Source code: README, GitHub link, deployment steps, tests | repo, [README.md](../README.md), `npm test` |
| Security self-assessment (permission tiers, known risks) | [SECURITY.md](SECURITY.md) |
| Execution evidence (sandbox logs + demo video) | `/api/ledger` export per scenario + video |
| Demo video (≤5 min, optional but we're doing it) | MP4 + link reachable from China |
| Registration form + passport bio pages | email, Oct 14 |

Verify the exact list against the official rules PDF ("Appendix 2") before submitting.

## Ideas parked (only if time allows)
- Voice notes in Urdu: a parent records a question, the agent answers in Urdu text
- Exchange-rate alert: "the rupee is moving, pay the deposit today rather than Friday" (careful: advice, not speculation)
- Hospital-side view as a product: institutions receive cleaner payments with references, fewer returns
- Admin view for a bank partner: regulatory reporting from the hash-chained log
