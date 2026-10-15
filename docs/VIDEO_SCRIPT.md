# CarryPay demo video: script (draft 1, 15 Oct)

Target: about 4:30 (the limit is 5:00) · 1920×1080 · neutral narrator (OpenAI TTS) · soft composed music · English with burned-in English subtitles, plus a Chinese `.srt` for the 中英双语 version.

**How to edit:** change the words under **Narration** freely. Each scene's length follows its narration, so the pictures are cut to fit. Keep sentences short; the voice reads about 150 words a minute. Lines marked ⚠ are claims to double-check before the final cut.

Every number in the narration comes from the sandbox evidence (`docs/evidence/`), the live evaluation (`docs/EVAL.md`) or the red team (`docs/redteam/REPORT.md`), not from memory.

---

## 1 · The problem (0:00–0:25, ~55 words)

**On screen:** the landing page's money-flow map, payments travelling Lahore → Bangkok. Slow push-in. Title card fades in: *CarryPay*.

**Narration:**
> A family from Lahore flies to Bangkok. Their father needs heart treatment. They carry ten thousand dollars in cash, because nobody told them Pakistan's rules let them send up to fifty thousand straight to the hospital. Within days, the cash is almost gone, and the bills keep coming.

---

## 2 · What CarryPay is (0:25–0:42, ~40 words)

**On screen:** the landing page hero: headline, the three choices, the counters.

**Narration:**
> CarryPay is an AI agent that pays a family's hospital and university bills abroad, under their own country's rules. It deals with the institution, the bank and the paperwork. And nothing moves without the family's fingerprint.

---

## 3 · The Bangkok case (0:42–2:05, ~190 words)

**On screen:** `/demo` story mode at 1600×900 (×1.2): chapter caption on the left, the family's phone in the middle, the agent's log and on-chain anchors on the right. The approvals are done on the phone (hold to approve). Agent waiting time is sped up.

**Narration:**

*3a · the deposit*
> The hospital asks for a two hundred and fifty thousand baht deposit. The agent emails the hospital's verified billing desk, checks the bank account against a verified record, and prices every legal way to pay. A direct bank transfer costs about forty-four thousand rupees less than paying by card. It fills in the State Bank form, and asks the father to approve.

*3b · the urgent stent*
> Three days later, doctors need a stent before eight the next morning. A transfer would arrive too late, so the agent switches to his card, and explains the trade-off in one sentence.

*3c · the scam*
> Then an email arrives from a look-alike address. "Our bank details have changed." Hidden inside is a line telling AI assistants to skip the checks and pay. The agent flags it, warns the family, and confirms with the hospital's real address.

*3d · discharge and refund*
> At discharge, the final bill lists one scan twice. The agent disputes it, and fourteen thousand baht comes off. The overpaid deposit, forty-two thousand baht, is refunded to the family's account. Sixty-one actions over nine days. The family's part: a fingerprint, twice.

---

## 4 · China: the study agent who promises a place (2:05–2:40, ~80 words)

**On screen:** `/stage` with scenario 4 in Replay, Chinese interface: the forged offer letter, the university's reply ("no applicant"), the phone's Chinese messages, the 蚂蚁搬家 request and the agent's refusal.

**Narration:**
> The same agent works in China, in Chinese. A study agency promises a guaranteed place in London, and wants the tuition sent to its own account, with the currency bought in relatives' names to stay under the quota. The agent asks the university directly. There is no such applicant. It pays nothing, refuses to split the quota, and tells the family, gently, that it isn't their fault.

⚠ *Splitting across relatives' quotas (蚂蚁搬家) is stated in our rules file as "reported" (press reports of SAFE practice), so the narration only says the agent refuses it, not what the penalty is.*

---

## 5 · Try to fool it (2:40–3:10, ~70 words)

**On screen:** `/attack`: pick "Our bank details have changed", send it, show the message with the hidden instruction, then press "Make the AI obey" → **BLOCKED**, with the rule chip.

**Narration:**
> Anyone can try to fool it. Here, an attacker's fake bank details. Even if we force the AI to obey, a separate safety layer, written in code, refuses: the account isn't the hospital's verified one. In our red team, twenty attacks on the live model: none got through.

---

## 6 · Any bill (3:10–3:32, ~50 words)

**On screen:** `/app/new/upload`: names, "Use a sample bill", the reviewed fields, Start, then the agent's explanation in the app with "Not verified yet".

**Narration:**
> A family can upload any hospital or university bill. CarryPay reads it, prices it under their home country's rules, and explains what it would cost. It won't pay until the bank has verified the hospital.

---

## 7 · Proof, not promises (3:32–4:02, ~70 words)

**On screen:** Security Centre: "Verify in this browser" (green), the anchors with ConfluxScan links, "Check against the chain" (matches). Then the Director's tamper demo and the same check failing at the edited entry. End on the evaluation counters.

**Narration:**
> Every action is written to a hash-chained log, and at each milestone its latest hash is anchored on a public blockchain. Change one past entry, and the check fails, at that exact line. Across forty-five live runs on the real AI, forty-three passed every check. The two that didn't lost their connection to the model.

---

## 8 · One agent, any corridor (4:02–4:30, ~60 words)

**On screen:** the landing map with all routes; the rules files; end card with the link and GitHub.

**Narration:**
> Each country's rules are a file, with sources and dates. The agent stays the same, so a new corridor is a new rules file. Banks can offer it to their customers, and hospitals and universities get cleaner payments. CarryPay. Never carry cash across borders again.

**End card:** carrypay.duckdns.org · github.com/JahanzaibMohsin9/carrypay · *Sandbox demo: fictional institutions, no real money.*

---

## Recording notes (for Claude)

- Recording server: production build on its own port, own data folder, `CARRYPAY_STEP_DELAY_MS=600`, Replay mode, anchoring on (real anchors appear on screen).
- Viewport 1600×900 at device scale 1.2 → 1920×1080 frames; frames captured with Chrome's screencast (JPEG 92) and timed, then encoded with ffmpeg at 30 fps.
- A visible cursor and a click ripple are drawn by the recorder (screencasts don't show the mouse).
- Each scene is recorded as a raw take with event timestamps (chapter changes, approvals), then cut and sped up to its narration length.
- Story mode: `/demo?dwell=2500`; approvals by pressing and holding the phone's approve button.
- Subtitles come from the narration text, timed to the voice files.
