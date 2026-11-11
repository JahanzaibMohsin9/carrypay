// Family actions for the plan workflow. They change the family's own figures and decide on the institution's
// offers. Only the payer accepts payment terms, and acceptance is a written reply the institution must confirm:
// nothing here moves a deadline.
import { z } from "zod";
import type { FundingProfile } from "@/domain/plan/types";
import { createHash } from "node:crypto";
import { stableStringify } from "./hash";
import type { Store } from "./store";
import { sendMail } from "./sim/factory";
import { onOutboundMail } from "./sim/engine";

const money = z.number().finite().min(0).max(1e10);
const when = z.string().datetime();

export const FundingInput = z.object({
  balances: z.array(z.object({ label: z.string().min(1).max(60), amount: money })).max(10),
  income: z.array(z.object({ label: z.string().min(1).max(60), amount: money, firstAt: when, everyMonths: z.number().int().min(1).max(12).optional() })).max(10),
  essentialsMonthly: money,
  reserveFloor: money,
  conditional: z.array(z.object({ label: z.string().min(1).max(60), amount: money, expectedAt: when, status: z.enum(["expected", "confirmed"]) })).max(10),
});
export type FundingInput = z.infer<typeof FundingInput>;

/** The payer of a case: whoever entered the family's figures, otherwise the parent, patient or first adult. */
export function payerOf(store: Store, caseId: string): string | undefined {
  const w = store.world;
  const c = w.cases[caseId];
  if (!c) return undefined;
  return w.funding?.[caseId]?.ownerPersonId ?? c.people.find((p) => p.role === "parent" || p.role === "patient")?.id ?? c.people.find((p) => p.adult)?.id;
}

function refuse(store: Store, caseId: string, actingPersonId: string, what: string): never {
  const c = store.world.cases[caseId];
  const payerId = payerOf(store, caseId);
  const payer = c.people.find((p) => p.id === payerId)?.name ?? "the payer";
  const actor = c.people.find((p) => p.id === actingPersonId)?.name ?? "someone not on the case";
  const id = store.nextId("sec");
  store.mutate((w) =>
    w.security.push({ id, at: w.now, caseId, severity: "warning", kind: "blocked_wrong_approver", title: "A decision by someone other than the payer was refused", detail: `${actor} tried to ${what}. Only ${payer}, whose money pays for it, can.` }),
  );
  store.log({ actor: "gateway", type: "plan.refused", caseId, narration: `Only ${payer} can ${what}`, data: { actingPersonId, payerId, what } });
  throw new Error(`Only ${payer} can ${what}: it is paid from their money.`);
}

/** The payer enters or updates their own figures. CarryPay never reads a bank account. */
export function setFunding(store: Store, caseId: string, input: FundingInput, actingPersonId: string) {
  const c = store.world.cases[caseId];
  if (!c) throw new Error("No such case");
  if (!c.people.some((p) => p.id === actingPersonId)) throw new Error("Only someone on the case can enter its figures.");
  const owner = store.world.funding?.[caseId]?.ownerPersonId;
  if (owner && owner !== actingPersonId) refuse(store, caseId, actingPersonId, "change the family's figures");
  const parsed = FundingInput.parse(input);
  const profile: FundingProfile = {
    caseId,
    ownerPersonId: actingPersonId,
    currency: c.corridor.startsWith("CN") ? "CNY" : "PKR",
    ...parsed,
    enteredBy: actingPersonId,
    updatedAt: store.world.now,
  };
  store.mutate((w) => {
    w.funding ??= {};
    w.funding[caseId] = profile;
  });
  // the log proves the figures changed and when, without copying the family's finances into it
  store.log({ actor: "family", type: "plan.funding", caseId, narration: "The family's figures for the plan were updated", data: { by: actingPersonId, digest: createHash("sha256").update(stableStringify(parsed)).digest("hex") } });
  store.trigger({ caseId, reason: "funding_updated", detail: "The payer updated their figures (money available, income, essentials, reserve)." });
  return profile;
}

/** Accept or decline one of the institution's offers. Accepting writes to the institution; its confirmation applies the plan. */
export function decideArrangement(store: Store, arrangementId: string, decision: "accept" | "decline", actingPersonId: string | undefined, method: "passkey" | "hold" = "hold") {
  const w = store.world;
  const arr = w.arrangements?.[arrangementId];
  if (!arr) throw new Error("No such payment plan.");
  if (arr.status !== "offered") throw new Error(`This plan is ${arr.status}; only an open offer can be decided.`);
  if (arr.expiresAt && arr.expiresAt <= w.now) throw new Error("This offer has expired. CarryPay can ask the institution for a new one.");
  // sandbox automation (Director, scripts, tests) acts as the payer, as with payment approvals
  const payerId = payerOf(store, arr.caseId);
  if (decision === "accept" && actingPersonId && actingPersonId !== payerId) refuse(store, arr.caseId, actingPersonId, `accept the ${arr.title.toLowerCase()}`);
  const inst = w.institutions[arr.institutionId];
  const inv = w.invoices[arr.invoiceId];
  if (decision === "decline") {
    store.mutate((x) => {
      const a = x.arrangements![arr.id];
      a.status = "declined";
      a.history.push({ at: x.now, status: "declined", note: "Declined by the family" });
    });
    store.log({ actor: "family", type: "plan.declined", caseId: arr.caseId, narration: `You declined the ${arr.title.toLowerCase()}`, data: { arrangementId, by: actingPersonId } });
    store.trigger({ caseId: arr.caseId, reason: "plan_decided", detail: `The family declined the ${arr.title.toLowerCase()}.` });
    return;
  }
  store.mutate((x) => {
    const a = x.arrangements![arr.id];
    a.status = "accepted";
    a.acceptedBy = actingPersonId ?? payerId;
    a.acceptedAt = x.now;
    a.history.push({ at: x.now, status: "accepted", note: `Accepted by the family (${method}); awaiting the institution's confirmation` });
  });
  const c = w.cases[arr.caseId];
  const student = c.people.find((p) => p.role === "student" || p.role === "patient");
  const payer = c.people.find((p) => p.id === (actingPersonId ?? payerId));
  const fee = arr.fee ?? 0;
  const mail = sendMail(store, {
    caseId: arr.caseId,
    direction: "outbound",
    from: "cases@carrypay.app",
    fromName: "CarryPay for the family",
    to: inst.email,
    subject: `Acceptance of the ${arr.title.toLowerCase()} for statement ${inv.number}`,
    body: [
      "Dear Student Finance Office,",
      "",
      `On behalf of ${payer?.name ?? "the family"}, who pays the fees for ${student?.name ?? "the student"} (${inv.patientRef ?? "reference on the statement"}), we accept the ${arr.title.toLowerCase()} in your offer for statement ${inv.number}:`,
      ...arr.instalments.map((ins, k) => `  ${k + 1}. ${arr.currency} ${(ins.amount + (k === 0 ? fee : 0)).toFixed(2)} by ${ins.dueAt.slice(0, 10)}`),
      "",
      "Please confirm the plan in writing.",
      "",
      "Kind regards,",
      "CarryPay, on behalf of the family",
    ].join("\n"),
    attachments: arr.offerDocId ? [arr.offerDocId] : [],
    read: true,
    request: { kind: "accept_arrangement", arrangementId: arr.id },
  });
  onOutboundMail(store, mail);
  store.log({ actor: "family", type: "plan.accepted", caseId: arr.caseId, narration: `You accepted the ${arr.title.toLowerCase()}; ${inst.name} has been asked to confirm it`, data: { arrangementId, by: actingPersonId ?? payerId, method, mailId: mail.id } });
}
