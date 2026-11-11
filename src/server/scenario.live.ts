// Plays scenarios end to end with the live model, in process (no dev server needed), several at once.
//   npm run eval:live                                   # one pk-admission run, printed
//   LIVE_SCENARIO=th-medical LIVE_RUNS=10 LIVE_CONCURRENCY=4 npm run eval:live   # appended to docs/eval/runs.jsonl
//   LIVE_CHAOS=bank_outage,card_decline LIVE_SCENARIO=th-medical npm run eval:live   (faults armed from the start)
//   LIVE_SCENARIO=upload npm run eval:live              # the sample bill from "Upload your own bill"
// Results use the same format as scripts/eval.mjs, so `node scripts/eval.mjs report` covers both.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "./store";
import { AgentRunner } from "./agent/runner";
import { hasProviderKey } from "./agent/llm";
import { seedScenario, seedUpload } from "./scenarios";
import { sampleDraft } from "./upload";
import { advanceToNext, injectChaos, verifyInstitution, type ChaosKind } from "./sim/engine";
import { evaluateRun } from "./evaluate";
import { decideApprovalIn } from "./runtime";
import { compareSchedules } from "@/domain/plan/cashflow";
import { parseFlags } from "@/domain/flags";
import { setFlagsForTest } from "./flags";
import { decideArrangement, payerOf } from "./plan";

/** The payer follows CarryPay's advice: accept the plan the engine picks among the open offers. */
function acceptPick(store: Store): boolean {
  const w = store.world;
  const caseId = Object.keys(w.cases)[0];
  const offered = Object.values(w.arrangements ?? {}).filter((a) => a.caseId === caseId && a.status === "offered" && (!a.expiresAt || a.expiresAt > w.now));
  if (!offered.length || Object.values(w.arrangements ?? {}).some((a) => a.caseId === caseId && a.status === "accepted")) return false;
  const cmp = compareSchedules(w, caseId, offered.map((a) => ({ id: a.id, label: a.title, schedule: a })));
  decideArrangement(store, cmp?.pickId ?? offered[0].id, "accept", payerOf(store, caseId));
  return true;
}

const SCENARIO = process.env.LIVE_SCENARIO ?? "pk-admission";
const RUNS = Number(process.env.LIVE_RUNS ?? 1);
const CONCURRENCY = Number(process.env.LIVE_CONCURRENCY ?? 3);
const CONFIG = process.env.EVAL_CONFIG ?? "v3.1 (China fake-agent scenario, explicit no-blame wording)";
const RUNS_FILE = path.join(process.cwd(), "docs", "eval", "runs.jsonl");
const MAX_STEPS = 45;
// the plan workflow's scenario needs its features on (other scenarios run as the server is configured)
if (SCENARIO === "uk-year") setFlagsForTest(parseFlags(process.env.CARRYPAY_FLAGS || "all"));

async function playOnce(i: number) {
  const store = new Store();
  // "upload": the sample bill from the upload screen; the bank verifies it once the agent has explained it
  const family = { home: "PK" as const, type: "medical" as const, payerName: "Ayesha Khan", subjectName: "Imran Khan", alreadyAbroad: true };
  store.reset(SCENARIO === "upload" ? seedUpload(sampleDraft(family)) : seedScenario(SCENARIO));
  store.world.agent.mode = "live";
  for (const kind of (process.env.LIVE_CHAOS ?? "").split(",").filter(Boolean)) injectChaos(store, kind as ChaosKind);
  const runner = new AgentRunner(store);
  runner.resetSession();
  const idle = async () => {
    await new Promise((r) => setTimeout(r, 50));
    while (runner.isBusy) await new Promise((r) => setTimeout(r, 500));
  };
  const t0 = Date.now();
  for (let step = 0; step < MAX_STEPS; step++) {
    const pending = Object.values(store.world.approvals).filter((a) => !a.decision);
    if (pending.length) for (const a of pending) decideApprovalIn(store, a.id, "approved", "hold");
    else if (acceptPick(store)) {
      // the acceptance goes to the university; its confirmation wakes the agent
    } else if (store.world.schedule.length) advanceToNext(store);
    else if (store.world.institutions.upl && !store.world.institutions.upl.verifiedAt) verifyInstitution(store);
    else break;
    await idle();
  }
  runner.dispose();
  const ev = evaluateRun(store.world, store.ledger);
  const record = {
    at: new Date().toISOString(),
    config: CONFIG,
    harness: "in-process",
    chaos: process.env.LIVE_CHAOS || undefined,
    recording: runner.recordingFile ? path.basename(runner.recordingFile) : undefined,
    wallSeconds: Math.round((Date.now() - t0) / 1000),
    failure: null,
    ...ev,
  };
  const failed = ev.checks.filter((c) => !c.pass).map((c) => c.id);
  console.log(`${SCENARIO} #${i + 1}: ${ev.success ? "SUCCESS" : "FAIL " + failed.join(",")} · ${ev.metrics.wakeups} wake-ups · ${ev.metrics.emailsToInstitution} emails · ${ev.metrics.llmCalls} LLM calls · ${record.wallSeconds}s`);
  return { store, ev, record };
}

describe.skipIf(!hasProviderKey())(`live: ${SCENARIO} ×${RUNS}`, () => {
  it("completes every check", async () => {
    const results: Awaited<ReturnType<typeof playOnce>>[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, RUNS) }, async () => {
        while (next < RUNS) {
          const i = next++;
          const r = await playOnce(i);
          results.push(r);
          if (RUNS > 1 && !process.env.LIVE_CHAOS) fs.appendFileSync(RUNS_FILE, JSON.stringify(r.record) + "\n");
        }
      }),
    );
    if (RUNS === 1) {
      const { store, ev } = results[0];
      console.log(JSON.stringify({ success: ev.success, failed: ev.checks.filter((c) => !c.pass), metrics: ev.metrics }, null, 1));
      for (const m of store.world.messages.filter((x) => x.from === "agent")) console.log(`[${m.importance}] ${m.text}`);
    }
    expect(results.filter((r) => !r.ev.success).map((r) => r.ev.checks.filter((c) => !c.pass))).toEqual([]);
  });
});
