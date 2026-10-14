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
