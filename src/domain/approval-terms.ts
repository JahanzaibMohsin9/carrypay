// What the family approves when they approve a payment, beyond the payment itself: the version of the bill
// (or the plan instalment) it pays, the most it may cost them in their own currency, how long the quote
// holds, and the verified account it goes to. When they decide, these are checked again against the world as
// it is now. If any of them changed, only this approval is withdrawn; everything else on the case stays valid.
// Pure: used by the server when approving and by the app to show the terms.
import { obligationsFor } from "./plan/cashflow";
import { priceRoute } from "./rules/engine";
import type { ApprovalTerms, CostBreakdown, Payment, World } from "./types";

/** How long a quote holds once the family has seen it. After that the bank prices the transfer again. */
export const QUOTE_HOLD_HOURS = 24;

export interface TermsChange {
  id: "invoice_replaced" | "invoice_closed" | "invoice_changed" | "instalment_changed" | "account_changed" | "cost_above_limit" | "more_than_outstanding";
  message: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const addHours = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();

/** The world without this payment, so the plan's instalments read as they would if it had never been proposed. */
const without = (w: World, paymentId: string): World => ({ ...w, payments: Object.fromEntries(Object.entries(w.payments).filter(([id]) => id !== paymentId)) });

/** The terms for a payment that is about to be put to the family. */
export function approvalTerms(w: World, payment: Payment): ApprovalTerms {
  const inv = w.invoices[payment.invoiceId];
  const instalment = obligationsFor(without(w, payment.id), payment.caseId).find(
    (o) => o.invoiceId === inv.id && o.source === "arrangement" && Math.abs(o.amount - payment.amount) <= 0.5,
  );
  return {
    invoice: { id: inv.id, number: inv.number, total: inv.total, amountDue: inv.amountDue, dueAt: inv.dueAt },
    ...(instalment ? { instalment: { arrangementId: instalment.arrangementId!, number: instalment.instalment!, amount: instalment.amount, dueAt: instalment.dueAt } } : {}),
    // the most it may cost: the quote the family saw, rounded up to a whole unit of their currency
    maxCost: { currency: payment.cost.sourceCurrency, amount: Math.ceil(payment.cost.totalSource) },
    quotedAt: w.now,
    quoteHeldUntil: addHours(w.now, QUOTE_HOLD_HOURS),
    beneficiary: { accountName: payment.beneficiary.accountName, accountNumber: payment.beneficiary.accountNumber, swift: payment.beneficiary.swift },
  };
}

export interface TermsCheck {
  changes: TermsChange[];
  /** the price now: the held quote while it holds, a new quote after that */
  cost: CostBreakdown;
  requoted: boolean;
}

/** Checks an approval's terms against the world as it is now. No changes: the approval can go ahead. */
export function checkTerms(w: World, payment: Payment, terms: ApprovalTerms): TermsCheck {
  const changes: TermsChange[] = [];
  const inv = w.invoices[payment.invoiceId];
  const inst = w.institutions[payment.institutionId];
  const t = terms.invoice;

  if (!inv) changes.push({ id: "invoice_closed", message: `Statement ${t.number} is no longer on the case.` });
  else if (inv.status === "superseded") {
    const next = inv.supersededBy ? w.invoices[inv.supersededBy] : undefined;
    changes.push({ id: "invoice_replaced", message: `${inst.name} replaced statement ${t.number}${next ? ` with ${next.number} (${next.currency} ${fmt(next.amountDue)})` : ""}.` });
  } else if (inv.status !== "open") changes.push({ id: "invoice_closed", message: `Statement ${t.number} is now ${inv.status}.` });
  else if (terms.instalment) {
    // a plan instalment: what matters is that instalment, not the rest of the bill (a later instalment can change on its own)
    const ins = terms.instalment;
    const now = obligationsFor(without(w, payment.id), payment.caseId).find((o) => o.arrangementId === ins.arrangementId && o.instalment === ins.number);
    if (!now) changes.push({ id: "instalment_changed", message: `Instalment ${ins.number} of the plan is no longer open.` });
    else if (Math.abs(now.amount - ins.amount) > 0.005 || now.dueAt !== ins.dueAt)
      changes.push({
        id: "instalment_changed",
        message: `Instalment ${ins.number} changed: ${payment.currency} ${fmt(ins.amount)} due ${ins.dueAt.slice(0, 10)} became ${now.currency} ${fmt(now.amount)} due ${now.dueAt.slice(0, 10)}.`,
      });
  } else if (Math.abs(inv.total - t.total) > 0.005 || Math.abs(inv.amountDue - t.amountDue) > 0.005 || inv.dueAt !== t.dueAt) {
    const parts = [
      Math.abs(inv.amountDue - t.amountDue) > 0.005 ? `the amount requested went from ${inv.currency} ${fmt(t.amountDue)} to ${inv.currency} ${fmt(inv.amountDue)}` : "",
      Math.abs(inv.total - t.total) > 0.005 && Math.abs(inv.amountDue - t.amountDue) <= 0.005 ? `the total went from ${inv.currency} ${fmt(t.total)} to ${inv.currency} ${fmt(inv.total)}` : "",
      inv.dueAt !== t.dueAt ? `the due date changed` : "",
    ].filter(Boolean);
    changes.push({ id: "invoice_changed", message: `Statement ${t.number} changed: ${parts.join(", ")}.` });
  }

  // only worth saying when the bill itself didn't change (a lower bill already explains it)
  if (inv && inv.status === "open" && !changes.length) {
    const others = Object.values(w.payments).filter(
      (p) => p.id !== payment.id && p.invoiceId === inv.id && ["approved", "submitted", "processing", "completed"].includes(p.status),
    );
    const left = r2(inv.amountDue - others.reduce((s, p) => s + p.amount, 0));
    if (payment.amount > left + 0.5) changes.push({ id: "more_than_outstanding", message: `Only ${inv.currency} ${fmt(Math.max(0, left))} is still outstanding on ${inv.number}.` });
  }

  const b = inst.bank;
  if (b.accountNumber !== terms.beneficiary.accountNumber || b.swift !== terms.beneficiary.swift || b.accountName !== terms.beneficiary.accountName)
    changes.push({ id: "account_changed", message: `${inst.name}'s verified bank account is no longer the one you approved.` });

  // the quote holds until quoteHeldUntil; after that the transfer is priced again and must stay within the limit
  let cost = payment.cost;
  let requoted = false;
  if (w.now > terms.quoteHeldUntil) {
    const c = w.cases[payment.caseId];
    const fresh = priceRoute({ corridor: c.corridor, route: payment.route, deliverAmount: payment.amount, institution: inst, simDate: w.now, fxShocks: w.fxShocks });
    if (fresh) {
      cost = fresh;
      requoted = true;
      if (fresh.totalSource > terms.maxCost.amount + 0.005)
        changes.push({
          id: "cost_above_limit",
          message: `The quote you saw expired and the new one is ${fresh.sourceCurrency} ${fmt(Math.ceil(fresh.totalSource))}, above the ${terms.maxCost.currency} ${fmt(terms.maxCost.amount)} you approved.`,
        });
    }
  }
  return { changes, cost, requoted };
}
