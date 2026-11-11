import { describe, expect, it } from "vitest";
import { seedScenario } from "@/server/scenarios";
import type { Invoice, World } from "../types";
import { adjustmentTotals, reviewEntitlements } from "./entitlements";

function withStatement(lines: { description: string; amount: number }[], over: Partial<Invoice> = {}): World {
  const w = seedScenario("uk-year");
  const inv: Invoice = {
    id: "inv_1",
    caseId: "case_yr",
    institutionId: "kgu",
    kind: "fee_statement",
    number: "KGU-FEE-0001",
    currency: "GBP",
    lineItems: lines.map((l, i) => ({ ...l, id: `l${i}` })),
    total: lines.reduce((s, l) => s + l.amount, 0),
    amountDue: lines.reduce((s, l) => s + l.amount, 0),
    issuedAt: w.now,
    documentId: "doc_x",
    patientRef: "KG2611392",
    status: "open",
    ...over,
  };
  w.invoices[inv.id] = inv;
  return w;
}

const TUITION = { description: "Tuition fee 2026/27, MSc Finance (full year)", amount: 29750 };
const HALLS = { description: "University accommodation, Jan-Jun 2027", amount: 9800 };

describe("bill review against the family's evidence", () => {
  it("finds a scholarship missing from the fee statement, citing the award letter", () => {
    const [f] = reviewEntitlements(withStatement([TUITION, HALLS]), "case_yr");
    expect(f).toMatchObject({ status: "missing", amount: 4000, currency: "GBP", basisDocId: "doc_1", invoiceNumber: "KGU-FEE-0001" });
    // a copy the student uploaded: the university still has to confirm it
    expect(f.evidenceOrigin).toBe("family");
  });

  it("recognises an award that is already applied", () => {
    const [f] = reviewEntitlements(withStatement([TUITION, HALLS, { description: "Kingsgate Global Excellence Scholarship 2026/27", amount: -4000 }]), "case_yr");
    expect(f.status).toBe("applied");
  });

  it("never claims more than the line it reduces", () => {
    const [f] = reviewEntitlements(withStatement([{ description: "Tuition fee, top-up module", amount: 2500 }, HALLS]), "case_yr");
    expect(f).toMatchObject({ status: "missing", amount: 2500 });
  });

  it("doesn't apply an award to another student's statement or to a statement without the line", () => {
    expect(reviewEntitlements(withStatement([TUITION], { patientRef: "KG2601847" }), "case_yr")[0].status).toBe("not_applicable");
    expect(reviewEntitlements(withStatement([HALLS]), "case_yr")[0].status).toBe("not_applicable");
  });

  it("ignores statements that were replaced", () => {
    expect(reviewEntitlements(withStatement([TUITION], { status: "superseded" }), "case_yr")).toHaveLength(0);
  });

  it("keeps potential, confirmed and credited money apart", () => {
    const w = withStatement([TUITION]);
    const base = { caseId: "case_yr", invoiceId: "inv_1", currency: "GBP" as const, basisDocId: "doc_1", reason: "", history: [] };
    w.adjustments = {
      a1: { ...base, id: "a1", amount: 4000, status: "confirmed" },
      a2: { ...base, id: "a2", amount: 300, status: "potential" },
    };
    expect(adjustmentTotals(w, "case_yr")).toMatchObject({ potential: 300, confirmed: 4000, credited: 0 });
  });
});
