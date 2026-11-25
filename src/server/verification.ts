// The bank reviewer's workbench for an institution known only from the family's uploaded bill. Each check
// (institution, account, bill) is confirmed on named evidence, sent back to the family for more, or
// rejected with a reason. Payments open only once all three are confirmed; a check rejected later closes
// them again, and the gateway withdraws any approval waiting on that institution.
import { z } from "zod";
import { allConfirmed, checkSpec, SANDBOX_METHOD, VERIFICATION_CHECKS } from "@/domain/verification";
import type { VerificationCheckId } from "@/domain/types";
import type { Store } from "./store";
import { sweepApprovals } from "./sim/engine";
import { addDoc, hoursFrom, sendMail } from "./sim/factory";

export const ReviewInput = z.object({
  institutionId: z.string(),
  check: z.enum(["institution", "account", "invoice"]),
  action: z.enum(["confirm", "request", "reject"]),
  method: z.string().optional(),
  note: z.string().max(400).optional(),
});
export type ReviewInput = z.infer<typeof ReviewInput>;

function caseOf(store: Store, institutionId: string) {
  return Object.values(store.world.cases).find((c) => c.institutionId === institutionId);
}

export function reviewVerification(store: Store, input: ReviewInput) {
  const inst = store.world.institutions[input.institutionId];
  if (!inst || inst.origin !== "uploaded_bill") throw new Error("Only an institution from an uploaded bill is verified here.");
  const spec = checkSpec(input.check as VerificationCheckId);
  const note = input.note?.trim();
  if (input.action === "confirm" && !spec.methods.some((m) => m.id === input.method) && input.method !== SANDBOX_METHOD) {
    throw new Error(`Say what this was confirmed on: ${spec.methods.map((m) => m.label.toLowerCase()).join(", or ")}.`);
  }
  if (input.action !== "confirm" && (!note || note.length < 5)) throw new Error(input.action === "reject" ? "Give the reason for the rejection." : "Say what the family should supply.");
  const c = caseOf(store, inst.id);
  const status = input.action === "confirm" ? "confirmed" : input.action === "request" ? "requested" : "rejected";
  const wasVerified = !!inst.verifiedAt;
  store.mutate((w) => {
    const x = w.institutions[inst.id];
    x.verification = { ...x.verification, [spec.id]: { status, at: w.now, ...(input.action === "confirm" ? { method: input.method } : {}), ...(note ? { note } : {}) } };
  });
  const method = input.action === "confirm" ? (input.method === SANDBOX_METHOD ? "the Director's sandbox shortcut" : spec.methods.find((m) => m.id === input.method)!.label.toLowerCase()) : undefined;
  store.log({
    actor: "bank",
    type: `verification.${status}`,
    caseId: c?.id,
    narration:
      input.action === "confirm"
        ? `Bank reviewer confirmed "${spec.question}" for ${inst.name}, on ${method}`
        : input.action === "request"
          ? `Bank reviewer needs more evidence for "${spec.question}": ${note}`
          : `Bank reviewer rejected "${spec.question}" for ${inst.name}: ${note}`,
    data: { institutionId: inst.id, check: spec.id, status, ...(input.method ? { method: input.method } : {}), ...(note ? { note } : {}) },
  });

  const now = store.world.institutions[inst.id];
  if (allConfirmed(now) && !wasVerified) {
    store.mutate((w) => (w.institutions[inst.id].verifiedAt = w.now));
    store.log({
      actor: "bank",
      type: "institution.verified",
      caseId: c?.id,
      narration: `The bank verified ${inst.name}, its account (${inst.bank.bankName}) and the bill: payments can go ahead`,
      data: { institutionId: inst.id, accountName: inst.bank.accountName, accountNumber: inst.bank.accountNumber, swift: inst.bank.swift, checks: VERIFICATION_CHECKS.map((s) => ({ check: s.id, method: now.verification?.[s.id]?.method })) },
    });
    if (c) store.trigger({ caseId: c.id, reason: "institution_verified", detail: `${inst.name}, its account and the bill were verified by the bank` });
    return;
  }
  if (input.action === "confirm") return;
  if (wasVerified) {
    // a check that fails after verification closes payments again; approvals waiting on it are withdrawn
    store.mutate((w) => delete w.institutions[inst.id].verifiedAt);
    sweepApprovals(store);
  }
  if (c)
    store.trigger({
      caseId: c.id,
      reason: input.action === "request" ? "verification_evidence_requested" : "verification_rejected",
      detail: input.action === "request" ? `The bank needs, for "${spec.question}": ${note}` : `The bank rejected "${spec.question}": ${note}`,
    });
}

/** The Director's sandbox shortcut: every check confirmed at once (what a reviewer would do on full evidence). */
export function verifyAllForSandbox(store: Store, institutionId: string) {
  for (const s of VERIFICATION_CHECKS) {
    if (store.world.institutions[institutionId].verification?.[s.id]?.status === "confirmed") continue;
    reviewVerification(store, { institutionId, check: s.id, action: "confirm", method: SANDBOX_METHOD });
  }
}

// ---------------------------------------------------------------------------
// A genuine change of bank account by an institution CarryPay already knows. The notice comes from its
// verified address, but that alone moves nothing: the account on record stays the only one paid until the
// bank's reviewer confirms the new one. Then it replaces the old one, and any approval or mandate that named
// the old account has to be given again (C28, C26).

/** The sandbox's genuine bank change for each known institution (a new bank, same legal name). */
const NEW_BANK: Record<string, { bankName: string; accountNumber: string; swift: string }> = {
  kgu: { bankName: "Thames Commercial Bank plc", accountNumber: "GB29 TCBK 6016 1331 9268 19", swift: "TCBKGB2L" },
  srh: { bankName: "Siam Commercial Bank PCL", accountNumber: "142-3-07781-5", swift: "SICOTHBK" },
};

export const BankReviewInput = z.object({
  institutionId: z.string(),
  action: z.enum(["confirm", "reject"]),
  method: z.string().optional(),
  note: z.string().max(400).optional(),
});
export type BankReviewInput = z.infer<typeof BankReviewInput>;

/** The institution announces a new account from its verified address (the Director's "genuine bank change"). */
export function announceBankChange(store: Store, institutionId: string) {
  const inst = store.world.institutions[institutionId];
  const next = NEW_BANK[institutionId];
  if (!inst || inst.origin === "uploaded_bill" || !next) throw new Error("A genuine bank change is set up only for the sandbox's own institutions.");
  if (inst.pendingBank?.status === "review") throw new Error(`${inst.name} has already announced a bank change.`);
  const c = caseOf(store, inst.id);
  const effectiveFrom = hoursFrom(store.world.now, 14 * 24);
  const bank = { ...inst.bank, ...next };
  const doc = addDoc(store, {
    caseId: c?.id ?? "",
    kind: "bank_letter",
    title: `Change of bank details: ${inst.name}`,
    text: [
      `${inst.legalName.toUpperCase()} · FINANCE DEPARTMENT · ${inst.email}`,
      "NOTICE OF CHANGE OF BANK DETAILS",
      `From ${effectiveFrom.slice(0, 10)} we receive payments at:`,
      `  Bank: ${bank.bankName}`,
      `  Account name: ${bank.accountName}`,
      `  ${inst.kind === "hospital" ? "Account number" : "IBAN"}: ${bank.accountNumber}`,
      `  SWIFT: ${bank.swift}`,
      `Payments to our current account (${inst.bank.bankName}, ${inst.bank.accountNumber}) are accepted until then.`,
      "Please have your bank verify the new account before you use it. We never ask you to pay a new account urgently.",
    ].join("\n"),
    fields: { accountNumber: bank.accountNumber, swift: bank.swift, effectiveFrom },
    origin: "institution",
  });
  store.mutate((w) => (w.institutions[inst.id].pendingBank = { bank, announcedAt: w.now, effectiveFrom, noticeDocId: doc.id, status: "review" }));
  if (c) {
    const m = sendMail(store, {
      caseId: c.id,
      direction: "inbound",
      from: inst.email,
      fromName: `${inst.name} Finance`,
      to: "cases@carrypay.app",
      subject: `Notice: change of bank details from ${effectiveFrom.slice(0, 10)}`,
      body: `Dear CarryPay team,\n\nPlease note that from ${effectiveFrom.slice(0, 10)} ${inst.name} receives payments at a new bank. The notice is attached. Payments to our current account are accepted until then. Please have your bank verify the new account before using it.\n\nKind regards,\nFinance Department\n${inst.name}`,
      attachments: [doc.id],
    });
    store.log({ actor: c ? (inst.kind === "hospital" ? "hospital" : "university") : "system", type: "institution.bank_change_announced", caseId: c.id, narration: `${inst.name} announced new bank details from its verified address; the bank must verify them before they are used`, data: { institutionId: inst.id, documentId: doc.id, mailId: m.id, effectiveFrom } });
    store.trigger({ caseId: c.id, reason: "mail_received", detail: `${m.id}: ${inst.name} announced a change of bank details (from its verified address). The new account is with the bank for review.` });
  }
}

/** The bank's reviewer decides on an announced change: confirm on named evidence, or reject with a reason. */
export function reviewBankChange(store: Store, input: BankReviewInput) {
  const inst = store.world.institutions[input.institutionId];
  const pending = inst?.pendingBank;
  if (!inst || !pending || pending.status !== "review") throw new Error("No bank change is waiting for review.");
  const spec = checkSpec("account");
  const note = input.note?.trim();
  if (input.action === "confirm" && !spec.methods.some((m) => m.id === input.method) && input.method !== SANDBOX_METHOD) {
    throw new Error(`Say what the new account was confirmed on: ${spec.methods.map((m) => m.label.toLowerCase()).join(", or ")}.`);
  }
  if (input.action === "reject" && (!note || note.length < 5)) throw new Error("Give the reason for the rejection.");
  const c = caseOf(store, inst.id);
  if (input.action === "reject") {
    store.mutate((w) => (w.institutions[inst.id].pendingBank = { ...pending, status: "rejected", note }));
    store.log({ actor: "bank", type: "institution.bank_change_rejected", caseId: c?.id, narration: `Bank reviewer rejected ${inst.name}'s new account: ${note}. The account on record stays the only one paid`, data: { institutionId: inst.id, note } });
    if (c) store.trigger({ caseId: c.id, reason: "institution_account_rejected", detail: `The bank rejected ${inst.name}'s announced new account: ${note}` });
    return;
  }
  const old = inst.bank;
  store.mutate((w) => {
    w.institutions[inst.id].bank = pending.bank;
    delete w.institutions[inst.id].pendingBank;
  });
  const method = input.method === SANDBOX_METHOD ? "the Director's sandbox shortcut" : spec.methods.find((m) => m.id === input.method)!.label.toLowerCase();
  store.log({
    actor: "bank",
    type: "institution.account_changed",
    caseId: c?.id,
    narration: `Bank reviewer verified ${inst.name}'s new account (${pending.bank.bankName}) on ${method}; it replaces ${old.bankName}`,
    data: { institutionId: inst.id, method: input.method, old: { bankName: old.bankName, accountNumber: old.accountNumber, swift: old.swift }, new: { bankName: pending.bank.bankName, accountNumber: pending.bank.accountNumber, swift: pending.bank.swift } },
  });
  // anything the family approved for the old account no longer holds: only those approvals are withdrawn
  sweepApprovals(store);
  if (c) store.trigger({ caseId: c.id, reason: "institution_account_changed", detail: `${inst.name}'s new account at ${pending.bank.bankName} is verified and replaces the old one. Approvals and mandates for the old account need the payer again.` });
}

