// Affordability planner: can the family carry everything they owe without falling below the reserve
// they chose? Pure and deterministic. Every amount comes from the rules engine's route pricing and limit
// checks; the agent only reads and explains the result.
//
// Honest by construction:
// - future payments are priced at today's sandbox rate, never a forecast; currency risk is an explicit stress
// - only money the family has, earns on a stated date, or is confirmed to receive counts
// - instalments come from the institution's own terms (an Arrangement), never invented here
import { corridorOf } from "../corridors";
import { evaluateRoute, priceRoute, type RouteEvaluation } from "../rules/engine";
import type { CaseFile, CostBreakdown, Currency, Payment, Route, World } from "../types";
import type { Arrangement, FundingProfile, NamedStress, Stress } from "./types";

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY).toISOString();

/** Same day of month, n months later (clamped: 31 Jan + 1 month = 28/29 Feb), in UTC. */
export function addMonths(iso: string, n: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString();
}

// money already on its way or delivered has left the family's account (their balances reflect it)
const SENT = new Set<Payment["status"]>(["submitted", "processing", "completed"]);

export interface Obligation {
  id: string;
  invoiceId: string;
  institutionId: string;
  label: string;
  /** still to pay, in the invoice currency */
  amount: number;
  currency: Currency;
  dueAt: string;
  source: "invoice" | "arrangement";
  arrangementId?: string;
  /** 1-based instalment number within the arrangement */
  instalment?: number;
  /** part of `amount` that is the arrangement's administration fee */
  fee?: number;
}

/**
 * Which schedule to plan with:
 * - "current" (default): an accepted arrangement replaces its invoice, otherwise the invoice as issued
 * - "upfront": every open invoice as issued, ignoring arrangements
 * - an Arrangement: that offer replaces its invoice (to compare offers before accepting one)
 */
export type Schedule = "current" | "upfront" | Arrangement;

export function obligationsFor(world: World, caseId: string, schedule: Schedule = "current"): Obligation[] {
  const out: Obligation[] = [];
  const invoices = Object.values(world.invoices).filter((i) => i.caseId === caseId && (i.status === "open" || i.status === "disputed"));
  for (const inv of invoices) {
    const sent = Object.values(world.payments)
      .filter((p) => p.invoiceId === inv.id && SENT.has(p.status))
      .reduce((s, p) => s + p.amount, 0);
    const arrangement =
      typeof schedule === "object"
        ? schedule.invoiceId === inv.id
          ? schedule
          : undefined
        : schedule === "current"
          ? Object.values(world.arrangements ?? {}).find((a) => a.invoiceId === inv.id && a.status === "accepted" && a.confirmationDocId)
          : undefined;
    if (!arrangement) {
      const amount = r2(inv.amountDue - sent);
      if (amount > 0.005) {
        out.push({ id: `${inv.id}`, invoiceId: inv.id, institutionId: inv.institutionId, label: inv.number, amount, currency: inv.currency, dueAt: inv.dueAt ?? world.now, source: "invoice" });
      }
      continue;
    }
    // money already sent pays the earliest instalments first
    let credit = sent;
    arrangement.instalments.forEach((ins, k) => {
      const fee = k === 0 ? arrangement.fee ?? 0 : 0;
      const gross = ins.amount + fee;
      const covered = Math.min(credit, gross);
      credit -= covered;
      const amount = r2(gross - covered);
      if (amount <= 0.005) return;
      out.push({
        id: `${arrangement.id}#${k + 1}`,
        invoiceId: inv.id,
        institutionId: inv.institutionId,
        label: `${arrangement.title} ${k + 1}/${arrangement.instalments.length}`,
        amount,
        currency: arrangement.currency,
        dueAt: ins.dueAt,
        source: "arrangement",
        arrangementId: arrangement.id,
        instalment: k + 1,
        fee: fee && covered < fee ? r2(fee - covered) : undefined,
      });
    });
  }
  return out.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export interface PlannedPayment {
  obligation: Obligation;
  route: Route;
  /** when the money must leave to arrive a day before it is due (never earlier than now) */
  payAt: string;
  /** arrives in time if paid at payAt */
  onTime: boolean;
  /** amount delivered, in the invoice currency, after any cost-increase stress */
  deliverAmount: number;
  /** what the family pays, in home currency, after any FX stress */
  homeCost: number;
  cost: CostBreakdown;
  /** calendar year whose personal quota/allowance it counts against */
  quotaYear: number;
  /** the rules engine's verdict as of the payment date: limits, documents, blockers */
  evaluation: RouteEvaluation;
}

export interface CashflowPoint {
  at: string;
  kind: "start" | "income" | "essentials" | "payment" | "conditional";
  label: string;
  /** signed: + in, − out (home currency) */
  amount: number;
  /** balance after this event */
  balance: number;
}

export interface Assumption {
  id: "rate_today" | "balances_entered" | "essentials_monthly" | "pay_ahead" | "conditional_excluded" | "conditional_counted" | "stress";
  text: string;
}

export interface Projection {
  caseId: string;
  currency: Currency;
  reserveFloor: number;
  stress: Stress;
  from: string;
  until: string;
  points: CashflowPoint[];
  payments: PlannedPayment[];
  /** total home-currency cost of the payments in the plan */
  totalHomeCost: number;
  lowest: { at: string; balance: number; headroom: number };
  /** first moment the balance is below the reserve */
  firstBreach?: { at: string; balance: number; shortBy: number; cause: string };
  /** a payment the rules engine would block on its date */
  blocked: { obligationId: string; reasons: string[] }[];
  endBalance: number;
  assumptions: Assumption[];
}

export interface ProjectOptions {
  /** defaults to world.funding[caseId] */
  profile?: FundingProfile;
  schedule?: Schedule;
  stress?: Stress;
  route?: Route;
  /** end of the projection; default 31 days after the last payment (90 days if there is none) */
  until?: string;
}

/** Project the family's balance through every payment they owe. Undefined if they haven't entered their figures. */
export function projectCashflow(world: World, caseId: string, opts: ProjectOptions = {}): Projection | undefined {
  const profile = opts.profile ?? world.funding?.[caseId];
  const caseFile = world.cases[caseId];
  if (!profile || !caseFile) return undefined;
  const stress = opts.stress ?? {};
  const route: Route = opts.route ?? "bank_transfer";
  const now = world.now;
  const payer = caseFile.people.find((p) => p.id === profile.ownerPersonId);
  const corridor = corridorOf(caseFile.corridor);

  const payments = planPayments(world, caseFile, opts.schedule ?? "current", stress, route, payer?.id);
  const lastPay = payments.reduce((m, p) => (p.payAt > m ? p.payAt : m), now);
  const until = opts.until ?? addDays(lastPay, payments.length ? 31 : 90);

  type Ev = Omit<CashflowPoint, "balance"> & { order: number };
  const events: Ev[] = [];
  // outflows before inflows at the same moment: a salary paid "today" can't be assumed to land before a bill
  for (const income of profile.income) {
    let at = income.firstAt;
    for (let n = 0; n < 240 && at <= until; n++) {
      const lands = addDays(at, stress.incomeDelayDays ?? 0);
      if (at >= now && lands <= until) events.push({ at: lands, kind: "income", label: income.label, amount: income.amount, order: 2 });
      if (!income.everyMonths) break;
      at = addMonths(income.firstAt, income.everyMonths * (n + 1));
    }
  }
  if (profile.essentialsMonthly > 0) {
    const d = new Date(now);
    let first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
    while (first <= until) {
      events.push({ at: first, kind: "essentials", label: "Monthly essentials", amount: -profile.essentialsMonthly, order: 0 });
      first = addMonths(first, 1);
    }
  }
  for (const c of profile.conditional) {
    if (c.status !== "confirmed" && !stress.countExpectedConditional) continue;
    const at = addDays(c.expectedAt, stress.conditionalDelayDays ?? 0);
    if (at >= now && at <= until) events.push({ at, kind: "conditional", label: c.label, amount: c.amount, order: 2 });
  }
  for (const p of payments) {
    events.push({ at: p.payAt, kind: "payment", label: p.obligation.label, amount: -p.homeCost, order: 1 });
  }
  events.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);

  const start = r2(profile.balances.reduce((s, b) => s + b.amount, 0));
  const points: CashflowPoint[] = [{ at: now, kind: "start", label: "Available now", amount: start, balance: start }];
  let balance = start;
  for (const e of events) {
    balance = r2(balance + e.amount);
    points.push({ at: e.at, kind: e.kind, label: e.label, amount: r2(e.amount), balance });
  }

  const reserve = profile.reserveFloor;
  const low = points.reduce((m, p) => (p.balance < m.balance ? p : m), points[0]);
  const breach = points.find((p) => p.balance < reserve - 0.005);

  const assumptions: Assumption[] = [
    { id: "rate_today", text: "Every payment is priced at today's exchange rate and fees; no forecast." },
    { id: "balances_entered", text: `Money available, income and essentials as entered on ${profile.updatedAt.slice(0, 10)}. CarryPay sees no bank account.` },
    { id: "essentials_monthly", text: "Monthly essentials are set aside on the 1st of each month." },
    { id: "pay_ahead", text: `Each payment leaves early enough to arrive a day before it is due (${corridor.label}, ${route.replace("_", " ")}).` },
    stress.countExpectedConditional
      ? { id: "conditional_counted", text: "Money that is expected but not confirmed is counted as if it were certain." }
      : { id: "conditional_excluded", text: "Money that is expected but not confirmed is not counted." },
  ];
  const stressText = describeStress(stress);
  if (stressText) assumptions.push({ id: "stress", text: `Stress test: ${stressText}.` });

  return {
    caseId,
    currency: profile.currency,
    reserveFloor: reserve,
    stress,
    from: now,
    until,
    points,
    payments,
    totalHomeCost: r2(payments.reduce((s, p) => s + p.homeCost, 0)),
    lowest: { at: low.at, balance: low.balance, headroom: r2(low.balance - reserve) },
    firstBreach: breach ? { at: breach.at, balance: breach.balance, shortBy: r2(reserve - breach.balance), cause: breach.label } : undefined,
    blocked: payments.filter((p) => !p.evaluation.allowed).map((p) => ({ obligationId: p.obligation.id, reasons: p.evaluation.blockers.map((b) => b.message) })),
    endBalance: balance,
    assumptions,
  };
}

function planPayments(world: World, caseFile: CaseFile, schedule: Schedule, stress: Stress, route: Route, payerId: string | undefined): PlannedPayment[] {
  const now = world.now;
  const payer = caseFile.people.find((p) => p.id === payerId);
  const planned: PlannedPayment[] = [];
  // payments of this case not yet sent are part of the plan below, so they mustn't count against a quota twice
  const kept = Object.fromEntries(Object.entries(world.payments).filter(([, p]) => p.caseId !== caseFile.id || !["awaiting_approval", "approved"].includes(p.status)));
  // earlier planned payments count against the same year's quota for the later ones
  const synthetic: Record<string, Payment> = {};
  for (const ob of obligationsFor(world, caseFile.id, schedule)) {
    const institution = world.institutions[ob.institutionId];
    const deliverAmount = r2(ob.amount * (1 + (stress.costIncreasePct ?? 0)));
    const cost = priceRoute({ corridor: caseFile.corridor, route, deliverAmount, institution, simDate: now });
    if (!cost) continue;
    const leadMs = (cost.arrivesInHours + 24) * 3_600_000;
    const ideal = new Date(Date.parse(ob.dueAt) - leadMs).toISOString();
    const payAt = ideal > now ? ideal : now;
    const onTime = Date.parse(payAt) + cost.arrivesInHours * 3_600_000 <= Date.parse(ob.dueAt);
    const asOf: World = { ...world, now: payAt, payments: { ...kept, ...synthetic } };
    const evaluation = evaluateRoute({ world: asOf, caseFile, payer, route, amount: deliverAmount, currency: ob.currency, invoiceId: ob.invoiceId });
    planned.push({
      obligation: ob,
      route,
      payAt,
      onTime,
      deliverAmount,
      homeCost: r2(cost.totalSource * (1 + (stress.fxShockPct ?? 0))),
      cost,
      quotaYear: Number(payAt.slice(0, 4)),
      evaluation,
    });
    const id = `plan_${ob.id}`;
    synthetic[id] = {
      id,
      caseId: caseFile.id,
      invoiceId: ob.invoiceId,
      institutionId: ob.institutionId,
      route,
      amount: deliverAmount,
      currency: ob.currency,
      payerId: payerId ?? "",
      reference: "",
      beneficiary: { accountName: "", accountNumber: "", swift: "", bankName: "" },
      cost,
      rationale: "planned",
      status: "approved",
      statusHistory: [],
      createdAt: payAt,
      attempts: 0,
    };
  }
  return planned;
}

export function describeStress(s: Stress): string {
  const parts: string[] = [];
  if (s.incomeDelayDays) parts.push(`income arrives ${s.incomeDelayDays} days late`);
  if (s.fxShockPct) parts.push(`the foreign currency costs ${Math.round(s.fxShockPct * 100)}% more`);
  if (s.costIncreasePct) parts.push(`unpaid bills rise ${Math.round(s.costIncreasePct * 100)}%`);
  if (s.conditionalDelayDays) parts.push(`refunds and reimbursements arrive ${s.conditionalDelayDays} days late`);
  return parts.join(", ");
}

/** The stress tests shown by default: a late salary and a weaker home currency. */
export const DEFAULT_STRESSES: NamedStress[] = [
  { id: "salary_late", label: "Salary 3 weeks late", stress: { incomeDelayDays: 21 } },
  { id: "fx_5", label: "Foreign currency 5% dearer", stress: { fxShockPct: 0.05 } },
];

export interface ScheduleOption {
  id: string;
  label: string;
  schedule: Schedule;
}

export interface ComparisonRow {
  id: string;
  label: string;
  totalHomeCost: number;
  /** administration fees in the plan, home currency at today's rate */
  feesHomeCost: number;
  payments: number;
  firstPaymentAt?: string;
  firstPaymentHomeCost?: number;
  lowestHeadroom: number;
  firstBreach?: Projection["firstBreach"];
  /** every payment arrives on time and the rules engine allows it */
  feasible: boolean;
  stress: { id: string; label: string; holds: boolean; lowestHeadroom: number; firstBreach?: Projection["firstBreach"] }[];
  /** keeps the reserve in the base case and under every stress test */
  holdsAll: boolean;
}

export interface Comparison {
  currency: Currency;
  reserveFloor: number;
  rows: ComparisonRow[];
  /**
   * The engine's pick, not the model's: the cheapest feasible option that keeps the reserve under every
   * stress test; if none does, the feasible option whose lowest point is highest.
   */
  pickId?: string;
  pickReason?: "cheapest_that_holds" | "most_headroom";
}

export function compareSchedules(world: World, caseId: string, options: ScheduleOption[], stresses: NamedStress[] = DEFAULT_STRESSES, profile?: FundingProfile): Comparison | undefined {
  const fp = profile ?? world.funding?.[caseId];
  if (!fp) return undefined;
  const rows: ComparisonRow[] = [];
  for (const opt of options) {
    const base = projectCashflow(world, caseId, { profile: fp, schedule: opt.schedule })!;
    const feeShare = base.payments.reduce((s, p) => s + (p.obligation.fee ? (p.homeCost * p.obligation.fee) / p.deliverAmount : 0), 0);
    const stressRows = stresses.map((st) => {
      const pr = projectCashflow(world, caseId, { profile: fp, schedule: opt.schedule, stress: st.stress })!;
      return { id: st.id, label: st.label, holds: !pr.firstBreach, lowestHeadroom: pr.lowest.headroom, firstBreach: pr.firstBreach };
    });
    rows.push({
      id: opt.id,
      label: opt.label,
      totalHomeCost: base.totalHomeCost,
      feesHomeCost: r2(feeShare),
      payments: base.payments.length,
      firstPaymentAt: base.payments[0]?.payAt,
      firstPaymentHomeCost: base.payments[0]?.homeCost,
      lowestHeadroom: base.lowest.headroom,
      firstBreach: base.firstBreach,
      feasible: base.blocked.length === 0 && base.payments.every((p) => p.onTime),
      stress: stressRows,
      holdsAll: !base.firstBreach && stressRows.every((s) => s.holds),
    });
  }
  const feasible = rows.filter((r) => r.feasible);
  const holding = feasible.filter((r) => r.holdsAll).sort((a, b) => a.totalHomeCost - b.totalHomeCost);
  const pick = holding[0] ?? [...feasible].sort((a, b) => b.lowestHeadroom - a.lowestHeadroom)[0];
  return {
    currency: fp.currency,
    reserveFloor: fp.reserveFloor,
    rows,
    pickId: pick?.id,
    pickReason: pick ? (holding[0] ? "cheapest_that_holds" : "most_headroom") : undefined,
  };
}
