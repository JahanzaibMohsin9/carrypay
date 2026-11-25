import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseFlags } from "@/domain/flags";
import { midRate } from "@/domain/market";
import { compareSchedules, projectCashflow, type Projection } from "@/domain/plan/cashflow";
import { mandateReserve } from "@/domain/plan/mandate";
import type { AgentMode } from "@/domain/types";
import { Store } from "./store";
import { AgentRunner } from "./agent/runner";
import { seedScenario } from "./scenarios";
import { advanceToNext, injectStress, STRESS_FX_PCT, STRESS_SALARY_DAYS } from "./sim/engine";
import { setFlagsForTest } from "./flags";
import { decideArrangement, signMandate } from "./plan";
import { verifyChain } from "./hash";

// The Director's stress tests change the sandbox world itself: the payer's figures (a late salary) or the
// sandbox rate (a dearer pound). The planner, the mandate's reserve check and the agent all read that world.

const YR = "case_yr";

async function boot(mode: AgentMode = "scripted") {
  const store = new Store();
  store.load(() => seedScenario("uk-year"));
  store.reset(seedScenario("uk-year"));
  store.world.agent.mode = mode;
  const runner = new AgentRunner(store);
  runner.resetSession();
  (globalThis as Record<string, unknown>).__carrypay = { store, runner, autoplayTimer: setInterval(() => {}, 1 << 30), runnerClass: AgentRunner };
  const { decideApproval, directorAction } = await import("./runtime");
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 1));
    for (let i = 0; i < 400 && (runner.isBusy || store.world.agent.status === "working"); i++) await new Promise((r) => setTimeout(r, 5));
  };
  const next = async () => {
    advanceToNext(store);
    await settle();
  };
  return { store, w: () => store.world, next, settle, decideApproval, directorAction };
}

/** Run the scripted story until the plan is confirmed, the first instalment paid and the mandate signed. */
async function toSignedMandate() {
  const b = await boot();
  const { store, w, next, settle, decideApproval } = b;
  for (let i = 0; i < 40; i++) {
    const offered = Object.values(w().arrangements ?? {}).filter((a) => a.status === "offered");
    const accepted = Object.values(w().arrangements ?? {}).some((a) => a.status === "accepted");
    const unsigned = Object.values(w().mandates ?? {}).find((m) => m.status === "awaiting_approval");
    if (Object.values(w().approvals).some((a) => !a.decision)) {
      for (const a of Object.values(w().approvals).filter((x) => !x.decision)) decideApproval(a.id, "approved", "hold");
      await settle();
    } else if (unsigned) {
      signMandate(store, unsigned.id, "p_jianhua", "hold");
      await settle();
    } else if (offered.length && !accepted) {
      decideArrangement(store, compareSchedules(w(), YR, offered.map((a) => ({ id: a.id, label: a.title, schedule: a })))!.pickId!, "accept", "p_jianhua");
      await settle();
    } else if (w().schedule[0] && w().schedule[0].kind !== "plan.instalment_due") await next();
    else break;
  }
  const mandate = Object.values(w().mandates ?? {}).find((m) => m.status === "active")!;
  expect(mandate).toBeDefined();
  return { ...b, mandate };
}

const shape = (p: Projection) => ({ points: p.points.map(({ at, kind, amount, balance }) => ({ at, kind, amount, balance })), lowest: p.lowest, firstBreach: p.firstBreach });

beforeAll(() => setFlagsForTest(parseFlags("all")));
afterAll(() => setFlagsForTest(undefined));

describe("Director stress tests (uk-year)", () => {
  it("salary 3 weeks late moves the payer's coming salaries and the projection becomes the planner's own stress test", async () => {
    const { store, w, settle, mandate } = await toSignedMandate();
    const predicted = projectCashflow(w(), YR, { stress: { incomeDelayDays: STRESS_SALARY_DAYS } })!;
    const base = projectCashflow(w(), YR)!;
    expect(predicted.lowest.headroom).toBeLessThan(base.lowest.headroom);

    const st = injectStress(store, "salary_late");
    await settle();

    // the world changed: the payer's figures say the salary arrives 21 days late from today
    expect(w().funding![YR].income[0].late).toEqual({ from: w().now, days: STRESS_SALARY_DAYS });
    expect(st.moved).toEqual([{ label: "Salary", from: "2026-12-10T02:00:00.000Z", to: "2026-12-31T02:00:00.000Z" }]);
    // ...and the projection everyone reads is exactly what the stress test predicted
    const now = projectCashflow(w(), YR)!;
    expect(shape(now)).toEqual(shape(predicted));
    expect(now.assumptions.map((a) => a.id)).toContain("income_late");
    expect(st.before.lowestHeadroom).toBe(base.lowest.headroom);
    expect(st.after.lowestHeadroom).toBe(predicted.lowest.headroom);
    // the mandate's reserve check reads the same world
    expect(mandateReserve(w(), mandate)!.lowest.headroom).toBe(predicted.lowest.headroom);

    // logged like a chaos fault, and the agent re-ran the plan and told the family with the engine's numbers
    const logged = store.ledger.find((e) => e.type === "chaos.injected" && e.data.kind === "salary_late")!;
    expect(logged.data).toMatchObject({ label: "Salary 3 weeks late", after: { lowestHeadroom: predicted.lowest.headroom } });
    const wake = store.ledger.filter((e) => e.type === "agent.wake").at(-1)!;
    expect(wake.data).toMatchObject({ handwritten: "stress_test", triggers: [{ reason: "stress_test" }] });
    expect(store.ledger.slice(store.ledger.indexOf(wake)).filter((e) => e.type.startsWith("tool.")).map((e) => e.type)).toEqual(["tool.plan_affordability", "tool.message_family"]);
    const msg = w().messages.at(-1)!;
    expect(msg.from).toBe("agent");
    expect(msg.text).toContain("salary now arrives 31 December instead of 10 December");
    expect(msg.text).toContain(`CNY ${Math.round(predicted.lowest.headroom).toLocaleString("en-US")} above it`);
    expect(msg.text).toContain("The signed mandate can still pay the next instalment.");

    // pressing it twice doesn't stack
    expect(() => injectStress(store, "salary_late")).toThrow(/already applied/);
    expect(verifyChain(store.ledger).ok).toBe(true);
  });

  it("GBP +5% makes the sandbox pound 5% dearer from now on, in every price the engine computes", async () => {
    const { store, w, settle } = await toSignedMandate();
    const t0 = w().now;
    const earlier = "2026-11-02T07:01:00.000Z";
    const rateBefore = midRate("CNY", "GBP", t0, w().fxShocks);
    const base = projectCashflow(w(), YR)!;
    const predicted = projectCashflow(w(), YR, { stress: { fxShockPct: STRESS_FX_PCT } })!;

    const st = injectStress(store, "fx_up");
    await settle();

    expect(w().fxShocks).toEqual([{ currency: "GBP", pct: STRESS_FX_PCT, from: t0 }]);
    expect(st.label).toBe("GBP 5% dearer");
    expect(st.rate!.after / st.rate!.before).toBeCloseTo(1 + STRESS_FX_PCT, 10);
    expect(midRate("CNY", "GBP", t0, w().fxShocks) / rateBefore).toBeCloseTo(1.05, 10);
    // history keeps its rate: only from now on
    expect(midRate("CNY", "GBP", earlier, w().fxShocks)).toBe(midRate("CNY", "GBP", earlier));

    const now = projectCashflow(w(), YR)!;
    expect(now.payments).toHaveLength(base.payments.length);
    now.payments.forEach((p, i) => {
      expect(p.cost.midRate / base.payments[i].cost.midRate).toBeCloseTo(1.05, 10);
      expect(p.homeCost).toBeGreaterThan(base.payments[i].homeCost);
      // the planner's what-if scales the whole cost; the world only the part in pounds (the fixed cable fee stays)
      expect(Math.abs(p.homeCost - predicted.payments[i].homeCost)).toBeLessThan(10);
    });
    expect(now.lowest.headroom).toBeLessThan(base.lowest.headroom);
    expect(now.assumptions.map((a) => a.id)).toContain("fx_override");
    expect(store.ledger.some((e) => e.type === "chaos.injected" && e.data.kind === "fx_up")).toBe(true);
    expect(w().messages.at(-1)!.text).toMatch(/GBP is 5% dearer: 1 GBP now costs CNY \d+\.\d\d instead of \d+\.\d\d/);
  });

  it.each(["salary_late", "fx_up"] as const)("%s: when the stress breaks the reserve, the next instalment pauses the mandate instead of paying", async (kind) => {
    const { store, w, next, settle, mandate } = await toSignedMandate();
    // tighter savings: the plan still keeps the safety net, but with no room for this stress
    store.mutate((x) => (x.funding![YR].balances[0].amount = 240000));
    expect(mandateReserve(w(), mandate)!.firstBreach).toBeUndefined();

    injectStress(store, kind);
    await settle();
    const breach = mandateReserve(w(), mandate)!.firstBreach!;
    expect(breach).toBeDefined();
    expect(w().messages.at(-1)!.text).toContain("won't go ahead under the signed mandate");

    // a week before instalment 2 the agent proposes it as usual: the gateway's reserve check pauses the mandate
    expect(w().schedule[0].kind).toBe("plan.instalment_due");
    await next();
    const pay = Object.values(w().payments).find((p) => p.amount === 10665)!;
    expect(pay.status).toBe("awaiting_approval");
    expect(w().approvals[pay.approvalId!].decision).toBeUndefined();
    expect(w().mandates![mandate.id].status).toBe("paused");
    expect(w().mandates![mandate.id].pausedReason).toContain("below their safety net");
    const paused = store.ledger.find((e) => e.type === "mandate.paused")!;
    expect(paused.data.failed).toContain("reserve");
    expect(store.ledger.some((e) => e.type === "approval.mandate" && e.data.paymentId === pay.id)).toBe(false);
  });

  it("in Replay mode it runs fixed steps instead of consuming a recorded run", async () => {
    const { store, w, next, settle } = await boot("replay");
    injectStress(store, "salary_late");
    await settle();
    expect(store.ledger.filter((e) => e.type.startsWith("tool.")).map((e) => e.type)).toEqual(["tool.plan_affordability", "tool.message_family"]);
    // the recording still starts where it should: Yutong's first message plays the first recorded run
    await next();
    const firstRun = store.ledger.filter((e) => e.type.startsWith("tool.")).slice(2, 5).map((e) => e.type);
    expect(firstRun).toEqual(["tool.read_document", "tool.read_document", "tool.send_email"]);
    expect(w().agent.lastError).toBeUndefined();
  });

  it("is a Director action behind the plan flag, only for a case with the payer's figures", async () => {
    const { store, directorAction } = await boot();
    expect(() => directorAction({ action: "stress", kind: "rates_down" })).toThrow(/salary_late or fx_up/);
    setFlagsForTest(parseFlags("all,-plan"));
    try {
      expect(() => directorAction({ action: "stress", kind: "salary_late" })).toThrow(/plan feature/);
    } finally {
      setFlagsForTest(parseFlags("all"));
    }
    directorAction({ action: "stress", kind: "fx_up" });
    expect(store.world.stressTests?.map((s) => s.kind)).toEqual(["fx_up"]);
    store.reset(seedScenario("th-medical"));
    expect(() => directorAction({ action: "stress", kind: "salary_late" })).toThrow(/entered their figures/);
  });
});
