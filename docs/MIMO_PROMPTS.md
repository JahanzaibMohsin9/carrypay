# Prompts for MiMo v2.6 Pro (Chinese language work)

MiMo handles the Chinese copy. Paste one prompt at a time. Ask MiMo to work on a separate git branch (or just show you its diff) so Claude can review it before it goes into `master`.

After MiMo's edits, run:

```bash
npm test
npx tsc --noEmit
```

Machine review is not a native speaker. Before the video and submission, have a native Chinese speaker read the subtitles and the China scenario once.

---

## Shared context (paste this first, before any prompt)

```
You are helping with CarryPay, a student project for the 2026 Shenzhen International FinTech Competition (International Track, organised by Tsinghua PBCSF and WeBank). CarryPay is an AI agent that pays a family's hospital or university bills abroad, following the home country's foreign-exchange rules. The judges are fintech and banking experts in Shenzhen.

The project is a Next.js + TypeScript app in this repository. One demo case is a Chinese family in Shenzhen paying their daughter's MSc fees at a (fictional) London university under SAFE rules: the USD 50,000 annual convenience quota (便利化额度), purchases above it for tuition with proof of the expense, the purpose declaration (个人购汇申请书), and the ban on using relatives' quotas (蚂蚁搬家).

Audience for the Chinese text: parents in mainland China using a mobile banking-style app. Tone: warm, calm, clear, like a good bank's app. Use Simplified Chinese and standard mainland banking terms (购汇, 电汇, 便利化额度, 经常项目, 资本项目, 收款人, 汇款附言).

Rules for editing:
- Only change Chinese text. Never change code, keys, variable names, function names, numbers, IDs, URLs or English text unless a prompt says so.
- Keep strings short: they appear on a phone screen about 375px wide.
- Keep "CarryPay" in Latin letters. Keep placeholders such as ${...} and {...} exactly as they are.
- If a regulatory statement looks wrong or uncertain, do not invent a correction: list it under "Questions for the team" instead.
- When you finish, list every change as: file, original text, new text, reason.
```

---

## Prompt 1: Review the Chinese UI strings

```
Open src/lib/i18n.tsx. It has three dictionaries: en, ur and zh. Review only the zh dictionary (const zh: Dict = { ... }).

For each entry, compare it with the English entry of the same key and improve the Chinese so it reads naturally to a mainland Chinese parent in a banking app. Fix awkward or literal translations, inconsistent terms, and anything too long for a phone button or tab label (tab labels: overview, activity, money, documents; keep them to 2–4 characters).

Use one term consistently for each concept across the whole dictionary (for example always 电汇 for bank transfer, always 额度 for quota/allowance).

Do not add or remove keys. Do not change the en or ur dictionaries.
```

## Prompt 2: Review the China scenario content and forms

```
Review the Chinese text in these places (only the Chinese text; do not change code):

1. src/server/scenarios.ts: in seedUkTuition(), the case title ("雨萱的硕士学费") and the brief (the father's message describing the situation). It should sound like a real father in Shenzhen writing to an app.
2. src/server/sim/engine.ts: the "uk.split_request" beat, the father's message asking to use his brother's quota. It should sound natural and a little hopeful, like a real parent asking.
3. src/server/agent/scripted.ts: the UK runs. Check the Chinese narrations and the message that explains why 蚂蚁搬家 is not allowed. It must be accurate, kind, not preachy, and short enough for a chat bubble.
4. src/domain/rules/packs/cn-safe.json: the Chinese terms inside rule titles. Check the regulatory terminology is correct.
5. src/server/agent/tools.ts: the function renderForm(), the 个人购汇申请书 template. Check the wording looks like a real bank form (申请人, 购汇金额, 购汇用途, 收款人, 承诺 wording).

For each regulatory claim (quota amount, what is allowed above the quota, what is prohibited, consequences of 蚂蚁搬家), say whether it matches your understanding of current SAFE rules. If unsure, put it under "Questions for the team" and do not change it.
```

## Prompt 3: Translate new strings (send after Claude adds them)

Claude will move the remaining hard-coded English UI text into the dictionaries and mark new Chinese entries with `// TODO zh`. Then send:

```
In src/lib/i18n.tsx, find every zh entry marked with the comment "// TODO zh". Translate the matching English entry into natural Simplified Chinese for a banking app, following the shared rules. Remove the TODO comment from each entry you finish. Do not touch other entries.
```

## Prompt 4: Bilingual video subtitles (send after the script is final)

```
Read docs/VIDEO_SCRIPT.md. It contains the English voiceover with timestamps.

Create docs/video/subtitles.zh-en.srt: a standard SRT file with bilingual subtitles, Chinese on the first line and English on the second line of each cue.

Rules:
- Follow the script's timestamps. Each cue 1.5–6 seconds; split long sentences into several cues.
- Chinese line at most 18 characters; English line at most 42 characters. Never more than 2 lines per cue.
- Natural spoken Chinese, not word-for-word. Keep the meaning, numbers and names exact.
- Keep these as written: CarryPay, SWIFT, SBP, SAFE, WeBank, THB, PKR, USD, CNY, GBP.
- Use 蚂蚁搬家 for quota splitting, 便利化额度 for the annual quota, 电汇 for bank transfer.
- Number the cues from 1. Use the timestamp format 00:00:01,000 --> 00:00:03,500.

Also create docs/video/subtitles.zh.srt with only the Chinese lines (same timings), in case the editor needs a single-language track.
```

## Prompt 5: Chinese project summary for the judges (optional)

```
Read README.md and docs/TECHNICAL.md. Write docs/SUMMARY.zh.md: a Chinese project summary for the competition judges.

Structure:
1. 一句话介绍 (one sentence)
2. 痛点 (the problem: families paying hospitals and universities abroad under capital controls; mention both the Pakistan story and the Chinese 便利化额度 case)
3. 解决方案 (what the agent does, step by step)
4. 安全与合规设计 (safety layer, permission tiers, verified accounts, hash-chained log, emergency stop, rules as versioned files with sources)
5. 技术架构 (short)
6. 可扩展性 (one agent, a new rules file per country)

Length: about 600–800 Chinese characters. Factual: only claim what the documents say. Professional tone suitable for WeBank and Tsinghua judges.
```

---

## Prompt 6: Review the Oct 14 additions (rule explanations and new screens)

Commit first, so MiMo's edits show up as a clean diff. Paste the shared context, then:

```
New Chinese text was added in two files. Each place is marked with a comment "// TODO zh". Review that Chinese (it is a first draft, not checked by a native speaker), improve it, and remove each "// TODO zh" comment when you have finished the text under it. Do not commit; leave your changes in the working tree.

1. src/lib/i18n.tsx, inside `const zh: Dict = { ... }`: the entries under the "// TODO zh" comments (fraud hold and case closed, passkey approval, privacy, the multi-currency card, the case pack link). Compare each with the English entry of the same key in `const en`. Context:
   - Passkey = 通行密钥; the family approves payments with fingerprint or face (指纹或面容).
   - "Across currencies" is a card on the Money tab: money that left the family's account in CNY, money that arrived in GBP, exchange markup, fees, refunds, and the all-in rate compared with the mid-market rate.
   - The privacy strings explain that names, ID/passport numbers, card numbers and medical details are replaced with placeholders before anything is sent to the AI.
   - The case pack is a printable PDF of all bills, receipts and forms.

2. src/domain/rules/explain.ts: each rule has a plain-language explanation shown when a parent taps a rule code. Review every `zh:` line and the `STATUS` lines.
   - Code like ${usd(r.values?.adultUSD)}, ${pct(now?.rate)} or ${r.consequence ...} inserts numbers or text at runtime. Keep every ${...} exactly as it is, including the characters inside the braces.
   - The Pakistan rules (PK.*) are shown to Chinese-speaking users only rarely; keep them accurate and plain rather than polished.
   - For the China rules (CN.FX.*), use standard SAFE and bank wording (便利化额度, 个人购汇申请书, 经常项目, 蚂蚁搬家). If a statement looks wrong, don't change its meaning: add it under "Questions for the team".

Afterwards run `npx tsc --noEmit` and `npm test` and report the results, then list every change as: file, key or rule ID, original, new, reason.
```

## Prompt 7: Check the Chinese the live agent writes (feedback only, optional)

The family's messages in the London case are written by the AI at run time, so they can't be fixed in a file. Ask MiMo for feedback that Claude can turn into prompt rules:

```
Open recordings/uk-tuition.json. It is a recorded run of the AI agent paying a Chinese family's London tuition. In each step where "tool" is "message_family", the "text" field is a message the agent sent to the father (林伟) in Chinese; placeholders such as [PERSON_1] stand for names. Do not edit any file.

For each message, rate it 1-5 on: natural Chinese for a parent, correct banking terms, accuracy against SAFE rules, warmth without being wordy. Then give at most 5 concrete style rules the agent should follow when writing Chinese to families (for example preferred terms, sentence length, how to state amounts in 人民币 and 英镑). Write the rules in English with Chinese examples.
```

---

## Prompt 8: Review scenario 4, the fake study agent in China (`cn-admission`)

Commit first, so MiMo's edits show up as a clean diff. Paste the shared context, then:

```
A new scenario was added: a Shenzhen family is told by a study agency (留学中介) that their daughter has a "保录取" (guaranteed) place at Kingsgate University London with a 40% scholarship. The agency wants a 保录取服务费, the tuition paid to its own account or to the consultant's personal WeChat/Alipay, and suggests buying the pounds in relatives' names to stay under the USD 50,000 quota (蚂蚁搬家). CarryPay checks with the university (no such applicant), pays nothing, refuses the quota split and tells the family what to do. Everyone in it is fictional.

The Chinese text is a first draft, not checked by a native speaker. Each place is marked with a comment "// TODO zh". Review it, improve it, and remove each "// TODO zh" comment when you have finished the text under it. Do not commit; leave your changes in the working tree.

1. src/server/scenarios.ts, function seedCnAdmission: the family's opening message ("brief") and the case title. It should sound like a worried Shenzhen father writing on his phone: natural, not formal, and keep every fact (names, amounts, 2 万元 deposit, 2.9 万美元 quota used, Friday deadline).
2. src/server/sim/engine.ts, case "cn.open": the forged offer letter. It is meant to look like a scam: mixed Chinese and English, slightly odd official wording. Make the Chinese realistic for a fake letter of this kind, but keep it obviously checkable (163.com address, personal WeChat, relatives' quotas). Keep the reference, amounts and account number unchanged.
3. src/server/sim/engine.ts, case "cn.pressure": the father's second message after the agent calls again. Natural spoken Chinese, under pressure.
4. src/server/agent/scripted.ts, const CN: the three message_family texts and every "narration". These are what the family sees in Scripted mode. Requirements: warm, short, never blame the family (keep 这不是您的错 or an equally clear sentence), say plainly that nothing was paid, tell them not to send more money, to keep evidence and to report to the police (110). Use standard SAFE wording: 便利化额度, 蚂蚁搬家, 购汇.
5. Check the reporting advice: is "到当地派出所报案或拨打 110" the right advice in mainland China for this kind of fraud? Should we also mention the national anti-fraud hotline 96110 or the 国家反诈中心 app? Answer under "Questions for the team"; don't add a number you are not sure of.

Afterwards run `npx tsc --noEmit` and `npm test` and report the results, then list every change as: file, location, original, new, reason.
```

---

## Prompt 9: Review the upload screen and the on-chain anchor strings

Commit first. Paste the shared context, then:

```
New Chinese strings were added in src/lib/i18n.tsx, inside `const zh: Dict = { ... }`, under "// TODO zh" comments: the "upload your own bill" screen (keys starting with upload..., onHoldUnverified, verifiedByBank, notVerified) and the on-chain anchors in the Security Centre (keys starting with anchor...). Also src/domain/rules/explain.ts, rule CARRYPAY.VERIFIED_INSTITUTION, and the two Chinese texts in src/server/agent/scripted.ts under "const UP" and in src/server/scenarios.ts, function seedUpload (case title and default message). Compare each with the English entry of the same key in `const en`.

Context:
- Upload: a family uploads a hospital or university bill (PDF or photo). CarryPay reads it and explains the cost under their home country's rules, but pays nothing until the bank has verified the hospital or university and its account.
- Anchors: at each milestone, the latest hash of CarryPay's activity log is written to a public blockchain (Conflux eSpace testnet), so anyone can check the log was not changed afterwards. Only hashes go on-chain. Use 区块链/公链, 哈希值, 上链, 锚定 as appropriate for a general (non-technical) parent, but keep it accurate.

Review, improve, and remove each "// TODO zh" comment when done. Do not commit. Run `npx tsc --noEmit` and `npm test`, then list every change as: file, key, original, new, reason.
```

---

## Prompt 10: Voice notes and answers (small, before the video)

Commit first. Paste the shared context, then:

```
A few new Chinese strings are marked with "// TODO zh": in src/lib/i18n.tsx (voice notes: recording, sending, the privacy note that OpenAI writes the voice down, "Listen"), in src/server/agent/answer.ts (replies when the AI can't answer: a recorded demo, a connection problem) and in src/server/runtime.ts (the daily question limit). Parents read these on their phone. Make them natural and short, keep the meaning, remove each "// TODO zh" when done, don't commit. Run `npx tsc --noEmit` and `npm test`, then list each change: file, original, new, reason.
```
