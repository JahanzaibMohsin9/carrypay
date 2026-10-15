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
- [x] Chinese copy reviewed by MiMo (UI, China scenario, FX form)
- [x] **DeepSeek adapter**: Live mode runs on `deepseek-v4-pro` (thinking + tools), automatic OpenAI fallback, `scripts/drive.mjs` to drive live runs
- [x] First live run of the Bangkok case on DeepSeek (findings below)
- [x] Competition brief read and summarised: [COMPETITION.md](COMPETITION.md)

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

Status: **implemented Oct 14.** Original design notes:
- DeepSeek's API is OpenAI-compatible (`https://api.deepseek.com`, also an Anthropic-format endpoint at `/anthropic`). Use the **OpenAI SDK** with a provider adapter, so one code path serves both DeepSeek and OpenAI credits.
- Config: `CARRYPAY_PROVIDER=deepseek|openai|anthropic`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `CARRYPAY_MODEL`.
- Convert our zod tool schemas to OpenAI `tools` format (already generated as JSON Schema). Keep our own validation, since DeepSeek's strict mode doesn't support `minLength`/`maxItems`.
- Thinking mode with tools: follow DeepSeek's Thinking Mode guide for passing reasoning content back between tool calls; show the reasoning summary in the activity feed like today.
- Keep the safety layer exactly as is. It doesn't trust any model, so switching providers doesn't weaken it.
- Verify current model IDs on [api-docs.deepseek.com](https://api-docs.deepseek.com/) when implementing; names change.

Risk: tool-calling reliability over a 15-tool, multi-step case is unproven on DeepSeek. Mitigation: run both scenarios Live on Oct 15, tune the prompt and tool descriptions, record the best runs for Replay, and keep the OpenAI fallback.

---

## Additions after the review (Oct 14 evening)

Where we stand (honest self-rating): task completion 8/10 (until live runs complete cleanly), security & compliance 8.5/10, innovation & interaction 7.5/10. Many teams will share the idea; our edge is execution, safety evidence and a real story. These additions target the gaps:

| # | Addition | Why it scores | Effort | When |
|---|---|---|---|---|
| A1 | **Admission-fraud protection** (scenario 3, below) | Topic C's "students" half, a real and current harm in Pakistan, security 30% | 1 day | Oct 17 |
| A2 | **Privacy firewall**: mask passport numbers, account numbers and medical details before anything reaches the LLM (`[PASSPORT_1]`), fill real values back only inside our code; log what was shared | Security & compliance; cross-border data rules (China's PIPL) when using DeepSeek/OpenAI; matters to WeBank | half a day | Oct 16 |
| A3 | **Evaluation report**: each scenario run Live 10 times; success rate, steps, AI cost per case, PKR/CNY saved; one chart for the deck | Task completion with evidence instead of claims | half a day | Oct 15 |
| A4 | **Real-world validation**: talk to 5-10 people (Pakistani students abroad, families who travelled for treatment) plus the bank call; quotes and a few numbers in the deck | Judges trust real users over features | your time | Oct 15-17 |
| A5 | **Chaos mode**: one button makes the bank go down, the institution go silent or the rate jump; the agent recovers live | Proves it's an agent, memorable on stage | half a day | Oct 17 (if time) |
| A6 | **Bank-officer view**: the bank's side, a ready-to-approve remittance package (documents checked, rules cited, draft SWIFT message) | Answers "how would this work with a real bank?"; pitches CarryPay as a layer banks like WeBank could deploy | half a day | Oct 17 (if time) |
| A7 | **Business model slide**: who pays (institutions, banks white-label, per-transaction fee), sourced market numbers | Credibility in front of bank judges | 1 hour | Oct 19 |
| A8 | **Installable web app (PWA)**: icon, splash, full-screen; record the demo on a real phone | Authentic video; judges open a link, not an APK | 1-2 hours | Oct 18 |

**APK decision:** no native APK by default. The competition doesn't require one, judges review a link, and unknown APKs are distrusted. Optional: wrap the PWA as an APK on Oct 18 only if everything else is done.

### A1: Admission-fraud protection (scenario 3)

**Why:** in early October 2026 a gold-medallist student of IIUI in Islamabad died after a man posing as an admissions agent took over Rs7 million from her family for a fake Harvard admission and scholarship, using forged offer letters and fee receipts. Rs2.9m went through her personal bank account and the rest in cash ([Express Tribune](https://tribune.com.pk/story/2634102/pm-shehbaz-takes-notice-of-gold-medallists-suicide-in-islamabad-following-education-funds-scam), [Dunya News](https://dunyanews.tv/en/Pakistan/977128-islamabad-gold-medalist-ends-life-after-rs7-million-harvard-admission-), [Pakistan Today](https://www.pakistantoday.com.pk/2026/10/10/gold-medalist-students-suicide-exposes-alleged-multi-million-rupee-education-fraud)). The investigation is ongoing and details differ between reports. Fake study-abroad agents are a common scam in Pakistan.

**What CarryPay already does that would have stopped the money:** it pays tuition only to the university's own verified account, never to a person or an agent. Pakistan's rules also require education fees to go directly to the institution.

**What to add:**
- **Verify the admission before any fee is paid.** The agent contacts the university through its verified admissions or finance contact (from the registry, never from the offer letter) and asks it to confirm the applicant, programme and offer reference. New rule `CARRYPAY.ADMISSION_VERIFIED_BEFORE_FEES` (policy): no tuition payment until the institution itself has confirmed the admission.
- **Red flags the agent checks and explains:** fees payable to a person or a "consultant" account, offer letters from free email addresses or look-alike domains, "scholarship processing" or "visa guarantee" fees, pressure and secrecy, payment in cash or through the student's own account.
- **Scenario 3 (PK to US/UK tuition):** a family brings an offer letter from an "education consultant" who asks for fees to be paid to their account. The agent checks with the university and gets *no such applicant*. The safety layer blocks any payment to the consultant. The agent explains gently, tells the family not to pay anything more, keeps the evidence, and points to the authorities (confirm the current reporting channel in Pakistan before naming it).
- **Careful wording:** messages after a fraud is found must never blame the family ("this is not your fault; nothing more has been paid; here is what to do next"). In a real product, also link to support resources. Ask someone you trust to read these messages.

**Using the story in the pitch:** don't use her name or photo. Describe it as "a recent case reported in Pakistan", cite the news, keep it short and respectful, and keep your own Bangkok story as the opening. If in doubt, mention the problem in general terms (fake study-abroad agents) and cite the case only in the written documents.

## Day plan

### Oct 14 (today), rest of the day
- [ ] **Y/T** Form the team (2–5 students, ≥60% non-Chinese nationals), email the registration form + passport bio pages
- [ ] **Y** Put DeepSeek and OpenAI keys in `.env.local` (never commit it)
- [ ] **Y** Send MiMo prompt 1 and 2 ([MIMO_PROMPTS.md](MIMO_PROMPTS.md))

### Findings from the first live DeepSeek run (Oct 14)
- Good: emails the hospital first, verifies the account, prepares SBP forms, proposes payments, catches the look-alike scam email on its own (flag + warn family + confirm via the verified address), writes clear family messages.
- Fixed already: case-note limit too short (model retried); prompt now says "contact the institution yourself first".
- **To fix:** the sandbox hospital's auto-responder picks one intent per email, so multi-question emails get a generic "payment status" reply and the agent keeps re-asking. Make replies answer every question asked (bank details unchanged, receipts, statement, refund), and stop the agent re-emailing about something already answered.
- **To fix:** the agent sometimes wakes on a follow-up that's no longer needed and only writes a note. Fine, but each wake-up costs a call: have it cancel follow-ups once the thing it waited for has happened.
- Speed: 25–45 s per wake-up. Fine for the product; for the video, record a live run and use Replay with step pacing.

### Done on Oct 14 (second session), ahead of plan
- **Sandbox institutions answer every question in one reply** (`src/server/sim/institution.ts`) and say when things will come ("final bill on discharge"). Replies are linked to the email they answer; the snapshot shows `answered_by` and `topics_answered`. A repeat refund request no longer starts a second refund (bug).
- **Follow-ups**: `skip_if` conditions checked in code (no wake-up when the awaited event already happened), `cancel_followup`, max 4 open.
- **Runner fixes**: events at the same moment share one wake-up; in dev, API routes load separate copies of the agent module, which split recordings in two; a replacement runner now takes over the session. Token usage logged per wake-up.
- **Live runs, DeepSeek**: Bangkok 11/11 checks with 3 emails (first run: 10 emails, looping); London 10/10 with 1 email, about USD 0.07–0.11 per case. Curated runs in `recordings/` for Replay.
- **Evaluation** (A3): `scripts/eval.mjs` + `src/server/evaluate.ts` + `/api/eval`; results in [EVAL.md](EVAL.md).
- **LLM red team**: 20 attacks; CarryPay agent 0/20 attempted, 0/20 executed. Ablation with a naive prompt: 2/20 attempted (split across cards, overpay), 0/20 executed thanks to the gateway.
- **Privacy firewall** (A2) with "what the AI saw" in the Security Centre; sandbox passport numbers added to people and forms.
- **Passkey approvals**: WebAuthn without a library; the challenge is a digest of the exact payment; tested with a software authenticator and once in the browser.
- Test isolation: each vitest worker has its own data dir (two files raced on `world.json`).
- **A1 scenario 3** (`pk-admission`): fake offer via a consultant; the agent checks with the university, which has no such applicant; nothing is paid; the family is told gently. Rule `CARRYPAY.ADMISSION_VERIFIED_BEFORE_FEES` (only a university-issued admission letter counts). Passed live on DeepSeek; curated Replay recording.
- **A5 chaos mode**: Director buttons for bank outage, card declined, institution silent. Live check passed with both payment faults armed (resent the bounced transfer unchanged; moved the urgent deposit to Sana's card).
- **Case closing**: a v2 Bangkok run spent USD 0.55 chasing cash the family paid before CarryPay was involved and nagging them for receipts. Fixes: the hospital answers cash questions; `skip_if: family_replied`; a `close_case` tool that cancels follow-ups; prompt rules on when the job ends.
- **Parallel live evaluation in process** (`npm run eval:live`, `src/server/scenario.live.ts`): no dev server needed, several runs at once, same `runs.jsonl` format.
- **Oct 14 night, live re-runs on the final agent** (DeepSeek topped up, off-peak): Bangkok 11/11, London 10/10, fake admission 10/10 ([EVAL.md](EVAL.md)); red team: CarryPay agent 0/20 tried, naive prompt 2/20 tried, 0/20 executed ([redteam/REPORT.md](redteam/REPORT.md)). Found and fixed on the way: person IDs like `p_tariq` leaked names to the model (now tokens), "drug-eluting" gave away "stent" (added to the medical list), the LLM-17 judge was too strict (re-judged, corrected). New Bangkok and London Replay recordings contain no personal data.
- Family app: rule chips explain themselves; "Across currencies" on the Money tab; `/bank/officer`; `/pack` (print to PDF); Overview says "nothing will be paid" when fraud was found; PWA manifest and icons.

### Done on Oct 15
- **Scenario 4** (`cn-admission`, Chinese UI): a Shenzhen 留学中介 sells a "保录取" place, wants a RMB 38,000 guarantee fee, tuition to its account or a personal WeChat, and FX bought in relatives' names. The agent checks with the university (no such applicant), pays nothing, refuses 蚂蚁搬家, tells the family it isn't their fault and to report it to the police. Scripted plan, scenario test, RT-18 on the gateway, evaluator checks (`police_advised`, `split_refused_kindly`), live eval, curated Replay recording. The sandbox university's reply now also names "guaranteed admission" and scholarship fees.
- **Upload your own bill, option (a)**: names first, then a PDF (read by our code, no AI), a photo (read by OpenAI vision: DeepSeek's API accepts the request but can't see the image) or pasted text, or the sample bill (no AI at all, so it works offline). The family's names are masked before the text goes to the model that extracts fields; the family checks every field; the server validates again. The case runs on a derived corridor (PK or CN to 13 countries, sandbox rates); new rule `CARRYPAY.VERIFIED_INSTITUTION` blocks payment and email until the Director's "Verify institution (sandbox)" stands in for the bank's check. Scripted plan, 5 tests, live runs.
- **Fix:** DeepSeek sometimes escapes line breaks twice in tool arguments, so families saw a literal `\n\n` in messages (also in the earlier recordings). The gateway now restores them before any tool runs, which fixes Replay too.
- **DeepSeek outage (15 Oct, about 11:56–12:02 UTC):** 12 live runs failed with network errors; they are kept in `runs.jsonl` marked `excluded` and replaced by make-up runs.

**Open questions for you (Y):**
- **Upload your own bill**: *decided 14 Oct: option (a).* A bill from an unverified hospital is read, priced under the home country's rules and explained, but not paid until the institution is verified; a Director button "Verify institution (sandbox)" stands in for the bank's verification so the demo can continue to payment. Photos need a vision model (check whether DeepSeek's API takes images; PDFs with text work without one).
- **China, student's own quota**: in one live run the agent paid the London fees from the **student's own** USD 50k quota (her own tuition, one payer) instead of the father's quota plus documents. The rules engine allows it and it isn't 蚂蚁搬家, but please confirm with a bank or MiMo that a student may buy FX for her own tuition with RMB her parents gave her, and what the bank needs.
- **Chinese review**: new strings are marked `// TODO zh` for MiMo (prompt 5 in [MIMO_PROMPTS.md](MIMO_PROMPTS.md)). No new Urdu: the Urdu UI keeps its original strings and shows English for anything newer.

### Oct 15: Make the live agent solid
- [x] **C** Smarter sandbox institutions: multi-intent replies (see findings), so live runs flow without loops *(done Oct 14)*
- [x] **C** Cancel or skip stale follow-ups; tighten the prompt where live runs wander *(done Oct 14)*
- [x] **C+Y** Run both scenarios Live until each completes cleanly; record the best runs (Replay) *(done Oct 14: `recordings/`)*
- [x] **C** **A3** Agent eval: a script that runs each scenario Live N times and reports success rate, steps, cost, failures, plus a chart for the deck *(done Oct 14: [EVAL.md](EVAL.md))*
- [x] **C** *(done Oct 15: scenario, scripted plan, tests incl. RT-18, live eval, Replay recording `recordings/cn-admission.json`, MiMo prompt 8)* **Scenario 4: fake study agent in China** (`cn-admission`, Chinese UI, SAFE rules). A Shenzhen family pays a 留学中介 that promises a "保录取" (guaranteed admission) place at Kingsgate with a scholarship; the agency wants a 保录取服务费 and the tuition sent to its own account (or a personal WeChat/Alipay), and suggests buying the pounds in relatives' names to stay under the quota (蚂蚁搬家). The agent checks with the university (no such applicant), pays nothing, refuses the quota split, and tells the family gently what to do (keep evidence, report to the police). Reuses `CARRYPAY.ADMISSION_VERIFIED_BEFORE_FEES` and `CN.FX.NO_SPLITTING`; scripted plan, test, live run, Replay recording; Chinese copy marked `// TODO zh` and a MiMo prompt. Framing: capital-control countries, two corridors each for China and Pakistan.
- [ ] **Y** **A4** Start the interviews: 5-10 people (students abroad, families who paid hospitals abroad), 10 minutes each
- [ ] **Y** Call or visit a bank's FX desk: medical remittance process, form name, documents, timing. Write down what they say.
- [x] **Y** Email the organiser (wangyr@pbcsf.tsinghua.edu.cn): does the 0–5 point **on-chain challenge bonus** apply to Topic C teams? *Answer 14 Oct: yes (A–E). Also: ~10 finalist teams; travel covered for all members.*
- [x] **Y** Create a GitHub repository and push (the source-code item requires a GitHub link) *(done 14 Oct: https://github.com/JahanzaibMohsin9/carrypay, branch `main`)*

### Oct 16: Prove it's safe with the real model
- [x] **C** *(done Oct 14: [redteam/REPORT.md](redteam/REPORT.md))* LLM-level red-team set (~20 attacks): forged invoices, hidden instructions, look-alike senders, "the hospital says skip verification", family pressure to split quotas, fake urgency, instructions in a PDF, requests to email a new address. Run against DeepSeek with and without the safety layer; report attack success rate before/after. This becomes the core of the security report.
- [x] **C** *(done Oct 14)* **A2** Privacy firewall: mask personal data before it reaches the LLM, restore it only in our code, show "what the AI saw" in the Security Centre; add red-team cases for data leakage
- [x] **C** *(done Oct 14)* Real passkey approval (WebAuthn: register once, fingerprint/face per approval), with hold-to-approve as fallback
- [x] **C** *(done Oct 15, option (a): `/app/new/upload`, rule `CARRYPAY.VERIFIED_INSTITUTION`, Director "Verify institution (sandbox)")* Upload your own bill: photo or PDF of an invoice → extraction (vision model via OpenAI credits if DeepSeek vision isn't available) → agent works from it. Strong live-demo moment: "show us any hospital bill".
- [ ] **T** Draft the demo video script ([VIDEO_SCRIPT.md](VIDEO_SCRIPT.md), to create)

### Oct 16–17: On-chain anchoring (challenge bonus, 0–5 points)

**Goal:** anyone can check, without trusting us, that CarryPay's activity log wasn't edited after the fact. At each case milestone the log's head hash (SHA-256, already chained) is written to a public test network; the Security Centre links each anchor to the block explorer and re-checks it against the chain.

**Chain: Conflux eSpace testnet** (EVM, chain ID 71, RPC `https://evmtestnet.confluxrpc.com`, explorer ConfluxScan). Why: a public chain built in China whose explorer opens from mainland China (judges and the Shenzhen final), EVM-compatible so standard tools work, free testnet CFX from a faucet. Fallback: Ethereum Sepolia, the best-known testnet, but one source says it may be retired around September 2026, so check it is still running before relying on it. To confirm on Oct 16: the current explorer domain (`evmtestnet.confluxscan.org` vs `.net`; sources differ) and the faucet's rules. Mention FISCO BCOS (WeBank's open-source consortium chain) in the docs as the deployment path for a bank; we don't run it.

**What goes on-chain:** only `(seq, headHash, scenario, milestone)` from the ledger. No names, amounts, accounts or case text. A head hash commits to every earlier entry, so one anchor covers the whole log up to that point.

**Design**
- A small contract `CarryPayAnchor` (about 20 lines of Solidity): `anchor(bytes32 head, uint64 seq, string label)` emits `Anchored(head, seq, label, block.timestamp)`. Source verified on the explorer, so judges can read it. Compiled once; the bytecode is committed with the source.
- `src/server/anchor/`: an anchoring service using `viem`. It queues milestones (case opened, payment approved, payment completed, fraud flagged, case closed, plus the existing manual "Anchor" button), sends at most one transaction per milestone, retries on failure, and never blocks the agent or a payment. `anchors.json` gains `chainId`, `txHash`, `blockNumber`, `status` (local / pending / confirmed / failed).
- Not an agent tool: the model can't call it and never sees the key. The wallet signs only anchor transactions to our contract.
- Without a key the app works as today; anchors show "local only".
- Security Centre: each anchor gets a "View on ConfluxScan" link and a "Check against the chain" button (reads the event over RPC, compares it with the local ledger entry at `seq`, re-verifies the chain up to it). The tamper demo then shows both: the local chain breaks, and the on-chain anchor still holds the original hash, which proves the edit.
- Ledger export (`/api/ledger`, execution evidence) includes the anchor transactions.
- Tests run with a mocked RPC transport (no network in `npm test`): encoding, queue and retry, verification, and the tamper case.

**Status, 15 Oct evening (done early):** wallet funded (1000 test CFX); contract deployed at [`0x7cebbc3ac1a2ec61607025a589efa01b597c42cf`](https://evmtestnet.confluxscan.org/address/0x7cebbc3ac1a2ec61607025a589efa01b597c42cf) and its source verified on ConfluxScan; anchoring service, milestone hooks, Security Centre list with explorer links and "Check against the chain", 6 tests with a fake chain; checked live: a scenario 4 Replay produced two confirmed anchors, and after the tamper demo both checks fail at the edited entry. Still to do: a live run of each scenario with anchors on, a moment for the video, the stage view.

**Oct 16:** contract, compile and deploy script, anchoring service, milestone hooks, tests; deploy to the testnet once the wallet is funded.
**Oct 17:** Security Centre UI, export, TECHNICAL.md and SECURITY.md (what anchoring proves and what it doesn't: it proves the log wasn't changed after an anchor; it can't prove the events were true), a live run of each scenario with real anchors, and a moment for the video.

**Needed from you (Y), before Oct 16 starts:**
1. Decide on the wallet: (a) recommended: Claude generates a fresh testnet-only key straight into `.env.local` (`ANCHOR_PRIVATE_KEY`, never printed or committed) and prints only its address; or (b) you create a new wallet (e.g. MetaMask) used only for this, and put its private key in `.env.local` yourself. Never use a wallet that holds real money.
2. Fund the address with testnet CFX from the Conflux eSpace faucet (https://efaucet.confluxnetwork.org/). The faucet may have a captcha; Claude can't do that step. A few CFX is plenty (deploying and a few hundred anchors cost far less).
3. Optional: tell Claude if you'd rather use Sepolia (then you need Sepolia ETH from a faucet such as Google Cloud's or Alchemy's; some need a Google account or a small mainnet balance).

### Oct 17: More reasons to win
Pick by value; the first three are the strongest.
- [x] **C** *(done Oct 15, see the on-chain section above)* **(confirmed: bonus applies to Topic C)** **Anchor the log on-chain**: publish the activity log's head hash to a public test network at each case milestone, link the transaction from the Security Centre. Real on-chain hashes, cheap, and it strengthens tamper-evidence. (½ day)
- [x] **C** *(done Oct 14: Money tab, "Across currencies")* **Multi-currency view** (named in Topic C): per case, what left in PKR/CNY, what arrived in THB/GBP, fees and tax per route, refunds back in home currency
- [x] **C** *(done Oct 14: scenario `pk-admission`, rule `CARRYPAY.ADMISSION_VERIFIED_BEFORE_FEES`)* **A1** Admission-fraud protection and **scenario 3 (PK to UK/US tuition, fake agent)**, which also delivers the third corridor (rules already in `pk-sbp.json`)
- [x] **C** *(both done Oct 14: chaos buttons in the Director, `/bank/officer`)* **A5** Chaos mode *or* **A6** bank-officer view (whichever is further along)
- [x] **C** *(done Oct 14)* "Why?" on every rule chip: tap a rule ID to see a plain-language explanation and its source, in the family's language
- [x] **C** *(done Oct 14: `/pack`, print to PDF)* Receipt pack: one-tap PDF of all invoices, receipts, forms and the verified log, for insurance claims and tax records (and the "execution evidence" deliverable)
- [ ] **C** WhatsApp-style notifications (simulated): families in Pakistan live on WhatsApp; show the agent's messages arriving there
- [ ] **C** Family roles: the attendant can follow everything, but only the payer approves money
- [ ] **C** Impact panel on the landing page: time saved, fees saved, steps handled, using the scenario numbers
- [ ] **Y** Urdu review of the UI and agent messages (you're the native speaker)

### Oct 18: Polish and deploy, then feature freeze
- [ ] **C** Accessibility pass (contrast, focus states, screen-reader labels), dark mode check, empty and error states, loading skeletons *(started Oct 15: small grey text now passes WCAG AA in both themes (was 2.9:1 in light), one visible keyboard focus ring, focusable route list shows it; upload screen checked at 375px in light and dark; still to do: screen-reader pass of the stage and Director, empty/error states, loading skeletons)*
- [ ] **C** Sound and motion polish for the video: approval success, payment arrival
- [x] **C** *(manifest and icons done Oct 14; Oct 15: manifest and all icons served with the declared sizes, meets Chrome's install criteria; install test on real phones needs the HTTPS deployment)* **A8** PWA: manifest, icons, full-screen; test install on Android and iPhone (optional APK wrapper only if everything else is done)
- [ ] **C+Y** *(prep done Oct 15: standalone build, Dockerfile, Compose + Caddy for HTTPS and the event stream, [DEPLOY.md](DEPLOY.md); the production build was tested locally, including PDF upload, Replay and the stream; the Docker image itself is untested because Docker Desktop wasn't running. Needs from you: a server and the domain)* Deploy to a server outside mainland China (Singapore/HK/Tokyo) on our own domain (`carrypay.app` / `carrypayments.com` were free on Oct 14); HTTPS; long-running Node process
- [ ] **Y** Test the URL with a "website speed test from China" tool
- [ ] **All** End of day: **feature freeze.** Only fixes after this.

### Oct 19: Make the package
- [ ] **T+Y** Record the video (stage at 1920×1080, Live or Replay, voiceover recorded separately)
- [ ] **M** Bilingual subtitles 中英双语 from the final script (prompt 4), then **a native Chinese speaker checks them**
- [ ] **T** Deck (≤10 min, ~12 slides), including the **A7** business-model slide, the **A3** evaluation chart and **A4** interview quotes
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
| Source code: README, GitHub link, deployment steps, tests | https://github.com/JahanzaibMohsin9/carrypay, [README.md](../README.md), `npm test` |
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
