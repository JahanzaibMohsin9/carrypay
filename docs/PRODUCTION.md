# CarryPay: from sandbox to product

Version 1.1 · 11 November 2026 (1.0: 15 October 2026) · companion to [TECHNICAL.md](TECHNICAL.md) and [SECURITY.md](SECURITY.md)

CarryPay today runs against a simulated world: the banks, card network, hospitals and universities are sandbox programs. This document shows that the simulation sits behind a few narrow seams, what replaces each one in production, who would operate the product legally, and how a pilot with one bank would run. The short version: **the agent, the safety gateway, the rules engine, the passkey approvals and the log stay as they are; the simulated rails are swapped for a bank's real ones, and the bank, not CarryPay, holds and moves the money.**

Regulatory points below were checked on 15 October 2026 against the sources listed at the end. Like the rules in CarryPay's rule packs, they are a starting point for a bank's compliance team, not legal advice.

## 1. What is real today, and what is simulated

| Part | Today | Status |
|---|---|---|
| AI agent | DeepSeek V4 Pro over the real API, 22 tools, event-driven loop | **Real** |
| Safety gateway, rules engine | Code that checks every tool call; rule packs with sources and status | **Real** |
| Privacy firewall | Known names, IDs, card and passport numbers and medical terms on the case masked before the agent's model (photos and voice notes go to OpenAI as provided) | **Real** |
| Family approval | WebAuthn passkeys (fingerprint or face) on real phones, signature over the exact payment | **Real** |
| Activity log and proof | SHA-256 hash chain; head hash anchored in real transactions on the Conflux eSpace testnet and on a FISCO BCOS chain | **Real** (testnet; the FISCO chain is four nodes on the demo server) |
| Plans and mandates | Cash-flow projection, plan comparison, bill review, mandate terms and checks, all in code | **Real** |
| The family's figures for a plan | Typed by the family (balances, income, essentials, reserve) | Entered by hand |
| Reading bills, voice | PDF text extraction, vision model for photos, speech-to-text | **Real** |
| Hosting | HTTPS server, private sandbox per visitor | **Real** |
| Banks and payments | SWIFT transfers, returns, settlement in `src/server/sim/` | Simulated |
| Card network | Authorisations, declines, refunds | Simulated |
| Hospitals and universities | Rule-based auto-responders, fictional institutions; the university's plan offers, confirmations and crediting to the student account are simulated too | Simulated |
| Email | Delivered inside the app | Simulated |
| Verified institution registry | A fixed list in code | Simulated |
| FX rates and fees | Illustrative sandbox rates | Simulated |
| Customer identity (KYC) | None: sandbox people | Not built |

## 2. The swap points

Everything simulated is reached through a few functions. Each row is a replacement of one module; the agent and gateway above it don't change.

| Simulated part | Where it is today | Production replacement |
|---|---|---|
| Bank transfer | `submitPayment()` in `src/server/sim/engine.ts`, called by `runtime.ts` only after the family's passkey approval | The partner bank's payment API: a transfer from the family's own account (SWIFT MT103 or ISO 20022 pacs.008). The bank officer view (`/bank/officer`) already builds a draft MT103 from each payment. |
| Payment status | `setPaymentStatus()` in the same file (submitted, completed, returned, refunded) | Status events from the bank, e.g. the Swift gpi tracker by UETR, mapped onto the same statuses. The agent already handles returned transfers, delays and refunds through them. |
| Card payments | The card branch of `submitPayment()` | The issuer's or processor's authorisation API, with the card network's own authentication. |
| Email to and from institutions | `onOutboundMail()` and `sendMail()` in `src/server/sim/` | A real mailbox per bank (SMTP/IMAP or a mail API). Inbound mail is checked for SPF, DKIM and DMARC before the agent sees it. The existing rule that the agent may only write to an institution's verified address (control C4) stays. |
| Verified institutions | `INSTITUTIONS` in `src/domain/institutions.ts`; `verifyInstitution()` for uploaded bills | A registry the bank maintains: the institution, its billing address and its account, confirmed before first use, for example with Swift's Payment Pre-validation (beneficiary account verification) plus a call-back. The gateway's check (`CARRYPAY.VERIFIED_BENEFICIARY`, `CARRYPAY.VERIFIED_INSTITUTION`) reads the registry instead of the list. |
| FX rates and fees | `src/domain/market.ts` | The bank's live rates and fee schedule, and the card scheme's rates. The engine prices routes the same way. |
| Regulations | `src/domain/rules/packs/*.json` | The same files, reviewed by the bank's compliance team: every rule marked *reported* or *assumed* is confirmed or corrected, changes go through review and the test suite. |
| Forms | `prepare_documents` drafts (e.g. SBP Appendix V-68) | The bank's own e-forms, filled from the same data and signed with the approval. |
| Identity | Sandbox people | The bank's customer login and KYC; the passkey is registered to the bank's customer. |
| Storage | JSON files in a data folder | A database and an append-only log store, with backups. |
| Model | DeepSeek API | A model the bank approves. DeepSeek's V4 weights are published under the MIT licence, so a bank can run the same model in its own data centre, and family data never leaves the bank. |
| Public anchoring | Conflux eSpace testnet, and a FISCO BCOS chain run on the demo server | A chain the bank chooses: a public chain, or a FISCO BCOS consortium chain (open source, built for finance by the Shenzhen consortium WeBank helped found) whose nodes belong to separate members. Every anchor already goes to FISCO BCOS through its Ethereum-compatible RPC; production points `FISCO_RPC_URL` at the consortium's node. The anchor contract is about 20 lines and ports to any EVM chain. |
| The family's figures | Balances, salary, essentials and reserve typed by the family | The balances the bank already holds, with the customer's consent, and their salary credits. The projection and the mandate's reserve check run the same way on real figures. |
| Payment plans | The sandbox university's published plans, offers and confirmations | The institution's own terms: its finance office's emails and documents, or a student-finance API where one exists. The rules stay: a plan counts only when the institution confirms it, and only that moves a due date. |
| Crediting | The sandbox university allocates each transfer to the student account | The institution's receipt or its student-account statement; until it arrives the case stays open. |

The same seams serve a bank's own assistant: CarryPay is already an MCP server (TECHNICAL.md §4.9), so a bank's chatbot or a staff assistant can call CarryPay's tools and inherit its gateway, rules and passkey approvals, instead of re-implementing them.

What doesn't change: the agent loop and its 22 tools, the safety gateway, the rules engine and route pricing, the privacy firewall, passkey verification, the hash-chained log, and the evaluation and red-team harnesses, which become release tests (§5).

### 2.1 Plans and mandates inside a bank

The plan workflow fits a bank better than it fits a stand-alone app:

- **The figures are already there.** In the sandbox the family types their balances and salary, and the app says so. A bank holds them. With the customer's consent the projection uses the real balance and the salary credits, and the reserve check before each mandate payment uses the balance on the day.
- **The mandate is a standing instruction with a reserve test.** Banks already run standing orders and direct debits. A plan mandate is narrower: named instalments only, each exactly, in its window, to one verified account, with a total cap, and only while the payer's reserve holds. The customer signs it once with the bank's own strong authentication; the bank's officer view shows its terms and, for each instalment, the checks that passed. The customer can revoke it in the app at any time.
- **The officer sees the whole plan.** For each instalment the package shows the institution's offer and confirmation, which instalment it is, how it was authorised (passkey or mandate, with the checks), the reserve check, and whether the institution credited it. Every figure comes from the engine, so the officer checks the same numbers the customer saw.
- **Quotas stay per calendar year.** The engine already reports which year's FX quota each instalment counts against and what documents it needs. Instalments only come from the institution's own terms (`CARRYPAY.NO_STRUCTURING`), so a plan is never a way around a quota, and a bank can show its regulator why.
- **It is not lending.** CarryPay never lends or holds money. It arranges the institution's own published plans; if a bank wants to offer credit as well, that is the bank's product under its own rules, and CarryPay would show it as one more option, priced by the same engine.
- **What a bank must decide:** whether a mandate may run without an officer's review of each instalment, the reserve test it wants, and how mandate payments appear in the customer's statement.

### 2.2 Approvals, verification and "done" inside a bank

- **An approval is a decision on terms, not just a payment.** CarryPay's approval covers the bill version, a cost limit in the customer's currency and a quote validity. In a bank the quote is the bank's own FX quote and its hold period; when it expires or the bill changes, only that approval is withdrawn, and the customer sees what changed.
- **Verification is the bank's work, made explicit.** For an institution the bank doesn't know, its reviewer answers three separate questions (genuine institution, account ownership, authentic bill), each on named evidence. In production the account check would use the receiving bank's account-name check or a pre-validation service; what each service actually checks differs and must be stated per check, not as one badge.
- **Done means the institution says so.** A bank's payment status ends at delivery. CarryPay keeps the case open until the institution confirms it credited the student or patient account and lifted any hold, and measures the time from delivery to credit. In production that confirmation needs a response channel the institution agrees to (email from a verified address today, an institution portal or API later). CarryPay can commit to its own checks and follow-ups; it can't guarantee an institution's answer, an admission or a treatment.

## 3. Who operates it: a bank, not CarryPay

CarryPay never holds or moves money itself. It is software that a licensed bank deploys for its customers: the bank does the KYC, holds the accounts, executes the transfers and stays responsible to its regulator. This is how it can be legal in both countries without CarryPay becoming a payment company.

**Pakistan.** Foreign-exchange remittances for medical treatment and education are made by banks authorised to deal in foreign exchange (Authorized Dealers), under the State Bank of Pakistan's foreign-exchange rules that CarryPay's Pakistan pack encodes. A partner bank would run CarryPay inside that existing process. The State Bank also runs a **regulatory sandbox**: guidelines issued in May 2025, a first cohort shortlisted in January 2026 (themes: inward remittances, open banking, remote merchant onboarding), live testing for up to six months. The State Bank has made clear that completing the sandbox is not approval to launch: a product still needs its authorisation. Outward medical and education payments were not a first-cohort theme, so the realistic route is through a partner bank, or a future cohort.

**China.** Personal foreign-exchange purchases go through banks under SAFE's rules (the annual quota, the purpose declaration, the ban on splitting across relatives), which CarryPay's China pack encodes and a bank already enforces. Three further sets of rules matter:
- **Generative AI.** The *Interim Measures for the Management of Generative AI Services* (in force since 15 August 2023) cover generative AI services offered to the public in China; a public-facing service with certain attributes needs a security assessment and an algorithm filing. A bank offering CarryPay to customers would check whether its deployment falls under them, along with its own regulators' rules.
- **Personal data.** The March 2024 rules on cross-border data flows exempt transfers that are necessary to perform a contract with the individual, with payments given as an example. Masking reduces exposure but does not by itself establish compliance with cross-border data-protection requirements. With a model hosted by the bank and data kept in the bank, there is no transfer to an outside model provider at all.
- **The bank's own regulators.** Sector rules for banks and financial technology apply on top; the bank's compliance team owns this.

## 4. Security for production

The sandbox already has the core controls (SECURITY.md). Production adds:
- **Keys in hardware.** The anchor wallet's key, session secrets and API keys move into the bank's HSM or key management service; no key in files.
- **Independent testing.** A penetration test and an external red team before launch, and an AI red team before every model or prompt change.
- **The bank stays in control.** A bank-level emergency stop beside the family's; limits per customer and per day set by the bank; every payment package visible to the bank's FX officer, as the officer view already shows.
- **Clear liability.** The AI never authorises a payment: the family's passkey does, and the bank's usual controls apply after it. Disputes use the bank's existing process, with the hash-chained log as the record of what the agent did and why.
- **Monitoring.** Alerts on blocked tool calls, fraud flags and failed anchors; a weekly sample of cases reviewed by a person.

## 5. Proving it stays safe: release gates

The tools we built to evaluate the prototype become the gates every release must pass:
1. `npm test`: 204 tests, including 41 attacks on the safety gateway and property-based fuzzing of it, must pass.
2. `node scripts/eval.mjs`: every scenario run live several times; the release is blocked if any safety check fails (payment to an unverified account, rule broken, family not warned).
3. `npm run redteam:llm` and `npm run redteam:adaptive`: the 20 live-model attacks and the attacker that learns, with **0 executed** and **0 goals achieved** required; new attacks are added as they are seen in the wild.
4. Log verification and on-chain anchors checked for every pilot case.

## 6. A pilot with one bank

| Phase | Scope | Done when |
|---|---|---|
| 0. Prepare | One partner bank, one corridor (Pakistan → Thailand hospital, or China → UK tuition). Compliance review of the rule pack; registry of the first hospitals or universities with verified accounts; model hosted in the bank's test environment; bank APIs connected at the swap points in §2. | Every rule in the pack confirmed by the bank; all release gates pass on the bank's test systems. |
| 1. Staff-assisted pilot | Real cases. CarryPay prepares each payment; the family approves with a passkey; the bank's FX officer reviews the package before it is sent. | An agreed number of real cases with **zero payments to unverified accounts**; time from invoice to payment, cost saved against paying by card, and officer review time measured. |
| 2. Self-service | Families use the app directly; the officer reviews only flagged cases. A second corridor and more institutions. | Pilot measures hold without the officer's review of every case. |

## 7. What it costs to run

- **AI.** Measured on the live model: $0.05 to $0.23 per case at DeepSeek's peak list prices ([EVAL.md](EVAL.md)); the nine-day hospital case is the most expensive. A self-hosted model replaces this with the bank's own server costs.
- **Chain.** One small transaction per milestone and chain (1 to 6 per case in our evidence runs), on any EVM chain; on a consortium chain, no fee to a public network.
- **What the family gains**, from the engine on sandbox rates: in the Bangkok case, paying the deposit by bank transfer instead of card saved about PKR 44,000, and the bill check recovered THB 14,000 charged twice. Real savings depend on the bank's real rates and fees. These are sandbox figures, not customer outcomes.

## 8. Open questions for a partner bank

- Which corridor first, and which of its institutions can be verified quickly?
- Is the bank's payment API able to report status events (or Swift gpi updates) to CarryPay?
- Which model may the bank use: a hosted provider or a self-hosted open-weight model?
- Who signs off rule-pack changes, and how often are they reviewed?
- What does the bank want the officer to see before a payment leaves?
- May a plan mandate pay an instalment without an officer's review, and which reserve test should it apply?

## Sources (checked 15 October 2026)

- State Bank of Pakistan regulatory sandbox, first cohort and its themes: [Profit / Pakistan Today, 7 Jan 2026](https://profit.pakistantoday.com.pk/2026/01/07/sbp-shortlists-firms-for-first-regulatory-sandbox-cohort/), [The Asian Banker](https://www.theasianbanker.com/press-releases/state-bank-of-pakistan-announces-shortlisted-applicants-for-the-first-cohort-of-its-regulatory-sandbox); sandbox is not approval to launch: [ProPakistani, 16 Sep 2026](https://propakistani.pk/2026/09/16/sbp-clarifies-rules-for-fintechs-after-sandbox-testing/)
- China's generative AI measures: [China Briefing](https://china-briefing.com/news/how-to-interpret-chinas-first-effort-to-regulate-generative-ai-measures), [DLA Piper](https://www.dlapiper.com/insights/publications/2023/07/china-new-measures-on-generative-artificial-intelligence)
- China's cross-border data provisions (March 2024): [Faegre Drinker](https://www.faegredrinker.com/en/insights/publications/2024/4/china-releases-new-regulation-on-cross-border-data-transfers), [Hunton](https://www.hunton.com/privacy-and-cybersecurity-law-blog/new-era-of-regulation-for-cross-border-transfers-in-china)
- DeepSeek V4 open weights under the MIT licence: [deepseek-ai on Hugging Face](https://huggingface.co/deepseek-ai) (check each model's LICENSE file)
- FISCO BCOS: [official documentation](https://fisco-bcos-documentation-en.readthedocs.io/)
- Swift Payment Pre-validation: [swift.com](https://www.swift.com/products/payment-pre-validation)
- Pakistan's and China's foreign-exchange rules: the sources in `src/domain/rules/packs/pk-sbp.json` and `cn-safe.json`, each with its status
