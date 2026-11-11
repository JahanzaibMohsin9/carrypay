// Plan mandate: one signed approval for the instalments of a plan the institution confirmed. Its terms are
// derived here from that plan, never written by the model, and every payment under it is checked against
// them. Anything outside the terms pauses the mandate and goes back to a normal approval.
import { stableStringify } from "@/lib/canonical";
import { evaluateRoute } from "../rules/engine";
import type { Route, World } from "../types";
import { obligationsFor, projectCashflow, type Projection } from "./cashflow";
import type { Arrangement, PlanMandate } from "./types";

const DAY = 86_400_000;
/** a payment under the mandate may leave from two weeks before an instalment is due until its due date */
export const WINDOW_DAYS = 14;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export type MandateTerms = Pick<PlanMandate, "caseId" | "arrangementId" | "payerId" | "institutionId" | "beneficiary" | "currency" | "perInstalmentCap" | "totalCap" | "windows" | "reserveFloor">;

/** The terms a mandate for this confirmed plan would carry: the remaining instalments, exactly. */
export function mandateTerms(world: World, arrangement: Arrangement): MandateTerms | undefined {
  if (arrangement.status !== "accepted" || !arrangement.confirmationDocId) return undefined;
  const profile = world.funding?.[arrangement.caseId];
  if (!profile) return undefined;
  const inst = world.institutions[arrangement.institutionId];
  const remaining = obligationsFor(world, arrangement.caseId).filter((o) => o.arrangementId === arrangement.id);
  if (!remaining.length) return undefined;
  const windows = remaining.map((o) => ({ instalment: o.instalment!, from: new Date(Date.parse(o.dueAt) - WINDOW_DAYS * DAY).toISOString(), to: o.dueAt, amount: o.amount }));
  return {
    caseId: arrangement.caseId,
    arrangementId: arrangement.id,
    payerId: profile.ownerPersonId,
    institutionId: inst.id,
    beneficiary: { accountName: inst.bank.accountName, accountNumber: inst.bank.accountNumber, swift: inst.bank.swift, bankName: inst.bank.bankName },
    currency: arrangement.currency,
    perInstalmentCap: Math.max(...windows.map((x) => x.amount)),
    totalCap: Math.round(windows.reduce((s, x) => s + x.amount, 0) * 100) / 100,
    windows,
    reserveFloor: profile.reserveFloor,
  };
}

/** What the payer's passkey signs: the canonical terms (the server hashes it with a fresh nonce). */
export function mandateCanonical(t: MandateTerms): string {
  return stableStringify({ ...t, windows: t.windows.map((x) => ({ ...x })) });
}

export interface MandateProposal {
  invoiceId: string;
  amount: number;
  route: Route;
  payerId: string;
  beneficiary: { accountName: string; accountNumber: string; swift: string };
}

export interface MandateCheck {
  ok: boolean;
  /** the window this payment fills, if any */
  instalment?: number;
  passed: string[];
  failed: { id: string; message: string }[];
}

/**
 * The mandate's reserve check: the payer's projected balance through every remaining payment, against the
 * safety net in the signed terms. A breach means the next payment under the mandate pauses and asks the payer.
 */
export function mandateReserve(world: World, m: PlanMandate): Projection | undefined {
  const profile = world.funding?.[m.caseId];
  return profile ? projectCashflow(world, m.caseId, { profile: { ...profile, reserveFloor: m.reserveFloor } }) : undefined;
}

/** May this payment go ahead under the mandate, without asking the payer again? */
export function mandateAllows(world: World, m: PlanMandate, p: MandateProposal): MandateCheck {
  const passed: string[] = [];
  const failed: MandateCheck["failed"] = [];
  const check = (id: string, ok: boolean, message: string) => (ok ? passed.push(id) : failed.push({ id, message }));
  const arr = world.arrangements?.[m.arrangementId];
  const inst = world.institutions[m.institutionId];
  const now = world.now;

  check("active", m.status === "active", `The mandate is ${m.status}.`);
  check("kill_switch", !world.agent.killSwitch, "The emergency stop is on.");
  check("plan_in_force", !!arr && arr.status === "accepted" && !!arr.confirmationDocId && arr.invoiceId === p.invoiceId, "The payment isn't for the bill of the confirmed plan, or the plan is no longer in force.");
  check("invoice_open", world.invoices[p.invoiceId]?.status === "open", "The bill has changed or been replaced since the mandate was signed.");
  check("payer", p.payerId === m.payerId, "Only the payer who signed the mandate can pay under it.");
  const acct = (b: { accountName: string; accountNumber: string; swift: string }) => [b.accountName, b.accountNumber, b.swift].map(norm).join("|");
  check("beneficiary", acct(p.beneficiary) === acct(m.beneficiary) && acct(m.beneficiary) === acct(inst.bank), "The account differs from the one in the mandate, or the institution's verified account has changed.");
  check("route", p.route === "bank_transfer", "Only bank transfers straight to the institution are covered.");
  // the amount must be exactly one remaining instalment, inside its window
  const window = m.windows.find((x) => Math.abs(x.amount - p.amount) <= 0.5 && now >= x.from && now <= x.to);
  const anyAmount = m.windows.some((x) => Math.abs(x.amount - p.amount) <= 0.5);
  check("amount", anyAmount, `${m.currency} ${p.amount} is not one of the instalments the payer approved.`);
  check("window", !!window, "It is outside the payment window the payer approved for this instalment.");
  const due = arr ? obligationsFor(world, m.caseId).filter((o) => o.arrangementId === arr.id) : [];
  check("still_owed", !!window && due.some((o) => o.instalment === window.instalment && Math.abs(o.amount - p.amount) <= 0.5), "That instalment is not owed any more, or its amount has changed.");
  const spent = Object.values(world.payments)
    .filter((x) => x.caseId === m.caseId && x.approvalId && world.approvals[x.approvalId]?.method === "mandate" && !["cancelled", "rejected", "returned"].includes(x.status))
    .reduce((s, x) => s + x.amount, 0);
  check("total_cap", spent + p.amount <= m.totalCap + 0.5, `It would take payments under the mandate above ${m.currency} ${m.totalCap}.`);
  // the payer's safety net, from their own figures, with this payment and everything after it
  const proj = mandateReserve(world, m);
  check("reserve", !!proj && !proj.firstBreach, proj?.firstBreach ? `It would take the payer below their safety net on ${proj.firstBreach.at.slice(0, 10)}.` : "The payer's figures are missing.");
  const c = world.cases[m.caseId];
  const ev = evaluateRoute({ world, caseFile: c, payer: c.people.find((x) => x.id === p.payerId), route: p.route, amount: p.amount, currency: m.currency, invoiceId: p.invoiceId });
  check("rules", ev.allowed, ev.blockers.map((b) => b.message).join(" ") || "Blocked by the rules engine.");
  return { ok: failed.length === 0, instalment: window?.instalment, passed, failed };
}
