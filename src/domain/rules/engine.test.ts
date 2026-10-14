import { describe, expect, it } from "vitest";
import { seedScenario } from "@/server/scenarios";
import { INSTITUTIONS } from "@/domain/institutions";
import type { Payment, World } from "@/domain/types";
import { compareRoutes, evaluateRoute, findRule, priceRoute, rateInForce } from "./engine";

function world(id = "th-medical"): World {
  return seedScenario(id);
}

describe("tax history", () => {
  const rule = findRule("PK-TH", "PK.CARD.ADVANCE_TAX");
  it("uses 5% before the 2026 budget and 0.5% after", () => {
    expect(rateInForce(rule, "2026-06-30T10:00:00Z")?.rate).toBe(0.05);
    expect(rateInForce(rule, "2026-07-01T00:00:00Z")?.rate).toBe(0.005);
    expect(rateInForce(rule, "2026-11-02T00:00:00Z")?.rate).toBe(0.005);
  });
});

describe("route pricing", () => {
  it("bank transfer is cheaper than card, card is cheaper than ATM for a large deposit", () => {
    const w = world();
    const opts = { corridor: "PK-TH" as const, deliverAmount: 250000, institution: INSTITUTIONS.srh, simDate: w.now };
    const bank = priceRoute({ ...opts, route: "bank_transfer" })!;
    const card = priceRoute({ ...opts, route: "card_payment" })!;
    const atm = priceRoute({ ...opts, route: "atm_cash" })!;
    expect(bank.totalSource).toBeLessThan(card.totalSource);
    expect(card.totalSource).toBeLessThan(atm.totalSource);
    expect(card.taxes[0].ruleId).toBe("PK.CARD.ADVANCE_TAX");
    expect(atm.fees.some((f) => f.label.includes("×9"))).toBe(true); // 250k / 30k per withdrawal
  });

  it("card payments carry the 2.5% university surcharge on the China corridor", () => {
    const w = world("uk-tuition");
    const card = priceRoute({ corridor: "CN-GB", route: "card_payment", deliverAmount: 10000, institution: INSTITUTIONS.kgu, simDate: w.now })!;
    expect(card.fees.find((f) => f.label.includes("surcharge"))!.amount).toBeGreaterThan(0);
  });
});

describe("Pakistan rules", () => {
  it("blocks medical remittances above USD 50,000 for one case", () => {
    const w = world();
    const c = w.cases.case_th;
    const ev = evaluateRoute({ world: w, caseFile: c, payer: c.people[0], route: "bank_transfer", amount: 1_800_000, currency: "THB" });
    expect(ev.allowed).toBe(false);
    expect(ev.blockers[0].ruleId).toBe("PK.MED.REMIT.CAP");
  });

  it("requires the SBP application form and self-declaration for a medical transfer", () => {
    const w = world();
    const c = w.cases.case_th;
    const ev = evaluateRoute({ world: w, caseFile: c, payer: c.people[0], route: "bank_transfer", amount: 250000, currency: "THB" });
    expect(ev.allowed).toBe(true);
    expect(ev.requiredDocs.map((d) => d.kind).sort()).toEqual(["invoice", "remittance_application", "self_declaration"]);
  });

  it("carried cash is impossible once the family is abroad", () => {
    const w = world();
    const c = w.cases.case_th;
    const ev = evaluateRoute({ world: w, caseFile: c, payer: c.people[0], route: "carried_cash", amount: 50000, currency: "THB" });
    expect(ev.allowed).toBe(false);
  });

  it("counts card spending against the yearly USD 30,000 allowance", () => {
    const w = world();
    const c = w.cases.case_th;
    const ev = evaluateRoute({ world: w, caseFile: c, payer: c.people[0], route: "card_payment", amount: 900000, currency: "THB" });
    expect(ev.blockers.map((b) => b.ruleId)).toContain("PK.CARD.ANNUAL");
  });

  it("blocks paying through someone who is not on the case", () => {
    const w = world();
    const c = w.cases.case_th;
    const ev = evaluateRoute({ world: w, caseFile: c, payer: undefined, route: "card_payment", amount: 1000, currency: "THB" });
    expect(ev.blockers[0].ruleId).toBe("CARRYPAY.NO_SPLITTING");
  });

  it("blocks splitting one bill across two people's card limits", () => {
    const w = world();
    const c = w.cases.case_th;
    w.invoices.inv_x = { id: "inv_x", caseId: c.id, institutionId: "srh", kind: "deposit_request", number: "X", currency: "THB", lineItems: [], total: 200000, amountDue: 200000, issuedAt: w.now, documentId: "d", status: "open" };
    w.payments.pay_x = { id: "pay_x", caseId: c.id, invoiceId: "inv_x", payerId: "p_tariq", route: "card_payment", amount: 100000, currency: "THB", status: "completed", createdAt: w.now } as Payment;
    const ev = evaluateRoute({ world: w, caseFile: c, payer: c.people[1], route: "card_payment", amount: 100000, currency: "THB", invoiceId: "inv_x" });
    expect(ev.blockers.map((b) => b.ruleId)).toContain("CARRYPAY.NO_SPLITTING");
  });
});

describe("China SAFE rules", () => {
  it("allows tuition above the USD 50,000 quota but asks for proof of the expense", () => {
    const w = world("uk-tuition");
    const c = w.cases.case_uk;
    const ev = evaluateRoute({ world: w, caseFile: c, payer: c.people[0], route: "bank_transfer", amount: 24675, currency: "GBP" });
    expect(ev.allowed).toBe(true);
    expect(ev.warnings[0].ruleId).toBe("CN.FX.ABOVE_QUOTA_CURRENT");
    expect(ev.requiredDocs.map((d) => d.kind).sort()).toEqual(["admission_letter", "fx_purchase_application", "invoice"]);
  });

  it("blocks overseas property purchases", () => {
    const w = world("uk-tuition");
    const c = w.cases.case_uk;
    const ev = evaluateRoute({ world: w, caseFile: c, payer: c.people[0], route: "bank_transfer", amount: 1000, currency: "GBP", purpose: "property" });
    expect(ev.blockers.map((b) => b.ruleId)).toContain("CN.FX.PROHIBITED_PURPOSES");
  });
});

describe("route comparison", () => {
  it("flags the bank transfer as too slow for a next-morning deadline", () => {
    const w = world();
    const c = w.cases.case_th;
    const deadline = new Date(new Date(w.now).getTime() + 16 * 3600_000).toISOString();
    const opts = compareRoutes({ world: w, caseFile: c, payer: c.people[0], institution: INSTITUTIONS.srh, amount: 160000, deadline });
    expect(opts.find((o) => o.route === "bank_transfer")!.meetsDeadline).toBe(false);
    expect(opts.find((o) => o.route === "card_payment")!.meetsDeadline).toBe(true);
  });
});
