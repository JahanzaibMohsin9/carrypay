// Bill review against the family's own evidence: is the amount right under what they were promised?
// Deterministic: it compares the structured fields of award letters with the lines of the current fee
// statement. A finding is only ever "potential"; the institution's corrected statement confirms it, and only
// money actually credited counts as saved.
import type { Currency, Doc, Invoice, World } from "../types";

export interface EntitlementFinding {
  invoiceId: string;
  invoiceNumber: string;
  basisDocId: string;
  basisTitle: string;
  award: string;
  /** reduction the evidence supports, in the invoice currency */
  amount: number;
  currency: Currency;
  /** who the evidence came from: a copy from the family still has to be confirmed by the institution */
  evidenceOrigin: Doc["origin"];
  status: "missing" | "applied" | "not_applicable";
  reason: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Fee statements still in force for the case (not replaced, not paid). */
export function currentStatements(world: World, caseId: string): Invoice[] {
  return Object.values(world.invoices).filter((i) => i.caseId === caseId && i.kind === "fee_statement" && (i.status === "open" || i.status === "disputed"));
}

export function reviewEntitlements(world: World, caseId: string): EntitlementFinding[] {
  const awards = Object.values(world.docs).filter((d) => d.caseId === caseId && d.kind === "scholarship_award");
  const findings: EntitlementFinding[] = [];
  for (const inv of currentStatements(world, caseId)) {
    for (const doc of awards) {
      const award = String(doc.fields.award ?? doc.title);
      const amount = Number(doc.fields.amount);
      const base = { invoiceId: inv.id, invoiceNumber: inv.number, basisDocId: doc.id, basisTitle: doc.title, award, currency: inv.currency, evidenceOrigin: doc.origin };
      const studentId = String(doc.fields.studentId ?? "");
      if (!Number.isFinite(amount) || amount <= 0) {
        findings.push({ ...base, amount: 0, status: "not_applicable", reason: "The letter states no amount CarryPay can check." });
        continue;
      }
      if (inv.patientRef && studentId && inv.patientRef !== studentId) {
        findings.push({ ...base, amount: 0, status: "not_applicable", reason: `The award is for student ${studentId}, the statement for ${inv.patientRef}.` });
        continue;
      }
      if (doc.fields.currency && doc.fields.currency !== inv.currency) {
        findings.push({ ...base, amount: 0, status: "not_applicable", reason: `The award is in ${doc.fields.currency}, the statement in ${inv.currency}.` });
        continue;
      }
      const credit = inv.lineItems.find((li) => li.amount < 0 && (li.description.toLowerCase().includes(award.toLowerCase()) || r2(-li.amount) === r2(amount)));
      if (credit) {
        findings.push({ ...base, amount: r2(-credit.amount), status: "applied", reason: `Already on the statement: "${credit.description}".` });
        continue;
      }
      const appliesTo = String(doc.fields.appliesTo ?? "tuition").toLowerCase();
      const target = inv.lineItems.find((li) => li.amount > 0 && li.description.toLowerCase().includes(appliesTo));
      if (!target) {
        findings.push({ ...base, amount: 0, status: "not_applicable", reason: `The statement has no ${appliesTo} line for the award to reduce.` });
        continue;
      }
      findings.push({
        ...base,
        amount: r2(Math.min(amount, target.amount)),
        status: "missing",
        reason: `The letter awards ${inv.currency} ${amount.toFixed(2)} off ${appliesTo}, but statement ${inv.number} charges the full "${target.description}" with no matching reduction.`,
      });
    }
  }
  // deposits already paid (a receipt the family holds) that the statement doesn't credit
  const deposits = Object.values(world.docs).filter((d) => d.caseId === caseId && d.kind === "deposit_receipt");
  for (const inv of currentStatements(world, caseId)) {
    for (const doc of deposits) {
      const amount = Number(doc.fields.amount);
      const paidAt = String(doc.fields.paidAt ?? "").slice(0, 10);
      const reference = String(doc.fields.reference ?? "");
      const label = `Deposit paid${paidAt ? ` on ${paidAt}` : ""}${reference ? ` (${reference})` : ""}`;
      const base = { invoiceId: inv.id, invoiceNumber: inv.number, basisDocId: doc.id, basisTitle: doc.title, award: label, currency: inv.currency, evidenceOrigin: doc.origin };
      const studentId = String(doc.fields.studentId ?? "");
      if (!Number.isFinite(amount) || amount <= 0) {
        findings.push({ ...base, amount: 0, status: "not_applicable", reason: "The receipt states no amount CarryPay can check." });
        continue;
      }
      if (inv.patientRef && studentId && inv.patientRef !== studentId) {
        findings.push({ ...base, amount: 0, status: "not_applicable", reason: `The receipt is for student ${studentId}, the statement for ${inv.patientRef}.` });
        continue;
      }
      if (doc.fields.currency && doc.fields.currency !== inv.currency) {
        findings.push({ ...base, amount: 0, status: "not_applicable", reason: `The receipt is in ${doc.fields.currency}, the statement in ${inv.currency}.` });
        continue;
      }
      const credit = inv.lineItems.find((li) => li.amount < 0 && /deposit/i.test(li.description) && r2(-li.amount) === r2(amount));
      if (credit) {
        findings.push({ ...base, amount: r2(amount), status: "applied", reason: `Already on the statement: "${credit.description}".` });
        continue;
      }
      findings.push({
        ...base,
        amount: r2(Math.min(amount, inv.total)),
        status: "missing",
        reason: `The receipt shows ${inv.currency} ${amount.toFixed(2)} already paid as a deposit, but statement ${inv.number} doesn't credit it.`,
      });
    }
  }
  return findings;
}

/** Totals by state. They are reported side by side and never added together. */
export function adjustmentTotals(world: World, caseId: string) {
  const t = { potential: 0, requested: 0, confirmed: 0, credited: 0, rejected: 0 };
  for (const a of Object.values(world.adjustments ?? {})) if (a.caseId === caseId) t[a.status] = r2(t[a.status] + a.amount);
  return t;
}
