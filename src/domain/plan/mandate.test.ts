import { describe, expect, it } from "vitest";
import { seedScenario } from "@/server/scenarios";
import type { Invoice, Payment, World } from "../types";
import { instalmentOf, instalmentProgress, obligationsFor } from "./cashflow";
import { mandateAllows, mandateTerms, type MandateProposal } from "./mandate";
import type { Arrangement, PlanMandate } from "./types";

const KGU = { accountName: "Kingsgate University", accountNumber: "GB29 TSBK 6016 1331 9268 19", swift: "TSBKGB2L" };

// The corrected statement, the university's confirmed three-instalment plan, and a mandate signed for it.
function world(now = "2026-11-20T02:00:00.000Z"): { w: World; m: PlanMandate } {
  const w = seedScenario("uk-year");
  w.now = now;
  const inv: Invoice = {
    id: "inv_2",
    caseId: "case_yr",
    institutionId: "kgu",
    kind: "fee_statement",
    number: "KGU-FEE-0002",
    currency: "GBP",
    lineItems: [{ id: "l1", description: "Tuition and accommodation, after scholarship", amount: 35700 }],
    total: 35700,
    amountDue: 35700,
    dueAt: "2026-12-01T12:00:00.000Z",
    issuedAt: "2026-11-03T00:00:00.000Z",
    documentId: "doc_s",
    patientRef: "KG2611392",
    status: "open",
  };
  w.invoices[inv.id] = inv;
  const arr: Arrangement = {
    id: "arr_3",
    caseId: "case_yr",
    institutionId: "kgu",
    invoiceId: "inv_2",
    kind: "published_plan",
    title: "Three-instalment plan",
    status: "accepted",
    instalments: [
      { amount: 14220, dueAt: "2026-12-01T12:00:00.000Z" },
      { amount: 10665, dueAt: "2027-02-01T12:00:00.000Z" },
      { amount: 10665, dueAt: "2027-04-01T12:00:00.000Z" },
    ],
    fee: 150,
    currency: "GBP",
    confirmationDocId: "doc_c",
    history: [],
  };
  w.arrangements = { [arr.id]: arr };
  const terms = mandateTerms(w, arr)!;
  const m: PlanMandate = { ...terms, id: "man_1", status: "active", history: [] };
  w.mandates = { [m.id]: m };
  return { w, m };
}

const pay = (over: Partial<MandateProposal> = {}): MandateProposal => ({ invoiceId: "inv_2", amount: 14370, route: "bank_transfer", payerId: "p_jianhua", beneficiary: KGU, ...over });

describe("plan mandate", () => {
  it("takes its terms from the confirmed plan: each remaining instalment, exactly", () => {
    const { m } = world();
    expect(m.windows.map((x) => x.amount)).toEqual([14370, 10665, 10665]);
    expect(m.totalCap).toBe(35700);
    expect(m.windows[0]).toMatchObject({ from: "2026-11-17T12:00:00.000Z", to: "2026-12-01T12:00:00.000Z" });
    expect(m.reserveFloor).toBe(48000);
    expect(m.payerId).toBe("p_jianhua");
  });

  it("has no terms for a plan the university hasn't confirmed", () => {
    const { w } = world();
    expect(mandateTerms(w, { ...w.arrangements!.arr_3, confirmationDocId: undefined })).toBeUndefined();
  });

  it("lets the instalment that is due go ahead", () => {
    const { w, m } = world();
    const r = mandateAllows(w, m, pay());
    expect(r.failed).toEqual([]);
    expect(r).toMatchObject({ ok: true, instalment: 1 });
  });

  it.each([
    ["a self-made amount", pay({ amount: 9000 }), "amount"],
    ["another account", pay({ beneficiary: { ...KGU, accountNumber: "GB11 FAKE 0000 0000 0000 00" } }), "beneficiary"],
    ["someone other than the payer", pay({ payerId: "p_yutong" }), "payer"],
    ["a card payment", pay({ route: "card_payment" }), "route"],
    ["the next instalment, before its window", pay({ amount: 10665 }), "window"],
  ])("refuses %s", (_name, proposal, id) => {
    const { w, m } = world();
    const r = mandateAllows(w, m, proposal);
    expect(r.ok).toBe(false);
    expect(r.failed.map((f) => f.id)).toContain(id);
  });

  it("refuses when the university changed the bill, the payer revoked it, or the emergency stop is on", () => {
    const a = world();
    a.w.invoices.inv_2.status = "superseded";
    expect(mandateAllows(a.w, a.m, pay()).failed.map((f) => f.id)).toContain("invoice_open");
    const b = world();
    expect(mandateAllows(b.w, { ...b.m, status: "revoked" }, pay()).failed.map((f) => f.id)).toContain("active");
    const c = world();
    c.w.agent.killSwitch = true;
    expect(mandateAllows(c.w, c.m, pay()).failed.map((f) => f.id)).toContain("kill_switch");
  });

  it("refuses when the institution's verified account has changed since signing", () => {
    const { w, m } = world();
    w.institutions.kgu = { ...w.institutions.kgu, bank: { ...w.institutions.kgu.bank, accountNumber: "GB00 NEWB 0000 0000 0000 00" } };
    expect(mandateAllows(w, m, pay()).failed.map((f) => f.id)).toContain("beneficiary");
  });

  it("refuses a payment that would take the payer below their safety net", () => {
    const { w, m } = world();
    w.funding!.case_yr = { ...w.funding!.case_yr, balances: [{ label: "Savings", amount: 60000 }] };
    expect(mandateAllows(w, m, pay()).failed.map((f) => f.id)).toContain("reserve");
  });

  it("tracks each instalment as paid or outstanding, the same way the planner counts what is owed", () => {
    const { w } = world();
    const arr = w.arrangements!.arr_3;
    w.payments.pay_a = { id: "pay_a", caseId: "case_yr", invoiceId: "inv_2", amount: 14370, currency: "GBP", route: "bank_transfer", payerId: "p_jianhua", status: "completed", createdAt: "2026-11-20T02:00:00.000Z", cost: { totalSource: 0 } } as Payment;
    w.payments.pay_b = { ...w.payments.pay_a, id: "pay_b", amount: 10665, status: "awaiting_approval", createdAt: "2027-01-25T02:00:00.000Z" };
    const progress = instalmentProgress(w, arr);
    expect(progress.map((x) => [x.amount, x.paid, x.outstanding])).toEqual([
      [14370, 14370, 0],
      [10665, 0, 10665],
      [10665, 0, 10665],
    ]);
    expect(progress[0].paymentIds).toEqual(["pay_a"]);
    expect(instalmentOf(w, arr, "pay_a")).toBe(1);
    expect(instalmentOf(w, arr, "pay_b")).toBe(2);
    const owed = obligationsFor(w, "case_yr").filter((o) => o.arrangementId === arr.id);
    expect(owed.map((o) => o.amount)).toEqual(progress.filter((x) => x.outstanding > 0).map((x) => x.outstanding));
  });

  it("never pays more than the total the payer approved", () => {
    const { w, m } = world();
    w.approvals.apr_1 = { id: "apr_1", caseId: "case_yr", paymentId: "pay_1", requestedAt: w.now, decision: "approved", method: "mandate", summary: "" };
    w.payments.pay_1 = { id: "pay_1", caseId: "case_yr", invoiceId: "inv_2", amount: 30000, currency: "GBP", route: "bank_transfer", payerId: "p_jianhua", status: "processing", approvalId: "apr_1", createdAt: w.now, cost: { totalSource: 0 } } as Payment;
    expect(mandateAllows(w, { ...m, totalCap: 35700 }, pay()).failed.map((f) => f.id)).toContain("total_cap");
  });
});
