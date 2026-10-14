import { Store } from "./store";
import { AgentRunner, hasApiCredentials, MODEL } from "./agent/runner";
import { SCENARIOS, seedScenario } from "./scenarios";
import { advanceTo, advanceToNext, nextScheduled, runBeat, setPaymentStatus, submitPayment } from "./sim/engine";
import { hoursFrom } from "./sim/factory";
import { verifyChain } from "./hash";
import type { AgentMode } from "@/domain/types";

interface Runtime {
  store: Store;
  runner: AgentRunner;
  autoplayTimer: NodeJS.Timeout;
  runnerClass: typeof AgentRunner;
}

const g = globalThis as unknown as { __carrypay?: Runtime };

export function runtime(): Runtime {
  if (!g.__carrypay) {
    const store = new Store();
    store.setMaxListeners(200);
    store.load(() => seedScenario("th-medical"));
    if (!hasApiCredentials() && store.ledger.length === 0) store.world.agent.mode = "scripted";
    const runner = new AgentRunner(store);
    runner.resetSession();
    const autoplayTimer = setInterval(() => autoplayTick(g.__carrypay!.store, g.__carrypay!.runner), 1500);
    g.__carrypay = { store, runner, autoplayTimer, runnerClass: AgentRunner };
  } else if (g.__carrypay.runnerClass !== AgentRunner && !g.__carrypay.runner.isBusy) {
    // dev hot reload: keep the world, swap in the new agent code
    g.__carrypay.store.removeAllListeners("trigger");
    g.__carrypay.runner = new AgentRunner(g.__carrypay.store);
    g.__carrypay.runner.resetSession();
    g.__carrypay.runnerClass = AgentRunner;
  }
  return g.__carrypay;
}

function pendingApprovals(store: Store) {
  return Object.values(store.world.approvals).filter((a) => !a.decision).length;
}

function autoplayTick(store: Store, runner: AgentRunner) {
  const w = store.world;
  if (!w.autoplay || runner.isBusy || w.agent.status === "working" || pendingApprovals(store) > 0) return;
  if (!nextScheduled(store)) {
    store.mutate((ww) => (ww.autoplay = false));
    return;
  }
  advanceToNext(store);
}

export function publicState() {
  const { store, runner } = runtime();
  const next = nextScheduled(store);
  return {
    world: store.world,
    ledger: store.ledger,
    anchors: store.anchors,
    chain: verifyChain(store.ledger),
    agentBusy: runner.isBusy || store.world.agent.status === "working",
    nextEvent: next ? { at: next.at, label: next.label } : null,
    hasKey: hasApiCredentials(),
    model: MODEL,
    scenarios: SCENARIOS,
  };
}
export type PublicState = ReturnType<typeof publicState>;

// ---------------------------------------------------------------------------
// Family actions

export function decideApproval(approvalId: string, decision: "approved" | "declined", method: "passkey" | "hold") {
  const { store } = runtime();
  const a = store.world.approvals[approvalId];
  if (!a || a.decision) throw new Error("This approval is no longer pending.");
  const p = store.world.payments[a.paymentId];
  store.mutate((w) => {
    w.approvals[approvalId].decision = decision;
    w.approvals[approvalId].decidedAt = w.now;
    w.approvals[approvalId].method = method;
  });
  store.log({
    actor: "family",
    type: decision === "approved" ? "approval.approved" : "approval.declined",
    caseId: a.caseId,
    narration: decision === "approved" ? `You approved: ${a.summary}` : `You declined: ${a.summary}`,
    data: { approvalId, paymentId: a.paymentId, method },
  });
  if (decision === "approved") {
    setPaymentStatus(store, p.id, "approved", `Approved by family (${method})`);
    submitPayment(store, store.world.payments[p.id]);
  } else {
    setPaymentStatus(store, p.id, "cancelled", "Declined by family");
  }
  store.trigger({ caseId: a.caseId, reason: "approval_decided", detail: `${decision}: ${a.summary}` });
}

export function familyMessage(caseId: string, text: string) {
  const { store } = runtime();
  const id = store.nextId("msg");
  store.mutate((w) => w.messages.push({ id, caseId, from: "family", text, at: w.now }));
  store.log({ actor: "family", type: "family.message", caseId, narration: text, data: { messageId: id } });
  store.trigger({ caseId, reason: "family_message", detail: text });
}

export function setKillSwitch(on: boolean) {
  const { store } = runtime();
  store.mutate((w) => {
    w.agent.killSwitch = on;
    w.agent.status = on ? "stopped" : "idle";
  });
  store.log({ actor: "family", type: on ? "agent.stopped" : "agent.resumed", narration: on ? "Emergency stop: the agent is paused" : "Agent resumed", data: {} });
}

// ---------------------------------------------------------------------------
// Director (demo controls)

export function directorAction(body: Record<string, unknown>) {
  const { store, runner } = runtime();
  switch (body.action) {
    case "reset": {
      const id = String(body.scenarioId ?? store.world.scenarioId);
      const mode = (body.mode as AgentMode) ?? store.world.agent.mode;
      store.reset(seedScenario(id));
      store.mutate((w) => (w.agent.mode = mode));
      store.log({ actor: "director", type: "scenario.loaded", data: { scenarioId: id, mode } });
      runner.resetSession();
      return;
    }
    case "next":
      advanceToNext(store);
      return;
    case "advance":
      advanceTo(store, hoursFrom(store.world.now, Number(body.hours ?? 1)));
      return;
    case "mode":
      store.mutate((w) => (w.agent.mode = body.mode as AgentMode));
      runner.resetSession();
      return;
    case "autoplay":
      store.mutate((w) => (w.autoplay = Boolean(body.on)));
      return;
    case "autoReply":
      store.mutate((w) => (w.autoReply = Boolean(body.on)));
      return;
    case "kill":
      setKillSwitch(Boolean(body.on));
      return;
    case "beat":
      runBeat(store, String(body.beat));
      store.mutate((w) => (w.schedule = w.schedule.filter((s) => (s.payload as { beat?: string }).beat !== body.beat)));
      return;
    case "nudge":
      store.trigger({ caseId: String(body.caseId), reason: "nudge" });
      return;
    case "anchor":
      store.addAnchor(String(body.note ?? "Manual anchor"));
      return;
    case "tamper":
      store.tamper(Number(body.seq), String(body.narration ?? "Paid THB 250,000 to SR Medical Services Co."));
      return;
    default:
      throw new Error(`Unknown director action ${String(body.action)}`);
  }
}
