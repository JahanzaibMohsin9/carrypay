// The bank's workbench for a bill the family uploaded: three separate checks, each on named evidence.
// Payments open only when all three are confirmed, and a check rejected later closes them again.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseFlags } from "@/domain/flags";
import { Store } from "./store";
import { AgentRunner } from "./agent/runner";
import { executeTool } from "./agent/tools";
import { seedUpload } from "./scenarios";
import { advanceToNext } from "./sim/engine";
import { sampleDraft } from "./upload";
import { setFlagsForTest } from "./flags";
import { reviewVerification, verifyAllForSandbox } from "./verification";
import { caseSnapshot } from "./agent/snapshot";
import type { UploadedBill } from "@/domain/types";

beforeAll(() => setFlagsForTest(parseFlags("all")));
afterAll(() => setFlagsForTest(undefined));

const family = { home: "PK" as const, type: "medical" as const, payerName: "Ayesha Khan", subjectName: "Imran Khan", alreadyAbroad: true };
const bill = (): UploadedBill => sampleDraft(family, new Date("2026-10-15T08:00:00Z"));

async function boot() {
  const store = new Store();
  store.load(() => seedUpload(bill(), "2026-10-15T08:00:00Z"));
  store.reset(seedUpload(bill(), "2026-10-15T08:00:00Z"));
  store.world.agent.mode = "scripted";
  const runner = new AgentRunner(store);
  runner.resetSession();
  (globalThis as Record<string, unknown>).__carrypay = { store, runner, autoplayTimer: setInterval(() => {}, 1 << 30), runnerClass: AgentRunner };
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 1));
    for (let i = 0; i < 200 && (runner.isBusy || store.world.agent.status === "working"); i++) await new Promise((r) => setTimeout(r, 5));
  };
  advanceToNext(store);
  await settle();
  const pay = () => {
    const inv = Object.values(store.world.invoices)[0];
    const b = store.world.institutions.upl.bank;
    return JSON.parse(
      executeTool(
        "propose_payment",
        {
          narration: "probe",
          invoice_id: inv.id,
          route: "bank_transfer",
          amount: inv.amountDue,
          payer_id: "p_payer",
          reference: "HMC-0884213",
          beneficiary: { account_name: b.accountName, account_number: b.accountNumber, swift: b.swift, bank_name: b.bankName },
          rationale: "Pays the verified hospital account.",
        },
        { store, caseId: "case_up" },
      ),
    );
  };
  return { store, settle, pay };
}

const confirm = (store: Store, check: "institution" | "account" | "invoice", method: string) => reviewVerification(store, { institutionId: "upl", check, action: "confirm", method });

describe("bank verification workbench", () => {
  it("opens payments only when the institution, its account and the bill are each confirmed", async () => {
    const { store, pay } = await boot();
    confirm(store, "institution", "official_register");
    confirm(store, "account", "account_name_check");
    expect(store.world.institutions.upl.verifiedAt).toBeUndefined();
    expect(pay().error).toMatch(/BLOCKED/); // a genuine institution and its account still don't make this bill authentic
    confirm(store, "invoice", "billing_office");
    expect(store.world.institutions.upl.verifiedAt).toBeDefined();
    expect(store.ledger.filter((e) => e.type === "institution.verified")).toHaveLength(1);
    expect(store.ledger.at(-1)!.data.checks).toEqual([
      { check: "institution", method: "official_register" },
      { check: "account", method: "account_name_check" },
      { check: "invoice", method: "billing_office" },
    ]);
  });

  it("refuses a confirmation without named evidence, and a rejection or request without a note", async () => {
    const { store } = await boot();
    expect(() => confirm(store, "account", "the family said so")).toThrow(/confirmed on/);
    expect(() => reviewVerification(store, { institutionId: "upl", check: "account", action: "reject" })).toThrow(/reason/);
    expect(() => reviewVerification(store, { institutionId: "upl", check: "invoice", action: "request", note: "" })).toThrow(/supply/);
    expect(() => reviewVerification(store, { institutionId: "kgu", check: "account", action: "confirm", method: "account_name_check" })).toThrow(/uploaded bill/);
  });

  it("asking the family for evidence wakes the agent and shows in its snapshot", async () => {
    const { store } = await boot();
    reviewVerification(store, { institutionId: "upl", check: "invoice", action: "request", note: "The original bill as the hospital emailed it." });
    const checks = (caseSnapshot(store.world, "case_up").institution as { bank_checks?: { question: string; status: string; bank_note?: string }[] }).bank_checks!;
    expect(checks.find((c) => c.question.includes("bill"))).toMatchObject({ status: "the bank needs more evidence from the family", bank_note: "The original bill as the hospital emailed it." });
    expect(store.ledger.some((e) => e.type === "verification.requested")).toBe(true);
  });

  it("a check rejected after verification closes payments again and withdraws a waiting approval", async () => {
    const { store, settle } = await boot();
    verifyAllForSandbox(store, "upl");
    await settle(); // the scripted agent proposes the payment once the institution is verified
    const a = Object.values(store.world.approvals).find((x) => !x.decision)!;
    expect(a).toBeDefined();
    reviewVerification(store, { institutionId: "upl", check: "account", action: "reject", note: "The receiving bank says the account name doesn't match." });
    expect(store.world.institutions.upl.verifiedAt).toBeUndefined();
    expect(store.world.approvals[a.id].decision).toBe("withdrawn");
    expect(store.world.approvals[a.id].withdrawn!.changes.map((c) => c.id)).toContain("verification_withdrawn");
    expect(store.world.payments[a.paymentId].status).toBe("cancelled");
  });

  it("the Director's shortcut confirms each check and says so in the log", async () => {
    const { store } = await boot();
    verifyAllForSandbox(store, "upl");
    expect(store.ledger.filter((e) => e.type === "verification.confirmed").map((e) => e.data.method)).toEqual(["sandbox_director", "sandbox_director", "sandbox_director"]);
    expect(store.world.institutions.upl.verifiedAt).toBeDefined();
  });
});
