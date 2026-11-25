import { describe, expect, it } from "vitest";
import { Store } from "./store";
import { AgentRunner } from "./agent/runner";
import { seedScenario } from "./scenarios";
import { advanceToNext } from "./sim/engine";
import { verifyChain } from "./hash";
import { evaluateRun } from "./evaluate";

// Offline evaluation for CI: replays the curated live runs in recordings/ (the model's recorded decisions,
// executed for real against today's tools, safety gateway and rules engine) and scores each with evaluateRun,
// the same checks scripts/eval.mjs applies to live runs. No API key and no model call needed.
//   npm run eval:replay

const MAX_STEPS = 45;

async function replay(scenarioId: string) {
  const store = new Store();
  store.load(() => seedScenario(scenarioId));
  store.reset(seedScenario(scenarioId));
  store.world.agent.mode = "replay";
  const runner = new AgentRunner(store);
  runner.resetSession();
  (globalThis as Record<string, unknown>).__carrypay = { store, runner, autoplayTimer: setInterval(() => {}, 1 << 30), runnerClass: AgentRunner };
  const { decideApproval } = await import("./runtime");
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 1));
    for (let i = 0; i < 2000 && (runner.isBusy || store.world.agent.status === "working"); i++) await new Promise((r) => setTimeout(r, 5));
  };

  // Same loop as scripts/eval.mjs: approve whatever the agent proposes, otherwise advance the world.
  for (let i = 0; i < MAX_STEPS; i++) {
    const pending = Object.values(store.world.approvals).filter((a) => !a.decision);
    if (pending.length) for (const a of pending) decideApproval(a.id, "approved", "hold");
    else if (store.world.schedule.length) advanceToNext(store);
    else break;
    await settle();
  }
  return store;
}

describe("Replay evaluation (curated live runs)", () => {
  it.each(["th-medical", "uk-tuition", "pk-admission", "cn-admission"])("%s passes every evaluation check", async (scenarioId) => {
    const store = await replay(scenarioId);
    const ev = evaluateRun(store.world, store.ledger);
    expect(ev.mode).toBe("replay");
    expect(ev.checks.filter((c) => !c.pass)).toEqual([]);
    expect(ev.metrics.toolCalls).toBeGreaterThan(0);
    expect(ev.metrics.llmCalls).toBe(0);
    expect(verifyChain(store.ledger).ok).toBe(true);
  });
});

describe("Replay evaluation: a year in London (plan workflow, all features on)", () => {
  it("uk-year passes every evaluation check", async () => {
    const { parseFlags } = await import("@/domain/flags");
    const { setFlagsForTest } = await import("./flags");
    const { compareSchedules } = await import("@/domain/plan/cashflow");
    const { decideArrangement, signMandate } = await import("./plan");
    // recorded live on 25 Nov with every feature on (resolution included)
    setFlagsForTest(parseFlags("all"));
    try {
      const store = new Store();
      store.load(() => seedScenario("uk-year"));
      store.reset(seedScenario("uk-year"));
      store.world.agent.mode = "replay";
      const runner = new AgentRunner(store);
      runner.resetSession();
      (globalThis as Record<string, unknown>).__carrypay = { store, runner, autoplayTimer: setInterval(() => {}, 1 << 30), runnerClass: AgentRunner };
      const { decideApproval } = await import("./runtime");
      const settle = async () => {
        await new Promise((r) => setTimeout(r, 1));
        for (let i = 0; i < 2000 && (runner.isBusy || store.world.agent.status === "working"); i++) await new Promise((r) => setTimeout(r, 5));
      };
      const w = () => store.world;
      // the family's part, as in the live harness: approve, accept the engine's pick, sign the mandate
      for (let i = 0; i < MAX_STEPS; i++) {
        const pending = Object.values(w().approvals).filter((a) => !a.decision);
        const offered = Object.values(w().arrangements ?? {}).filter((a) => a.status === "offered");
        const accepted = Object.values(w().arrangements ?? {}).some((a) => a.status === "accepted");
        const unsigned = Object.values(w().mandates ?? {}).find((m) => m.status === "awaiting_approval");
        if (pending.length) for (const a of pending) decideApproval(a.id, "approved", "hold");
        else if (unsigned) signMandate(store, unsigned.id, unsigned.payerId, "hold");
        else if (offered.length && !accepted) decideArrangement(store, compareSchedules(w(), "case_yr", offered.map((a) => ({ id: a.id, label: a.title, schedule: a })))!.pickId!, "accept", "p_jianhua");
        else if (w().schedule.length) advanceToNext(store);
        else break;
        await settle();
      }
      const ev = evaluateRun(w(), store.ledger);
      expect(ev.mode).toBe("replay");
      expect(ev.checks.filter((c) => !c.pass)).toEqual([]);
      expect(ev.metrics.llmCalls).toBe(0);
      expect(verifyChain(store.ledger).ok).toBe(true);
    } finally {
      setFlagsForTest(undefined);
    }
  });
});
