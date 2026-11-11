import { describe, expect, it } from "vitest";
import { seedScenario } from "@/server/scenarios";
import type { Invoice, Payment, World } from "../types";
import { computeUsage, priceRoute } from "../rules/engine";
import { addMonths, compareSchedules, obligationsFor, projectCashflow } from "./cashflow";
import type { Arrangement, FundingProfile } from "./types";

// A China → UK tuition case: 2 Nov 2026, the parent has already bought USD 31,000 of FX this year.
function tuitionWorld(): World {
  const w = seedScenario("uk-tuition");
  const inv: Invoice = {
    id: "inv_1",
    caseId: "case_uk",
    institutionId: "kgu",
    kind: "fee_statement",
    number: "KGU-FS-1",
    currency: "GBP",
    lineItems: [
      { id: "l1", description: "Tuition 2026/27", amount: 14875 },
      { id: "l2", description: "Accommodation Jan-Jun 2027", amount: 9800 },
    ],
    total: 24675,
    amountDue: 24675,
    dueAt: "2026-12-01T12:00:00.000Z",
    issuedAt: w.now,
    documentId: "doc_x",
    status: "open",
  };
  w.invoices[inv.id] = inv;
  w.funding = { case_uk: profile() };
  return w;
}

function profile(over: Partial<FundingProfile> = {}): FundingProfile {
  return {
    caseId: "case_uk",
    ownerPersonId: "p_linwei",
    currency: "CNY",
    balances: [{ label: "Savings", amount: 220000 }],
    income: [{ label: "Salary", amount: 28000, firstAt: "2026-11-10T02:00:00.000Z", everyMonths: 1 }],
    essentialsMonthly: 12000,
    reserveFloor: 36000,
    conditional: [],
    enteredBy: "p_linwei",
    updatedAt: "2026-11-02T01:00:00.000Z",
    ...over,
  };
}

function threeInstalments(over: Partial<Arrangement> = {}): Arrangement {
  return {
    id: "arr_1",
    caseId: "case_uk",
    institutionId: "kgu",
    invoiceId: "inv_1",
    kind: "published_plan",
    title: "Three-instalment plan",
    status: "offered",
    instalments: [
      { amount: 8225, dueAt: "2026-12-01T12:00:00.000Z" },
      { amount: 8225, dueAt: "2027-02-01T12:00:00.000Z" },
      { amount: 8225, dueAt: "2027-04-01T12:00:00.000Z" },
    ],
    fee: 150,
    currency: "GBP",
    history: [],
    ...over,
  };
}

describe("dates", () => {
  it("adds months on the same day, clamped to the end of shorter months", () => {
    expect(addMonths("2026-01-31T10:00:00.000Z", 1)).toBe("2026-02-28T10:00:00.000Z");
    expect(addMonths("2026-11-10T02:00:00.000Z", 2)).toBe("2027-01-10T02:00:00.000Z");
  });
});

describe("FX quota across the new year", () => {
  it("counts FX bought before the case only in the year the case opened", () => {
    const w = tuitionWorld();
    expect(computeUsage(w, "case_uk").fxYearUSD.p_linwei).toBe(31000);
    expect(computeUsage({ ...w, now: "2027-01-05T00:00:00.000Z" }, "case_uk").fxYearUSD.p_linwei ?? 0).toBe(0);
  });
});

describe("obligations", () => {
  it("are the invoice as issued until an arrangement is accepted and confirmed by the institution", () => {
    const w = tuitionWorld();
    expect(obligationsFor(w, "case_uk").map((o) => o.amount)).toEqual([24675]);
    // accepted by the family but not yet confirmed by the university: the deadline hasn't moved
    w.arrangements = { arr_1: threeInstalments({ status: "accepted" }) };
    expect(obligationsFor(w, "case_uk").map((o) => o.amount)).toEqual([24675]);
    w.arrangements.arr_1.confirmationDocId = "doc_confirm";
    const obs = obligationsFor(w, "case_uk");
    expect(obs.map((o) => o.amount)).toEqual([8375, 8225, 8225]);
    expect(obs[0].fee).toBe(150);
    expect(obligationsFor(w, "case_uk", "upfront").map((o) => o.amount)).toEqual([24675]);
  });

  it("apply money already sent to the earliest instalments", () => {
    const w = tuitionWorld();
    w.arrangements = { arr_1: threeInstalments({ status: "accepted", confirmationDocId: "doc_c" }) };
    w.payments.pay_1 = { id: "pay_1", caseId: "case_uk", invoiceId: "inv_1", amount: 8375, status: "completed" } as Payment;
    w.payments.pay_2 = { id: "pay_2", caseId: "case_uk", invoiceId: "inv_1", amount: 1000, status: "awaiting_approval" } as Payment;
    expect(obligationsFor(w, "case_uk").map((o) => o.amount)).toEqual([8225, 8225]);
  });
});

describe("cash-flow projection", () => {
  it("is undefined until the family has entered their figures", () => {
    const w = tuitionWorld();
    delete w.funding;
    expect(projectCashflow(w, "case_uk")).toBeUndefined();
  });

  it("prices every payment with the rules engine at today's rate", () => {
    const w = tuitionWorld();
    const p = projectCashflow(w, "case_uk")!;
    const engine = priceRoute({ corridor: "CN-GB", route: "bank_transfer", deliverAmount: 24675, institution: w.institutions.kgu, simDate: w.now })!;
    expect(p.payments).toHaveLength(1);
    expect(p.payments[0].homeCost).toBe(engine.totalSource);
    expect(p.totalHomeCost).toBe(engine.totalSource);
    // leaves early enough to arrive a day before it is due
    expect(p.payments[0].payAt).toBe("2026-11-28T12:00:00.000Z");
    expect(p.payments[0].onTime).toBe(true);
  });

  it("finds the first time paying upfront takes the family below their reserve", () => {
    const w = tuitionWorld();
    const p = projectCashflow(w, "case_uk")!;
    expect(p.firstBreach).toBeDefined();
    expect(p.firstBreach!.at).toBe("2026-11-28T12:00:00.000Z");
    expect(p.firstBreach!.cause).toBe("KGU-FS-1");
    const before = 220000 + 28000; // savings + November salary
    expect(p.firstBreach!.balance).toBeCloseTo(before - p.payments[0].homeCost, 2);
    expect(p.firstBreach!.shortBy).toBeCloseTo(36000 - p.firstBreach!.balance, 2);
  });

  it("keeps the reserve with the institution's three-instalment plan", () => {
    const w = tuitionWorld();
    const p = projectCashflow(w, "case_uk", { schedule: threeInstalments() })!;
    expect(p.payments).toHaveLength(3);
    expect(p.firstBreach).toBeUndefined();
    expect(p.lowest.headroom).toBeGreaterThan(0);
  });

  it("knows which year's FX quota each instalment uses and which documents the bank will need", () => {
    const w = tuitionWorld();
    // paying in full: USD 31,000 already used this year plus about USD 33,000 goes above the USD 50,000 quota,
    // which tuition may do with proof of the real expense
    const [full] = projectCashflow(w, "case_uk", { schedule: "upfront" })!.payments;
    expect(full.evaluation.warnings.map((x) => x.ruleId)).toContain("CN.FX.ABOVE_QUOTA_CURRENT");
    expect(full.evaluation.requiredDocs.map((d) => d.kind)).toContain("admission_letter");
    expect(full.evaluation.allowed).toBe(true);

    const [dec, feb, apr] = projectCashflow(w, "case_uk", { schedule: threeInstalments() })!.payments;
    expect([dec.quotaYear, feb.quotaYear, apr.quotaYear]).toEqual([2026, 2027, 2027]);
    // December: the first instalment fits in what is left of this year's quota
    const decQuota = dec.evaluation.limits.find((l) => l.ruleId === "CN.FX.ANNUAL_QUOTA")!;
    expect(decQuota.usedUSD).toBe(31000);
    expect(decQuota.afterUSD).toBeLessThan(50000);
    expect(dec.evaluation.warnings.map((x) => x.ruleId)).not.toContain("CN.FX.ABOVE_QUOTA_CURRENT");
    // every purchase still needs the signed purpose declaration
    expect(dec.evaluation.requiredDocs.map((d) => d.kind)).toContain("fx_purchase_application");
    // February: the quota reset on 1 January
    const febQuota = feb.evaluation.limits.find((l) => l.ruleId === "CN.FX.ANNUAL_QUOTA")!;
    expect(febQuota.usedUSD).toBe(0);
    expect(feb.evaluation.warnings.map((x) => x.ruleId)).not.toContain("CN.FX.ABOVE_QUOTA_CURRENT");
    // April: February's instalment already counts against the 2027 quota
    const aprQuota = apr.evaluation.limits.find((l) => l.ruleId === "CN.FX.ANNUAL_QUOTA")!;
    expect(aprQuota.usedUSD).toBeCloseTo(febQuota.afterUSD, 2);
  });

  it("doesn't count a payment awaiting approval against the quota twice", () => {
    const w = tuitionWorld();
    const before = projectCashflow(w, "case_uk")!.payments[0].evaluation.limits[0].afterUSD;
    w.payments.pay_1 = { id: "pay_1", caseId: "case_uk", invoiceId: "inv_1", amount: 24675, currency: "GBP", route: "bank_transfer", payerId: "p_linwei", status: "awaiting_approval", createdAt: w.now } as Payment;
    expect(projectCashflow(w, "case_uk")!.payments[0].evaluation.limits[0].afterUSD).toBeCloseTo(before, 2);
  });

  it("counts money sent since the figures were entered once, not twice", () => {
    const w = tuitionWorld();
    w.arrangements = { arr_1: threeInstalments({ status: "accepted", confirmationDocId: "doc_c" }) };
    const before = projectCashflow(w, "case_uk")!;
    // the first instalment left on 28 Nov; it is now 5 Dec and the family hasn't re-entered their figures
    w.payments.pay_1 = { id: "pay_1", caseId: "case_uk", invoiceId: "inv_1", amount: 8375, currency: "GBP", route: "bank_transfer", payerId: "p_linwei", status: "completed", createdAt: before.payments[0].payAt, cost: before.payments[0].cost } as Payment;
    w.now = "2026-12-05T00:00:00.000Z";
    const after = projectCashflow(w, "case_uk")!;
    expect(after.payments).toHaveLength(2);
    expect(after.points.some((p) => p.label === "Paid: KGU-FS-1")).toBe(true);
    // the same money either way (later payments are re-priced at today's rate, within a fraction of a percent)
    expect(Math.abs(after.endBalance - before.endBalance)).toBeLessThan(before.totalHomeCost * 0.01);
    // the reserve is judged from today on
    expect(after.lowest.at >= w.now).toBe(true);
  });

  it("applies explicit stress tests, not forecasts", () => {
    const w = tuitionWorld();
    const base = projectCashflow(w, "case_uk", { schedule: threeInstalments() })!;
    const fx = projectCashflow(w, "case_uk", { schedule: threeInstalments(), stress: { fxShockPct: 0.05 } })!;
    expect(fx.totalHomeCost).toBeCloseTo(base.totalHomeCost * 1.05, 0);
    const late = projectCashflow(w, "case_uk", { schedule: threeInstalments(), stress: { incomeDelayDays: 21 } })!;
    const firstSalary = late.points.find((x) => x.kind === "income")!;
    expect(firstSalary.at).toBe("2026-12-01T02:00:00.000Z");
    expect(late.assumptions.map((a) => a.id)).toContain("stress");
  });

  it("counts money that is only expected only when asked to", () => {
    const w = tuitionWorld();
    w.funding!.case_uk = profile({ conditional: [{ label: "Employer education grant", amount: 50000, expectedAt: "2026-11-20T00:00:00.000Z", status: "expected" }] });
    expect(projectCashflow(w, "case_uk")!.points.some((x) => x.kind === "conditional")).toBe(false);
    const counted = projectCashflow(w, "case_uk", { stress: { countExpectedConditional: true } })!;
    expect(counted.points.some((x) => x.kind === "conditional")).toBe(true);
    expect(counted.firstBreach).toBeUndefined();
  });
});

describe("comparing schedules", () => {
  it("picks the cheapest option that keeps the reserve under every stress test", () => {
    const w = tuitionWorld();
    const two: Arrangement = {
      ...threeInstalments(),
      id: "arr_2",
      title: "Two-instalment plan",
      instalments: [
        { amount: 12337.5, dueAt: "2026-12-01T12:00:00.000Z" },
        { amount: 12337.5, dueAt: "2027-03-01T12:00:00.000Z" },
      ],
      fee: 0,
    };
    const c = compareSchedules(w, "case_uk", [
      { id: "upfront", label: "Pay in full", schedule: "upfront" },
      { id: "two", label: "Two instalments", schedule: two },
      { id: "three", label: "Three instalments", schedule: threeInstalments() },
    ])!;
    const row = (id: string) => c.rows.find((r) => r.id === id)!;
    expect(row("upfront").firstBreach).toBeDefined();
    expect(row("upfront").holdsAll).toBe(false);
    expect(row("three").holdsAll).toBe(true);
    expect(row("three").feesHomeCost).toBeGreaterThan(0);
    expect(row("upfront").feesHomeCost).toBe(0);
    // the pick is whichever holds and costs least; it never holds less than the alternatives
    const holding = c.rows.filter((r) => r.holdsAll);
    expect(c.pickReason).toBe("cheapest_that_holds");
    expect(row(c.pickId!).totalHomeCost).toBe(Math.min(...holding.map((r) => r.totalHomeCost)));
  });

  it("falls back to the option with the most headroom when nothing holds", () => {
    const w = tuitionWorld();
    w.funding!.case_uk = profile({ balances: [{ label: "Savings", amount: 60000 }] });
    const c = compareSchedules(w, "case_uk", [
      { id: "upfront", label: "Pay in full", schedule: "upfront" },
      { id: "three", label: "Three instalments", schedule: threeInstalments() },
    ])!;
    expect(c.rows.every((r) => !r.holdsAll)).toBe(true);
    expect(c.pickReason).toBe("most_headroom");
    expect(c.pickId).toBe("three");
  });
});
