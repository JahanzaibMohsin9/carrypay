// The bank reviewer's workbench for an institution known only from the family's uploaded bill. Each check
// (institution, account, bill) is confirmed on named evidence, sent back to the family for more, or
// rejected with a reason. Payments open only once all three are confirmed; a check rejected later closes
// them again, and the gateway withdraws any approval waiting on that institution.
import { z } from "zod";
import { allConfirmed, checkSpec, SANDBOX_METHOD, VERIFICATION_CHECKS } from "@/domain/verification";
import type { VerificationCheckId } from "@/domain/types";
import type { Store } from "./store";
import { sweepApprovals } from "./sim/engine";

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
