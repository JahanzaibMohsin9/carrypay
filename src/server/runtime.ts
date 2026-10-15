import { Store } from "./store";
import { AgentRunner, hasApiCredentials, MODEL } from "./agent/runner";
import { SCENARIOS, seedScenario, seedUpload } from "./scenarios";
import { advanceTo, advanceToNext, injectChaos, nextScheduled, runBeat, setPaymentStatus, submitPayment, verifyInstitution, type ChaosKind } from "./sim/engine";
import { hoursFrom } from "./sim/factory";
import { verifyChain } from "./hash";
import { listPasskeys } from "./passkey";
import type { AgentMode, UploadedBill } from "@/domain/types";
import { AnchorService, milestoneOf } from "./anchor/service";
import { ANCHOR_CHAIN, anchorConfig, explorerAddress, viemPublisher } from "./anchor/chain";

interface Runtime {
  store: Store;
  runner: AgentRunner;
  autoplayTimer: NodeJS.Timeout;
  runnerClass: typeof AgentRunner;
  /** on-chain anchoring, when the testnet key and contract are configured */
  anchors?: AnchorService;
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
    const cfg = anchorConfig();
    const anchors = cfg ? new AnchorService(store, viemPublisher(cfg)) : undefined;
    if (anchors) {
      store.on("logged", (e) => {
        const m = milestoneOf(e);
        if (m) anchors.milestone(m);
      });
    }
    g.__carrypay = { store, runner, autoplayTimer, runnerClass: AgentRunner, anchors };
  } else if (g.__carrypay.runnerClass !== AgentRunner && !g.__carrypay.runner.isBusy) {
    // dev hot reload: keep the world, swap in the new agent code
    // (in dev, API routes can also load separate copies of this module: keep the recording going either way)
    const prev = g.__carrypay.runner;
    prev.dispose();
    g.__carrypay.store.removeAllListeners("trigger");
    g.__carrypay.runner = new AgentRunner(g.__carrypay.store);
    g.__carrypay.runner.adoptSession(prev);
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
    anchoring: anchorConfig()
      ? { chain: ANCHOR_CHAIN.name, chainId: ANCHOR_CHAIN.id, contract: anchorConfig()!.contract, contractUrl: explorerAddress(anchorConfig()!.contract) }
      : null,
    chain: verifyChain(store.ledger),
    agentBusy: runner.isBusy || store.world.agent.status === "working",
    nextEvent: next ? { at: next.at, label: next.label } : null,
    hasKey: hasApiCredentials(),
    passkeys: listPasskeys().map((k) => ({ id: k.id.slice(0, 12), label: k.label, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })),
    model: MODEL,
    scenarios: SCENARIOS,
  };
}
export type PublicState = ReturnType<typeof publicState>;

// ---------------------------------------------------------------------------
// Family actions

export function decideApproval(approvalId: string, decision: "approved" | "declined", method: "passkey" | "hold", evidence?: Record<string, unknown>, actingPersonId?: string) {
  decideApprovalIn(runtime().store, approvalId, decision, method, evidence, actingPersonId);
}

/**
 * Family roles: anyone on the case can follow it and decline a payment (a brake), but only the person
 * whose account or card pays can approve it. The family app always says who is acting; sandbox automation
 * (Director, scripts, tests) doesn't, and is treated as the payer.
 */
export function checkApprover(store: Store, approvalId: string, decision: "approved" | "declined", actingPersonId?: string) {
  const a = store.world.approvals[approvalId];
  if (!a || decision !== "approved" || !actingPersonId) return;
  const p = store.world.payments[a.paymentId];
  if (actingPersonId === p.payerId) return;
  const people = store.world.cases[a.caseId].people;
  const payer = people.find((x) => x.id === p.payerId)?.name ?? "the payer";
  const actor = people.find((x) => x.id === actingPersonId)?.name ?? "someone not on the case";
  const id = store.nextId("sec");
  store.mutate((w) =>
    w.security.push({
      id,
      at: w.now,
      caseId: a.caseId,
      severity: "warning",
      kind: "blocked_wrong_approver",
      title: "Approval by someone other than the payer was refused",
      detail: `${actor} tried to approve "${a.summary}". Only ${payer}, whose money pays it, can approve.`,
    }),
  );
  store.log({ actor: "gateway", type: "approval.refused", caseId: a.caseId, narration: `Only ${payer} can approve this payment`, data: { approvalId, paymentId: p.id, actingPersonId, payerId: p.payerId } });
  throw new Error(`Only ${payer} can approve this payment: it is paid from their account or card. You can still decline it.`);
}

/** The family's decision on a payment, applied to a given world (the app's, or a test's). */
export function decideApprovalIn(store: Store, approvalId: string, decision: "approved" | "declined", method: "passkey" | "hold", evidence?: Record<string, unknown>, actingPersonId?: string) {
  const a = store.world.approvals[approvalId];
  if (!a || a.decision) throw new Error("This approval is no longer pending.");
  checkApprover(store, approvalId, decision, actingPersonId);
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
    data: { approvalId, paymentId: a.paymentId, method, ...(actingPersonId ? { by: actingPersonId } : {}), ...(evidence ? { passkey: evidence } : {}) },
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

/** The family sent their own bill: start a new case from it straight away (the agent mode stays as it was). */
export function startUploadedCase(bill: UploadedBill) {
  const { store, runner } = runtime();
  const mode = store.world.agent.mode;
  store.reset(seedUpload(bill));
  store.mutate((w) => (w.agent.mode = mode));
  store.log({ actor: "family", type: "scenario.loaded", data: { scenarioId: "upload", mode, source: bill.source, readBy: bill.readBy } });
  runner.resetSession();
  advanceToNext(store);
}

// ---------------------------------------------------------------------------
// Director (demo controls)

export function directorAction(body: Record<string, unknown>) {
  const { store, runner } = runtime();
  switch (body.action) {
    case "reset": {
      const id = String(body.scenarioId ?? store.world.scenarioId);
      const mode = (body.mode as AgentMode) ?? store.world.agent.mode;
      // the family's own bill can be replayed from the start; there is no seed for it without one
      const upload = id === "upload" ? store.world.upload : undefined;
      if (id === "upload" && !upload) throw new Error("No uploaded bill to restart from. Upload one in the app.");
      store.reset(upload ? seedUpload(upload) : seedScenario(id));
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
    case "chaos":
      if (!["bank_outage", "card_decline", "silent"].includes(String(body.kind))) throw new Error("chaos kind must be bank_outage, card_decline or silent");
      injectChaos(store, body.kind as ChaosKind);
      return;
    case "verify_institution":
      verifyInstitution(store);
      return;
    case "anchor": {
      const note = String(body.note ?? "Manual anchor").slice(0, 60);
      const { anchors } = runtime();
      if (anchors) anchors.flush(note);
      else store.addAnchor(note);
      return;
    }
    case "tamper":
      store.tamper(Number(body.seq), String(body.narration ?? "Paid THB 250,000 to SR Medical Services Co."));
      return;
    default:
      throw new Error(`Unknown director action ${String(body.action)}`);
  }
}
