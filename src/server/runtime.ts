import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, Store } from "./store";
import { AgentRunner, hasApiCredentials, MODEL } from "./agent/runner";
import { SCENARIOS, seedScenario, seedUpload } from "./scenarios";
import { advanceTo, advanceToNext, injectChaos, injectStress, nextScheduled, runBeat, setPaymentStatus, submitPayment, verifyInstitution, withdrawApproval, type ChaosKind } from "./sim/engine";
import { checkTerms } from "@/domain/approval-terms";
import { announceBankChange, verifyAllForSandbox } from "./verification";
import { flagOn } from "./flags";
import { hoursFrom } from "./sim/factory";
import { verifyChain } from "./hash";
import { listPasskeys } from "./passkey";
import type { AgentMode, StressKind, UploadedBill } from "@/domain/types";
import { AnchorService, milestoneOf } from "./anchor/service";
import { ANCHOR_CHAIN, anchorConfig, explorerAddress, FISCO_NAME, fiscoConfig, fiscoPublisher, viemPublisher, type ChainPublisher } from "./anchor/chain";
import { DEFAULT_SESSION } from "./session";
import { answerFamily } from "./agent/answer";
import { serverFlags } from "./flags";

interface Runtime {
  id: string;
  store: Store;
  runner: AgentRunner;
  autoplayTimer: NodeJS.Timeout;
  runnerClass: typeof AgentRunner;
  /** on-chain anchoring, when the testnet key and contract are configured */
  anchors?: AnchorService;
  lastSeen?: number;
}

// One sandbox world per visitor (see ./session). The default world keeps its old slot and folder, so
// local development, the scripts and the tests see no difference.
const g = globalThis as unknown as {
  __carrypay?: Runtime;
  __carrypaySessions?: Map<string, Runtime>;
  __carrypayPublisher?: ChainPublisher | null;
  __carrypayFisco?: ChainPublisher | null;
  __carrypaySweep?: NodeJS.Timeout;
};
const sessions = (g.__carrypaySessions ??= new Map());
const MAX_SESSIONS = Number(process.env.CARRYPAY_MAX_SESSIONS ?? 80);
const IDLE_MS = Number(process.env.CARRYPAY_SESSION_IDLE_HOURS ?? 6) * 3_600_000;

/** One wallet signs every anchor, from every world. */
function publisher(): ChainPublisher | null {
  if (g.__carrypayPublisher === undefined) {
    const cfg = anchorConfig();
    g.__carrypayPublisher = cfg ? viemPublisher(cfg) : null;
  }
  return g.__carrypayPublisher;
}

/** The second chain (FISCO BCOS), when configured: every anchor goes to both. */
function secondPublisher(): ChainPublisher | null {
  if (g.__carrypayFisco === undefined) {
    const cfg = fiscoConfig();
    g.__carrypayFisco = cfg ? fiscoPublisher(cfg) : null;
  }
  return g.__carrypayFisco;
}

function create(id: string): Runtime {
  const dir = id === DEFAULT_SESSION ? DATA_DIR : path.join(DATA_DIR, "sessions", id);
  const store = new Store(dir);
  store.setMaxListeners(200);
  store.load(() => seedScenario("th-medical"));
  if (store.ledger.length === 0) {
    const preferred = process.env.CARRYPAY_DEFAULT_MODE as AgentMode | undefined;
    if (preferred && ["live", "replay", "scripted"].includes(preferred)) store.world.agent.mode = preferred;
    else if (!hasApiCredentials()) store.world.agent.mode = "scripted";
  }
  const runner = new AgentRunner(store);
  runner.resetSession();
  const rt: Runtime = { id, store, runner, runnerClass: AgentRunner, autoplayTimer: setInterval(() => autoplayTick(rt.store, rt.runner), 1500) };
  const pub = publisher();
  if (pub) {
    const anchors = new AnchorService(store, pub, {}, secondPublisher() ?? undefined);
    store.on("logged", (e) => {
      const m = milestoneOf(e);
      if (m) anchors.milestone(m);
    });
    rt.anchors = anchors;
  }
  return rt;
}

function dispose(rt: Runtime) {
  clearInterval(rt.autoplayTimer);
  rt.runner.dispose();
  rt.anchors?.dispose();
  rt.store.removeAllListeners();
  if (rt.id !== DEFAULT_SESSION) fs.rmSync(rt.store.dataDir, { recursive: true, force: true });
}

/** Drop worlds nobody has looked at for a while, and the oldest ones beyond the limit. */
function sweep() {
  const now = Date.now();
  const byAge = [...sessions.values()].sort((a, b) => (a.lastSeen ?? 0) - (b.lastSeen ?? 0));
  for (const rt of byAge) {
    const tooMany = sessions.size > MAX_SESSIONS;
    if (!tooMany && now - (rt.lastSeen ?? 0) < IDLE_MS) break;
    if (rt.runner.isBusy) continue;
    sessions.delete(rt.id);
    dispose(rt);
  }
}
g.__carrypaySweep ??= setInterval(sweep, 10 * 60_000);

function hotSwap(rt: Runtime) {
  // dev hot reload: keep the world, swap in the new agent code
  // (in dev, API routes can also load separate copies of this module: keep the recording going either way)
  if (rt.runnerClass === AgentRunner || rt.runner.isBusy) return;
  const prev = rt.runner;
  prev.dispose();
  rt.store.removeAllListeners("trigger");
  rt.runner = new AgentRunner(rt.store);
  rt.runner.adoptSession(prev);
  rt.runnerClass = AgentRunner;
}

export function runtime(sid: string = DEFAULT_SESSION): Runtime {
  if (sid === DEFAULT_SESSION) {
    g.__carrypay ??= create(DEFAULT_SESSION);
    hotSwap(g.__carrypay);
    return g.__carrypay;
  }
  let rt = sessions.get(sid);
  if (!rt) {
    rt = create(sid);
    sessions.set(sid, rt);
    if (sessions.size > MAX_SESSIONS) sweep();
  }
  rt.lastSeen = Date.now();
  hotSwap(rt);
  return rt;
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

export function publicState(sid?: string) {
  const { store, runner } = runtime(sid);
  const next = nextScheduled(store);
  return {
    world: store.world,
    ledger: store.ledger,
    anchors: store.anchors,
    anchoring: anchorConfig()
      ? {
          chain: ANCHOR_CHAIN.name,
          chainId: ANCHOR_CHAIN.id,
          contract: anchorConfig()!.contract,
          contractUrl: explorerAddress(anchorConfig()!.contract),
          ...(fiscoConfig() ? { second: { chain: FISCO_NAME, chainId: fiscoConfig()!.chainId, contract: fiscoConfig()!.contract } } : {}),
        }
      : null,
    chain: verifyChain(store.ledger),
    agentBusy: runner.isBusy || store.world.agent.status === "working",
    nextEvent: next ? { at: next.at, label: next.label } : null,
    hasKey: hasApiCredentials(),
    passkeys: listPasskeys().map((k) => ({ id: k.id.slice(0, 12), label: k.label, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })),
    model: MODEL,
    scenarios: SCENARIOS.filter((s) => !s.flag || serverFlags()[s.flag]),
    flags: serverFlags(),
  };
}
export type PublicState = ReturnType<typeof publicState>;

// ---------------------------------------------------------------------------
// Family actions

export function decideApproval(approvalId: string, decision: "approved" | "declined", method: "passkey" | "hold", evidence?: Record<string, unknown>, actingPersonId?: string, sid?: string) {
  decideApprovalIn(runtime(sid).store, approvalId, decision, method, evidence, actingPersonId);
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
  if (decision === "approved" && a.terms) {
    // what the family approves is the payment on these terms: if any changed since it was put to them, this
    // approval is withdrawn (only this one) and they are asked again with the new facts
    const t = checkTerms(store.world, p, a.terms);
    if (t.changes.length) {
      withdrawApproval(store, approvalId, t.changes);
      throw new Error(`This approval was withdrawn because something changed: ${t.changes.map((c) => c.message).join(" ")} CarryPay will ask you again with the new figures.`);
    }
    if (t.requoted) {
      store.mutate((w) => (w.payments[p.id].cost = t.cost));
      store.log({
        actor: "gateway",
        type: "approval.requoted",
        caseId: a.caseId,
        narration: `The quote had expired: priced again at ${t.cost.sourceCurrency} ${Math.ceil(t.cost.totalSource).toLocaleString()}, within the ${a.terms.maxCost.currency} ${a.terms.maxCost.amount.toLocaleString()} approved`,
        data: { approvalId, paymentId: p.id, cost: Math.round(t.cost.totalSource * 100) / 100, maxCost: a.terms.maxCost.amount },
      });
    }
  }
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

const ANSWERS_PER_VISITOR = Number(process.env.CARRYPAY_ANSWERS_PER_VISITOR ?? 12);
const ANSWERS_PER_DAY = Number(process.env.CARRYPAY_ANSWERS_PER_DAY ?? 300);
const answers = ((globalThis as unknown as { __carrypayAnswers?: { day: string; total: number; by: Map<string, number> } }).__carrypayAnswers ??= { day: "", total: 0, by: new Map() });

/** Questions left for this visitor today when the agent isn't live (each one is a call to the model). */
function takeAnswer(sid: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (answers.day !== today) Object.assign(answers, { day: today, total: 0, by: new Map() });
  if ((answers.by.get(sid) ?? 0) >= ANSWERS_PER_VISITOR || answers.total >= ANSWERS_PER_DAY) return false;
  answers.by.set(sid, (answers.by.get(sid) ?? 0) + 1);
  answers.total += 1;
  return true;
}

/**
 * The family wrote (or spoke) to CarryPay. A live agent handles it like any event. In Replay or Scripted
 * mode the agent follows a recording or a plan, so the message must not be fed to it (it would play a
 * step out of context): the model answers the question instead, without tools (./agent/answer).
 */
export function familyMessage(caseId: string, text: string, sid?: string, opts: { voice?: boolean } = {}) {
  const { store } = runtime(sid);
  const id = store.nextId("msg");
  store.mutate((w) => w.messages.push({ id, caseId, from: "family", text, at: w.now, ...(opts.voice ? { voice: true } : {}) }));
  store.log({ actor: "family", type: "family.message", caseId, narration: text, data: { messageId: id, ...(opts.voice ? { voice: true } : {}) } });
  const w = store.world;
  if (w.agent.killSwitch) return;
  if (w.agent.mode === "live") {
    store.trigger({ caseId, reason: "family_message", detail: text });
    return;
  }
  if (!takeAnswer(sid ?? DEFAULT_SESSION)) {
    const reply = store.nextId("msg");
    const zh = w.cases[caseId]?.lang === "zh";
    const text2 = zh ? "今天可以提的问题用完了。在 Director 里切换到 Live 模式，AI 会处理整个案件。" : "That's all the questions for today in this demo. Switch the Director to Live mode to have the AI handle the whole case.";
    store.mutate((ww) => ww.messages.push({ id: reply, caseId, from: "agent", text: text2, at: ww.now, importance: "info" }));
    store.log({ actor: "agent", type: "agent.answer", caseId, narration: zh ? "提问次数已用完" : "Question limit reached", data: { messageId: reply, model: null, limit: true } });
    return;
  }
  void answerFamily(store, caseId, text);
}

export function setKillSwitch(on: boolean, sid?: string) {
  const { store } = runtime(sid);
  store.mutate((w) => {
    w.agent.killSwitch = on;
    w.agent.status = on ? "stopped" : "idle";
  });
  store.log({ actor: "family", type: on ? "agent.stopped" : "agent.resumed", narration: on ? "Emergency stop: the agent is paused" : "Agent resumed", data: {} });
}

/** The family sent their own bill: start a new case from it straight away (the agent mode stays as it was). */
export function startUploadedCase(bill: UploadedBill, sid?: string) {
  const { store, runner } = runtime(sid);
  const mode = store.world.agent.mode;
  store.reset(seedUpload(bill));
  store.mutate((w) => (w.agent.mode = mode));
  store.log({ actor: "family", type: "scenario.loaded", data: { scenarioId: "upload", mode, source: bill.source, readBy: bill.readBy } });
  runner.resetSession();
  advanceToNext(store);
}

// ---------------------------------------------------------------------------
// Director (demo controls)

export function directorAction(body: Record<string, unknown>, sid?: string) {
  const { store, runner, anchors } = runtime(sid);
  switch (body.action) {
    case "reset": {
      const id = String(body.scenarioId ?? store.world.scenarioId);
      const mode = (body.mode as AgentMode) ?? store.world.agent.mode;
      // the family's own bill can be replayed from the start; there is no seed for it without one
      const upload = id === "upload" ? store.world.upload : undefined;
      if (id === "upload" && !upload) throw new Error("No uploaded bill to restart from. Upload one in the app.");
      // a scenario behind a feature flag doesn't exist while its flag is off (not even by name)
      const listed = SCENARIOS.find((s) => s.id === id);
      if (id !== "upload" && (!listed || (listed.flag && !serverFlags()[listed.flag]))) throw new Error(`Unknown scenario ${id}`);
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
      setKillSwitch(Boolean(body.on), sid);
      return;
    case "beat":
      runBeat(store, String(body.beat));
      store.mutate((w) => (w.schedule = w.schedule.filter((s) => (s.payload as { beat?: string }).beat !== body.beat)));
      return;
    case "nudge":
      store.trigger({ caseId: String(body.caseId), reason: "nudge" });
      return;
    case "chaos":
      if (!["bank_outage", "card_decline", "silent", "unallocated"].includes(String(body.kind))) throw new Error("chaos kind must be bank_outage, card_decline, silent or unallocated");
      injectChaos(store, body.kind as ChaosKind);
      return;
    case "stress":
      if (!["salary_late", "fx_up"].includes(String(body.kind))) throw new Error("stress kind must be salary_late or fx_up");
      injectStress(store, body.kind as StressKind, body.caseId ? String(body.caseId) : undefined);
      return;
    case "bank_change": {
      // a genuine change of bank account by the case's institution, announced from its verified address
      if (!flagOn("verification")) throw new Error("The verification workbench is switched off.");
      const c0 = Object.values(store.world.cases)[0];
      if (!c0) throw new Error("No case loaded.");
      announceBankChange(store, c0.institutionId);
      return;
    }
    case "verify_institution": {
      // with the workbench on, the shortcut confirms each of the bank's checks (logged as the Director's)
      const inst = Object.values(store.world.cases)[0] && store.world.institutions[Object.values(store.world.cases)[0].institutionId];
      if (flagOn("verification") && inst?.origin === "uploaded_bill") verifyAllForSandbox(store, inst.id);
      else verifyInstitution(store);
      return;
    }
    case "anchor": {
      const note = String(body.note ?? "Manual anchor").slice(0, 60);
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
