// An approval covers a payment on the terms the family saw: the bill version (or plan instalment), the cost
// limit in their own currency, the quote's validity and the verified account. If any of them changes before
// they decide, only that approval is withdrawn, and nothing is sent.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseFlags } from "@/domain/flags";
import { INSTITUTIONS } from "@/domain/institutions";
import { QUOTE_HOLD_HOURS } from "@/domain/approval-terms";
import { obligationsFor } from "@/domain/plan/cashflow";
import { Store } from "./store";
import { seedScenario } from "./scenarios";
import { advanceTo, advanceToNext } from "./sim/engine";
import { hoursFrom } from "./sim/factory";
import { executeTool } from "./agent/tools";
import { setFlagsForTest } from "./flags";
import { decideArrangement } from "./plan";
import { decideApprovalIn } from "./runtime";

const K = INSTITUTIONS.kgu;
const VERIFIED = { account_name: K.bank.accountName, account_number: K.bank.accountNumber, swift: K.bank.swift, bank_name: K.bank.bankName };

beforeAll(() => setFlagsForTest(parseFlags("all")));
afterAll(() => setFlagsForTest(undefined));

/** uk-year with the corrected statement and, optionally, the three-instalment plan confirmed. */
function setup(withPlan: boolean) {
  const store = new Store();
  store.reset(seedScenario("uk-year"));
  const call = (name: string, input: Record<string, unknown>) => JSON.parse(executeTool(name, { narration: "test", ...input }, { store, caseId: "case_yr" }));
  advanceToNext(store);
  call("send_email", { to: K.email, subject: "Admission, fee statement, bank details", body: "Please confirm the admission of Zhou Yutong and send the fee statement and bank details." });
  advanceToNext(store);
  const adj = call("review_entitlements", {}).findings[0].adjustment_id;
  call("request_bill_correction", { adjustment_id: adj, subject: "Scholarship missing", body: "The award letter is attached." });
  advanceToNext(store);
  const statement = Object.values(store.world.invoices).find((i) => i.kind === "fee_statement" && i.status === "open")!;
  if (withPlan) {
    call("request_arrangement", { invoice_id: statement.id, kind: "published_plan", subject: "Instalment plans", body: "Please send your published instalment plans." });
    advanceToNext(store);
    const three = Object.values(store.world.arrangements!).find((a) => a.title.startsWith("Three"))!;
    decideArrangement(store, three.id, "accept", "p_jianhua");
    advanceToNext(store);
  }
  const first = obligationsFor(store.world, "case_yr")[0];
  call("prepare_documents", { kinds: ["fx_purchase_application"], invoice_id: statement.id, payer_id: "p_jianhua", amount: first.amount });
  const r = call("propose_payment", { invoice_id: statement.id, route: "bank_transfer", amount: first.amount, payer_id: "p_jianhua", reference: "KG2611392", beneficiary: VERIFIED, rationale: "Pays the statement to Kingsgate's verified account." });
  expect(r.approval_id ?? r.error).toMatch(/^apr_/);
  const approval = store.world.approvals[r.approval_id];
  const approve = () => decideApprovalIn(store, approval.id, "approved", "hold", undefined, "p_jianhua");
  const payment = () => store.world.payments[approval.paymentId];
  return { store, statement, approval, approve, payment };
}

describe("approval terms", () => {
  it("records the bill version, a cost limit in CNY and the quote's validity with every approval", () => {
    const { approval, payment, statement } = setup(false);
    const t = approval.terms!;
    expect(t.invoice).toMatchObject({ id: statement.id, amountDue: statement.amountDue });
    expect(t.maxCost).toEqual({ currency: "CNY", amount: Math.ceil(payment().cost.totalSource) });
    expect(Date.parse(t.quoteHeldUntil) - Date.parse(t.quotedAt)).toBe(QUOTE_HOLD_HOURS * 3_600_000);
  });

  it("a revised bill withdraws the pending approval: approving it afterwards sends nothing", () => {
    const { store, statement, approval, approve, payment } = setup(false);
    store.mutate((w) => (w.invoices[statement.id].amountDue -= 500));
    expect(approve).toThrow(/withdrawn because something changed/);
    expect(store.world.approvals[approval.id].decision).toBe("withdrawn");
    expect(store.world.approvals[approval.id].withdrawn!.changes.map((c) => c.id)).toEqual(["invoice_changed"]);
    expect(payment().status).toBe("cancelled");
    expect(payment().statusHistory.some((h) => h.status === "submitted")).toBe(false);
    expect(store.ledger.some((e) => e.type === "approval.withdrawn")).toBe(true);
  });

  it("a replaced bill is noticed as soon as it happens, before anyone opens the approval", () => {
    const { store, statement, approval } = setup(false);
    store.mutate((w) => {
      w.invoices[statement.id].status = "superseded";
    });
    advanceTo(store, hoursFrom(store.world.now, 1));
    expect(store.world.approvals[approval.id].decision).toBe("withdrawn");
    expect(() => decideApprovalIn(store, approval.id, "approved", "hold", undefined, "p_jianhua")).toThrow(/no longer pending/);
    expect(store.world.approvals[approval.id].withdrawn!.changes[0].id).toBe("invoice_replaced");
  });

  it("within the quote's validity the held price applies, even if the rate moved", () => {
    const { store, approve, payment } = setup(false);
    const quoted = payment().cost.totalSource;
    store.mutate((w) => (w.fxShocks = [{ currency: "GBP", pct: 0.05, from: w.now }]));
    approve();
    expect(payment().status).not.toBe("cancelled");
    expect(payment().cost.totalSource).toBe(quoted);
  });

  it("after the quote expires, a dearer price above the approved limit withdraws the approval", () => {
    const { store, approval, approve, payment } = setup(false);
    store.mutate((w) => {
      w.fxShocks = [{ currency: "GBP", pct: 0.05, from: w.now }];
      w.now = hoursFrom(w.now, QUOTE_HOLD_HOURS + 1);
    });
    expect(approve).toThrow(/above the CNY/);
    expect(store.world.approvals[approval.id].withdrawn!.changes.map((c) => c.id)).toEqual(["cost_above_limit"]);
    expect(payment().status).toBe("cancelled");
  });

  it("after the quote expires, a cheaper price goes ahead at the new price and is logged", () => {
    const { store, approve, payment } = setup(false);
    const quoted = payment().cost.totalSource;
    store.mutate((w) => {
      w.fxShocks = [{ currency: "CNY", pct: 0.05, from: w.now }];
      w.now = hoursFrom(w.now, QUOTE_HOLD_HOURS + 1);
    });
    approve();
    expect(payment().status).not.toBe("cancelled");
    expect(payment().cost.totalSource).toBeLessThan(quoted);
    expect(store.ledger.some((e) => e.type === "approval.requoted")).toBe(true);
  });

  it("the institution's verified account changing withdraws the approval", () => {
    const { store, approval, approve } = setup(false);
    store.mutate((w) => (w.institutions.kgu.bank = { ...w.institutions.kgu.bank, accountNumber: "GB00 KGSU 0000 0000 0000 01" }));
    expect(approve).toThrow(/withdrawn/);
    expect(store.world.approvals[approval.id].withdrawn!.changes.map((c) => c.id)).toContain("account_changed");
  });

  it("under a plan, only the affected instalment's approval is withdrawn: a change to a later instalment doesn't touch it", () => {
    const { store, statement, approval, approve, payment } = setup(true);
    expect(approval.terms!.instalment?.number).toBe(1);
    // the university raises the last instalment (as in the April beat): instalment 1 is unchanged
    store.mutate((w) => {
      const arr = Object.values(w.arrangements!).find((a) => a.status === "accepted")!;
      arr.instalments[arr.instalments.length - 1].amount += 600;
      w.invoices[statement.id].total += 600;
      w.invoices[statement.id].amountDue += 600;
    });
    approve();
    expect(payment().status).not.toBe("cancelled");
  });

  it("under a plan, a change to the instalment being paid withdraws its approval", () => {
    const { store, approval, approve } = setup(true);
    store.mutate((w) => {
      const arr = Object.values(w.arrangements!).find((a) => a.status === "accepted")!;
      arr.instalments[0].amount -= 100;
    });
    expect(approve).toThrow(/Instalment 1 changed/);
    expect(store.world.approvals[approval.id].decision).toBe("withdrawn");
  });

  it("declining a changed approval still works (a brake is always allowed)", () => {
    const { store, statement, approval, payment } = setup(false);
    store.mutate((w) => (w.invoices[statement.id].amountDue -= 500));
    decideApprovalIn(store, approval.id, "declined", "hold", undefined, "p_yutong");
    expect(store.world.approvals[approval.id].decision).toBe("declined");
    expect(payment().status).toBe("cancelled");
  });
});
