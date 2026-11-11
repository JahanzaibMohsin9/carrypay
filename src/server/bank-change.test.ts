// A genuine change of bank account by an institution CarryPay already knows: the notice from its verified
// address moves nothing by itself. The new account is paid only after the bank's reviewer confirms it, and
// then approvals and a plan mandate given for the old account need the payer again.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseFlags } from "@/domain/flags";
import { INSTITUTIONS } from "@/domain/institutions";
import { obligationsFor } from "@/domain/plan/cashflow";
import { Store } from "./store";
import { seedScenario } from "./scenarios";
import { advanceToNext } from "./sim/engine";
import { executeTool } from "./agent/tools";
import { setFlagsForTest } from "./flags";
import { decideArrangement, signMandate } from "./plan";
import { decideApprovalIn } from "./runtime";
import { announceBankChange, reviewBankChange } from "./verification";
import { caseSnapshot } from "./agent/snapshot";

const K = INSTITUTIONS.kgu;
const OLD = { account_name: K.bank.accountName, account_number: K.bank.accountNumber, swift: K.bank.swift, bank_name: K.bank.bankName };

beforeAll(() => setFlagsForTest(parseFlags("all")));
afterAll(() => setFlagsForTest(undefined));

/** uk-year with the three-instalment plan confirmed (and optionally a signed mandate). */
function setup(mandate = false) {
  const store = new Store();
  store.reset(seedScenario("uk-year"));
  const call = (name: string, input: Record<string, unknown>) => JSON.parse(executeTool(name, { narration: "test", ...input }, { store, caseId: "case_yr" }));
  advanceToNext(store);
  call("send_email", { to: K.email, subject: "Admission, fee statement, bank details", body: "Please confirm the admission of Zhou Yutong and send the fee statement and bank details." });
  advanceToNext(store);
  const adj = call("review_entitlements", {}).findings[0].adjustment_id;
  call("request_bill_correction", { adjustment_id: adj, subject: "Scholarship missing", body: "The award letter is attached." });
  advanceToNext(store);
  const statement = () => Object.values(store.world.invoices).find((i) => i.kind === "fee_statement" && i.status === "open")!;
  call("request_arrangement", { invoice_id: statement().id, kind: "published_plan", subject: "Instalment plans", body: "Please send your published instalment plans." });
  advanceToNext(store);
  const three = Object.values(store.world.arrangements!).find((a) => a.title.startsWith("Three"))!;
  decideArrangement(store, three.id, "accept", "p_jianhua");
  advanceToNext(store);
  if (mandate) {
    const m = call("propose_plan_mandate", { arrangement_id: three.id });
    signMandate(store, m.mandate_id, "p_jianhua", "hold");
  }
  const first = () => obligationsFor(store.world, "case_yr").find((o) => o.source === "arrangement")!;
  const pay = (beneficiary: typeof OLD) => {
    call("prepare_documents", { kinds: ["fx_purchase_application"], invoice_id: statement().id, payer_id: "p_jianhua", amount: first().amount });
    return call("propose_payment", { invoice_id: statement().id, route: "bank_transfer", amount: first().amount, payer_id: "p_jianhua", reference: "KG2611392", beneficiary, rationale: "Pays the instalment to Kingsgate's verified account." });
  };
  const fresh = () => {
    const b = store.world.institutions.kgu.pendingBank?.bank ?? store.world.institutions.kgu.bank;
    return { account_name: b.accountName, account_number: b.accountNumber, swift: b.swift, bank_name: b.bankName };
  };
  return { store, call, pay, fresh };
}

describe("a genuine change of bank account", () => {
  it("the notice from the verified address moves nothing: the new account isn't payable until the bank confirms it", () => {
    const { store, call, pay, fresh } = setup();
    announceBankChange(store, "kgu");
    const notice = Object.values(store.world.mail).at(-1)!;
    expect(notice).toMatchObject({ from: K.email, direction: "inbound" });
    const next = fresh();
    const v = call("verify_beneficiary", { ...next, source_document_id: store.world.institutions.kgu.pendingBank!.noticeDocId });
    expect(v).toMatchObject({ verified: false, account_change: "announced by the institution, waiting for the bank's review" });
    expect(store.world.security.some((x) => x.kind === "blocked_unverified_beneficiary")).toBe(false); // not treated as fraud
    expect(pay(next).error).toMatch(/BLOCKED/);
    expect((caseSnapshot(store.world, "case_yr").institution as { account_change?: { status: string } }).account_change?.status).toMatch(/not payable yet/);
    expect(pay(OLD).approval_id).toMatch(/^apr_/); // the account on record is still the one paid
  });

  it("once the bank confirms it, an approval waiting for the old account is withdrawn and the new one is paid", () => {
    const { store, pay, fresh } = setup();
    const before = pay(OLD);
    announceBankChange(store, "kgu");
    const next = fresh();
    expect(() => reviewBankChange(store, { institutionId: "kgu", action: "confirm", method: "the email looked right" })).toThrow(/confirmed on/);
    reviewBankChange(store, { institutionId: "kgu", action: "confirm", method: "institution_letter" });
    expect(store.world.institutions.kgu.bank.accountNumber).toBe(next.account_number);
    expect(store.world.approvals[before.approval_id]).toMatchObject({ decision: "withdrawn" });
    expect(store.world.approvals[before.approval_id].withdrawn!.changes.map((c) => c.id)).toContain("account_changed");
    expect(pay(OLD).error).toMatch(/BLOCKED/);
    const again = pay(next);
    decideApprovalIn(store, again.approval_id, "approved", "hold", undefined, "p_jianhua");
    expect(store.world.payments[again.payment_id].status).toBe("processing");
  });

  it("a signed plan mandate doesn't carry over to the new account: the payer approves it", () => {
    const { store, pay, fresh } = setup(true);
    announceBankChange(store, "kgu");
    reviewBankChange(store, { institutionId: "kgu", action: "confirm", method: "account_name_check" });
    const r = pay(fresh());
    expect(r.status).not.toBe("sent_under_plan_mandate");
    expect(Object.values(store.world.mandates!)[0].status).toBe("paused");
    expect(store.world.approvals[r.approval_id].decision).toBeUndefined(); // waiting for the payer
  });

  it("a rejected change leaves the account on record as the only one paid", () => {
    const { store, pay, fresh } = setup();
    announceBankChange(store, "kgu");
    const next = fresh();
    expect(() => reviewBankChange(store, { institutionId: "kgu", action: "reject" })).toThrow(/reason/);
    reviewBankChange(store, { institutionId: "kgu", action: "reject", note: "The receiving bank's name check doesn't match Kingsgate." });
    expect(store.world.institutions.kgu.bank.accountNumber).toBe(K.bank.accountNumber);
    expect(store.world.institutions.kgu.pendingBank).toMatchObject({ status: "rejected" });
    expect(pay(next).error).toMatch(/BLOCKED/);
    expect(pay(OLD).approval_id).toMatch(/^apr_/);
  });
});
