# CarryPay: notes for Claude

Read this first, then `docs/PLAN.md` for today's tasks. The competition brief is summarised in `docs/COMPETITION.md`.

## What this is

CarryPay is an AI agent that pays a family's cross-border hospital and university bills under their home country's FX rules. Entry for the 2026 Shenzhen FinTechathon, International Track, Topic C. **Deadline: 20 Oct 2026, 23:59 Beijing = 20:59 Pakistan time.** Scoring: task completion 40%, security & compliance 30%, innovation & interaction 30%. Official language: English.

The user is a student in Pakistan; the Bangkok scenario is based on their family's real experience.

## Commands

```bash
npm run dev                      # http://localhost:3000 (/stage, /app, /hospital, /bank, /director)
npm test                         # 31 tests: rules engine, both scenarios, 17 red-team attacks
npx tsc --noEmit && npx eslint src
node scripts/drive.mjs reset th-medical live   # then: next | approve | run 16 | log 30
```

This is **Next.js 16** with breaking changes from older versions: read `AGENTS.md` and `node_modules/next/dist/docs/` before using a Next API you haven't checked.

## Architecture in one breath

`src/domain/` is pure (types, rule packs as JSON, rules engine and route pricing, used by server and UI). `src/server/` holds the world store, hash-chained ledger, simulated institutions/bank/card (`sim/`), and the agent (`agent/`: tools + safety gateway in `tools.ts`, loop in `runner.ts`, provider selection in `llm.ts`, prompt in `prompt.ts`, scripted no-AI plans in `scripted.ts`). UI is client components fed by `/api/state` plus an SSE stream (`src/lib/client.tsx`).

## LLM provider

DeepSeek (`deepseek-v4-pro`) by default via the OpenAI SDK; OpenAI (`gpt-5.4-mini`) is the automatic fallback; Anthropic path still exists. Selection: `CARRYPAY_PROVIDER`, `CARRYPAY_MODEL`, keys in `.env.local` (never print or commit keys). DeepSeek with tools requires `reasoning_content` to be sent back on every request; the runner does this.

Agent modes: **Live** (LLM), **Replay** (re-executes the latest recorded live run from `.data/recordings/`), **Scripted** (hand-written, no AI, labelled as such in the UI; never present it as the AI).

## Rules for changes

- The safety gateway must not trust the model. Never move a check from code into the prompt.
- Every money amount, limit and cost shown or said comes from the engine, not from the model or hard-coded text.
- Regulations live in `src/domain/rules/packs/*.json` with source, status and dates. Don't state a rule as fact unless its status says so.
- Chinese copy is reviewed by MiMo v2.6 Pro (prompts in `docs/MIMO_PROMPTS.md`); new zh strings get a `// TODO zh` comment. Urdu is reviewed by the user.
- Keep `npm test`, `tsc` and `eslint` clean. Add a test when adding a rule or a safety check.
- UI: calm teal-on-sand design tokens in `src/app/globals.css`; use tokens, not raw colours (the outside-world panels are deliberately styled differently). Must work at 375px wide and in the stage phone frame.
- Commit only when the user asks; end commit messages with the Co-Authored-By line.
