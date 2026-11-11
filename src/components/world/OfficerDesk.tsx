"use client";

import { CalendarClock, CircleAlert, CircleCheck, FileSignature, FileText, Fingerprint, Hand, Landmark, Link2, ScrollText } from "lucide-react";
import { useCarry } from "@/lib/client";
import { activeCase, caseTz } from "@/lib/selectors";
import { cn, dateTime, money, shortHash } from "@/lib/format";
import { corridorOf } from "@/domain/corridors";
import { evaluateRoute, findRule } from "@/domain/rules/engine";
import { instalmentOf, instalmentProgress, projectCashflow } from "@/domain/plan/cashflow";
import type { Arrangement } from "@/domain/plan/types";
import type { ApprovalTerms, Currency, LedgerEntry, Payment, World } from "@/domain/types";
import { RuleChip } from "../RuleChip";
import { OfficerStress } from "./OfficerStress";

// The bank's side of a CarryPay payment: the remittance package an FX officer
// would review before releasing a transfer. Built from the same world state,
// rules engine and activity log the family sees; nothing here is typed by hand.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** SWIFT MT103 amounts use a decimal comma. */
const swiftAmount = (n: number) => n.toFixed(2).replace(".", ",");
const swiftDate = (iso: string) => iso.slice(2, 10).replace(/-/g, "");

function mt103(w: World, p: Payment, payerName: string, city: string) {
  const inst = w.institutions[p.institutionId];
  const c = w.cases[p.caseId];
  const purpose = c.type === "medical" ? "MEDICAL TREATMENT ABROAD" : "TUITION AND ACCOMMODATION FEES";
  return [
    `:20:${p.id.toUpperCase().replace(/_/g, "")}`,
    ":23B:CRED",
    `:32A:${swiftDate(p.createdAt)}${p.currency}${swiftAmount(p.amount)}`,
    `:50K:${payerName.replace(/[^\x20-\x7E]/g, "").trim()}`,
    `${city.toUpperCase()}`,
    `:57A:${p.beneficiary.swift}`,
    `:59:/${p.beneficiary.accountNumber.replace(/\s+/g, "")}`,
    `${inst.legalName}`,
    `:70:${p.reference.slice(0, 35)}`,
    `${purpose}`,
    ":71A:OUR",
  ].join("\n");
}

export function OfficerDesk() {
  const { state } = useCarry();
  if (!state) return null;
  const w = state.world;
  const c = activeCase(state)!;
  const tz = caseTz(c);
  const corridor = corridorOf(c.corridor);
  const transfers = Object.values(w.payments)
    .filter((p) => p.caseId === c.id && p.route === "bank_transfer" && p.status !== "cancelled")
    .reverse();

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#2a3441] bg-[#111820] text-[#d7e0ea] shadow-pop">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#2a3441] px-4 py-2.5">
        <Landmark size={15} className="text-[#7fb3ff]" />
        <p className="flex-1 text-[13px] font-semibold">Remittance desk · {corridor.fromCity.name} (FX officer view)</p>
        <span className="font-mono text-[10px] text-[#8193a8]">sandbox bank</span>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4">
        <p className="text-[12px] leading-relaxed text-[#8193a8]">
          Every transfer CarryPay sends arrives as a complete package: applicant, verified beneficiary, the regulations checked with their sources, the signed forms, the family&apos;s approval and a draft SWIFT message. The officer reviews instead of re-collecting paperwork.
        </p>
        <OfficerStress w={w} c={c} tz={tz} planOn={!!state.flags?.plan} />
        {transfers.length === 0 && <p className="px-1 py-3 text-[12px] text-[#8193a8]">No bank transfers on this case yet.</p>}
        {transfers.map((p) => (
          <Package key={p.id} w={w} p={p} ledger={state.ledger} tz={tz} city={corridor.fromCity.name} />
        ))}
      </div>
    </div>
  );
}

function Package({ w, p, ledger, tz, city }: { w: World; p: Payment; ledger: LedgerEntry[]; tz: string; city: string }) {
  const c = w.cases[p.caseId];
  const inst = w.institutions[p.institutionId];
  const inv = w.invoices[p.invoiceId];
  const payer = c.people.find((x) => x.id === p.payerId);
  // like-for-like: the rules as they stood before this payment counted against the limits
  const before = { ...w, payments: Object.fromEntries(Object.entries(w.payments).filter(([id]) => id !== p.id)) };
  const ev = evaluateRoute({ world: before, caseFile: c, payer, route: p.route, amount: p.amount, currency: p.currency, invoiceId: inv.id });
  const benOk = norm(p.beneficiary.accountNumber) === norm(inst.bank.accountNumber) && norm(p.beneficiary.swift) === norm(inst.bank.swift);
  const docs = Object.values(w.docs).filter((d) => d.caseId === c.id);
  const bankLetter = docs.find((d) => d.kind === "bank_letter" && d.origin === "institution");
  const approval = ledger.find((e) => e.type === "approval.approved" && e.data.paymentId === p.id);
  const passkey = approval?.data.passkey as { device?: string; challenge?: string } | undefined;
  const apr = p.approvalId ? w.approvals[p.approvalId] : undefined;
  // paid under a plan mandate: no approval of its own, the gateway checked every term of the signed mandate
  const underMandate = ledger.find((e) => e.type === "approval.mandate" && e.data.paymentId === p.id);
  const approved = !!approval || !!underMandate;
  const entries = ledger.filter((e) => JSON.stringify(e.data).includes(p.id));
  const ready = benOk && ev.allowed && ev.requiredDocs.every((d) => d.present) && approved;
  const directRule = c.type === "medical" ? findRule(c.corridor, "PK.MED.DIRECT_TO_HOSPITAL") : undefined;
  const plan = Object.values(w.arrangements ?? {}).find((a) => a.invoiceId === p.invoiceId && a.status === "accepted" && a.confirmationDocId);

  return (
    <div className="rounded-xl border border-[#2a3441] bg-[#16202b]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#2a3441] px-3 py-2.5">
        <span className="num text-[16px] font-semibold text-white">{money(p.amount, p.currency)}</span>
        <span className="text-[12px] text-[#8193a8]">≈ {money(p.cost.totalSource, p.cost.sourceCurrency)} debited</span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold", ready ? "bg-[#163626] text-[#6ee7a8]" : "bg-[#3a2c14] text-[#fbbf6b]")}>
          {ready ? "Package complete" : p.status === "awaiting_approval" ? "Waiting for the family's approval" : "Needs review"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
        <Block title="Applicant">
          <Row k="Name" v={payer?.name ?? p.payerId} />
          <Row k="Passport" v={payer?.passport ?? "on file"} mono />
          <Row k="Relationship" v={payer?.role ?? ""} />
          <Row k="Purpose" v={c.type === "medical" ? "Medical treatment abroad" : "Tuition and accommodation abroad"} />
        </Block>
        <Block title="Beneficiary">
          <Row k="Name" v={inst.legalName} />
          <Row k="Bank" v={`${p.beneficiary.bankName} · ${p.beneficiary.swift}`} />
          <Row k="Account" v={p.beneficiary.accountNumber} mono />
          <Check ok={benOk} text={benOk ? "Matches the verified registry" : "Does not match the verified registry"} rule="CARRYPAY.VERIFIED_BENEFICIARY" />
          {bankLetter && <Check ok text={`Institution's bank letter on file (${dateTime(bankLetter.createdAt, tz)})`} />}
        </Block>

        <Block title="Regulations checked">
          {ev.limits.map((l) => (
            <Check key={l.ruleId + l.label} ok={l.afterUSD <= l.capUSD} text={`${l.label}: USD ${Math.round(l.afterUSD).toLocaleString()} of ${l.capUSD.toLocaleString()}`} rule={l.ruleId} />
          ))}
          {directRule && <Check ok={benOk} text="Paid directly to the hospital's own account" rule={directRule.id} />}
          {ev.warnings.map((x) => (
            <Check key={x.ruleId} ok text={x.message} rule={x.ruleId} />
          ))}
          {ev.blockers.map((x) => (
            <Check key={x.ruleId} ok={false} text={x.message} rule={x.ruleId} />
          ))}
          <Check ok text="One payer for this bill, no splitting across relatives" rule={c.corridor === "CN-GB" ? "CN.FX.NO_SPLITTING" : "CARRYPAY.NO_SPLITTING"} />
        </Block>

        <Block title="Documents">
          {ev.requiredDocs.map((d) => {
            const doc = d.kind === "invoice" ? docs.find((x) => x.id === inv.documentId) : docs.find((x) => x.kind === d.kind);
            return (
              <div key={d.kind} className="flex items-start gap-2 text-[12px]">
                <FileText size={13} className={cn("mt-[2px] shrink-0", d.present ? "text-[#6ee7a8]" : "text-[#fbbf6b]")} />
                <span className="min-w-0 flex-1">
                  {d.label}
                  <span className="block truncate text-[11px] text-[#8193a8]">
                    {doc ? `${doc.title} · ${doc.origin === "agent" ? (approved ? "signed by the applicant on approval" : "prepared, awaiting signature") : `from ${inst.name}`}` : "missing"}
                  </span>
                </span>
                <RuleChip id={d.ruleId} className="bg-[#22303e] text-[#b9c6d4]" />
              </div>
            );
          })}
        </Block>

        <Block title="Customer authorisation">
          {underMandate ? (
            <MandateAuthorisation w={w} entry={underMandate} ledger={ledger} tz={tz} />
          ) : approval ? (
            <>
              <div className="flex items-center gap-2 text-[12px]">
                {passkey ? <Fingerprint size={14} className="text-[#6ee7a8]" /> : <Hand size={14} className="text-[#fbbf6b]" />}
                <span>
                  {passkey ? `Passkey (${passkey.device ?? "device"}), user verified` : "Hold-to-approve (no passkey on this device)"} · {dateTime(approval.simAt, tz)}
                </span>
              </div>
              {passkey?.challenge && <Row k="Signed payment digest" v={`${passkey.challenge.slice(0, 16)}…`} mono />}
              {apr?.terms && <ApprovedTerms terms={apr.terms} currency={p.currency} requoted={ledger.some((e) => e.type === "approval.requoted" && e.data.paymentId === p.id)} tz={tz} />}
            </>
          ) : (
            <p className="text-[12px] text-[#fbbf6b]">Not yet approved by the family.</p>
          )}
        </Block>

        {plan && <PlanBlocks w={w} p={p} plan={plan} ledger={ledger} tz={tz} />}

        <Block title="Audit trail">
          <div className="flex items-center gap-2 text-[12px]">
            <Link2 size={13} className="text-[#7fb3ff]" />
            <span>
              {entries.length} hash-chained log entries for this payment · head {shortHash(ledger.at(-1)?.hash ?? "")}
            </span>
          </div>
          <a href="/api/ledger" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#7fb3ff] hover:underline">
            <ScrollText size={13} /> Export the verified log
          </a>
        </Block>
      </div>

      <div className="border-t border-[#2a3441] p-3">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8193a8]">Draft SWIFT MT103 (for the officer to check; not sent from here)</p>
        <pre className="scroll-thin overflow-x-auto rounded-lg bg-[#0b1016] p-3 font-mono text-[11.5px] leading-relaxed text-[#b9c6d4]">{mt103(w, p, payer?.name ?? "", city)}</pre>
      </div>
    </div>
  );
}

/** The commercial terms the customer approved with the payment, re-checked by the gateway when they approved. */
function ApprovedTerms({ terms, currency, requoted, tz }: { terms: ApprovalTerms; currency: Currency; requoted: boolean; tz: string }) {
  return (
    <div className="mt-1 space-y-1">
      <Row k="Bill version approved" v={`${terms.invoice.number} · ${money(terms.invoice.amountDue, currency)} requested`} />
      {terms.instalment && <Row k="Plan instalment" v={`No. ${terms.instalment.number}, due ${dateTime(terms.instalment.dueAt, tz)}`} />}
      <Row k="Cost limit approved" v={money(terms.maxCost.amount, terms.maxCost.currency)} />
      <Row k="Quote held until" v={dateTime(terms.quoteHeldUntil, tz)} />
      <Check ok text={requoted ? "Quote had expired: priced again within the approved limit" : "Bill, account and quote unchanged when approved"} />
    </div>
  );
}

/** What each check in mandateAllows (src/domain/plan/mandate.ts) means, for the officer. */
const MANDATE_CHECK: Record<string, string> = {
  active: "Mandate active: not paused or revoked",
  kill_switch: "Family's emergency stop is off",
  plan_in_force: "For the bill of the plan the university confirmed",
  invoice_open: "Bill unchanged since the mandate was signed",
  payer: "Paid by the payer who signed the mandate",
  beneficiary: "Same verified account as in the mandate and the registry",
  route: "Bank transfer straight to the institution",
  amount: "Exactly one of the approved instalments",
  window: "Inside that instalment's payment window",
  still_owed: "Instalment still owed, at that amount",
  total_cap: "Within the mandate's total cap",
  reserve: "Payer's reserve holds after this payment",
  rules: "Allowed by the FX rules engine",
};

const day = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(new Date(iso));

type PasskeyEvidence = { device?: string; challenge?: string } | undefined;

function MandateAuthorisation({ w, entry, ledger, tz }: { w: World; entry: LedgerEntry; ledger: LedgerEntry[]; tz: string }) {
  const mandateId = String(entry.data.mandateId);
  const signed = ledger.find((e) => e.type === "mandate.signed" && e.data.mandateId === mandateId);
  const passkey = signed?.data.passkey as PasskeyEvidence;
  const checks = (entry.data.checks as string[] | undefined) ?? [];
  const m = w.mandates?.[mandateId];
  return (
    <>
      <div className="flex items-center gap-2 text-[12px]">
        <FileSignature size={14} className="text-[#6ee7a8]" />
        <span>
          Instalment {String(entry.data.instalment)} under plan mandate {mandateId} · {dateTime(entry.simAt, tz)}
        </span>
      </div>
      <p className="text-[11px] text-[#8193a8]">No new signature for this instalment. The payer signed the mandate once; the gateway checked it against every term before releasing it:</p>
      {checks.map((id) => (
        <Check key={id} ok text={MANDATE_CHECK[id] ?? id} />
      ))}
      {signed && (
        <div className="flex items-center gap-2 pt-1 text-[12px]">
          {passkey ? <Fingerprint size={14} className="text-[#6ee7a8]" /> : <Hand size={14} className="text-[#fbbf6b]" />}
          <span>
            Mandate signed {passkey ? `with a passkey (${passkey.device ?? "device"}), user verified` : "by hold-to-approve (no passkey on this device)"} · {dateTime(signed.simAt, tz)}
          </span>
        </div>
      )}
      {m?.digest && <Row k="Signed mandate digest" v={`${m.digest.slice(0, 16)}…`} mono />}
    </>
  );
}

function PlanBlocks({ w, p, plan, ledger, tz }: { w: World; p: Payment; plan: Arrangement; ledger: LedgerEntry[]; tz: string }) {
  const c = w.cases[p.caseId];
  const inst = w.institutions[p.institutionId];
  const progress = instalmentProgress(w, plan);
  const mine = instalmentOf(w, plan, p.id);
  const confirmation = plan.confirmationDocId ? w.docs[plan.confirmationDocId] : undefined;
  const offer = plan.offerDocId ? w.docs[plan.offerDocId] : undefined;
  // the institution's own changes to the confirmed plan (e.g. a raised instalment), each with its document
  const revisions = Object.values(w.docs).filter((d) => d.caseId === c.id && d.kind === "payment_plan_offer" && d.origin === "institution" && d.fields?.arrangementId === plan.id && d.id !== plan.confirmationDocId && d.id !== plan.offerDocId);
  const revised = new Set(revisions.map((d) => Number(d.fields?.instalment)));
  const acceptedBy = c.people.find((x) => x.id === plan.acceptedBy);
  const mandates = Object.values(w.mandates ?? {}).filter((m) => m.arrangementId === plan.id);
  const mandate = mandates.find((m) => m.status !== "awaiting_approval") ?? mandates[0];
  const signed = mandate && ledger.find((e) => e.type === "mandate.signed" && e.data.mandateId === mandate.id);
  const signedWith = signed?.data.passkey as PasskeyEvidence;
  const paidUnderMandate = ledger.find((e) => e.type === "approval.mandate" && e.data.paymentId === p.id);
  const reserveCheckedAtPayment = (paidUnderMandate?.data.checks as string[] | undefined)?.includes("reserve");
  const proj = projectCashflow(w, c.id);
  const credited = p.allocation;

  return (
    <>
      <div className="min-w-0 space-y-1.5 rounded-lg border border-[#2a3441] p-2.5 md:col-span-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8193a8]">Payment plan confirmed by {inst.name}</p>
        <Row k="Plan" v={`${plan.title} · ${plan.instalments.length} instalments${plan.fee ? ` · admin fee ${money(plan.fee, plan.currency)}` : ""}`} />
        {acceptedBy && plan.acceptedAt && <Row k="Accepted by" v={`${acceptedBy.name} (${acceptedBy.role}) · ${dateTime(plan.acceptedAt, tz)}`} />}
        {offer && <Check ok text={`Offer: ${offer.title} (${dateTime(offer.createdAt, tz)})`} />}
        {confirmation && <Check ok={confirmation.origin === "institution"} text={`Confirmation: ${confirmation.title} · from ${inst.name}, ${dateTime(confirmation.createdAt, tz)}`} />}
        {revisions.map((d) => (
          <Check key={d.id} ok text={`Revision: ${d.title} · from ${inst.name}, ${dateTime(d.createdAt, tz)}`} />
        ))}
        <div className="mt-1">
          {progress.map((x) => {
            const thisOne = x.instalment === mine;
            const status = x.outstanding <= 0.005 ? "Paid" : x.paid > 0 ? `Part paid, ${money(x.outstanding, plan.currency)} left` : "Outstanding";
            return (
              <div key={x.instalment} className={cn("flex items-start gap-2 border-t border-[#2a3441] px-1 py-1.5 text-[12px]", thisOne && "rounded bg-[#1b2a3a]")}>
                <span className="w-4 shrink-0 text-[#8193a8]">{x.instalment}</span>
                <div className="min-w-0 flex-1">
                  <p>Due {day(x.dueAt, tz)}</p>
                  <p className="text-[11px]">
                    <span className={x.outstanding <= 0.005 ? "text-[#6ee7a8]" : "text-[#d7e0ea]"}>{status}</span>
                    {thisOne && <span className="ml-1.5 rounded-full bg-[#22303e] px-1.5 py-0.5 text-[10px] font-semibold text-[#7fb3ff]">this payment</span>}
                  </p>
                </div>
                <div className="num shrink-0 text-right">
                  {money(x.amount, plan.currency)}
                  {x.fee ? <span className="block text-[10.5px] text-[#8193a8]">incl. fee {money(x.fee, plan.currency)}</span> : null}
                  {revised.has(x.instalment) ? <span className="block text-[10.5px] text-[#fbbf6b]">revised</span> : null}
                </div>
              </div>
            );
          })}
        </div>
        <Check ok={mine !== undefined} text={mine !== undefined ? `This payment is instalment ${mine}, the amount ${inst.name} confirmed` : "This amount matches none of the confirmed instalments"} rule="CARRYPAY.NO_STRUCTURING" />
      </div>

      <Block title="Plan mandate">
        {mandate ? (
          <>
            <Row k="Status" v={`${mandate.id} · ${mandate.status}`} />
            {mandate.status === "paused" && mandate.pausedReason && <p className="text-[11px] leading-snug text-[#fbbf6b]">Paused: {mandate.pausedReason}</p>}
            <Row k="Per instalment" v={`up to ${money(mandate.perInstalmentCap, mandate.currency)}`} />
            <Row k="All instalments" v={`up to ${money(mandate.totalCap, mandate.currency)}`} />
            <Row k="Only to" v={mandate.beneficiary.accountNumber} mono />
            <Row k="Reserve floor" v={money(mandate.reserveFloor, proj?.currency ?? "")} />
            {mandate.windows.map((x) => (
              <div key={x.instalment} className="flex items-start gap-2 text-[12px]">
                <CalendarClock size={13} className="mt-[2px] shrink-0 text-[#7fb3ff]" />
                <span className="min-w-0 flex-1">
                  Instalment {x.instalment}: exactly {money(x.amount, mandate.currency)}, {day(x.from, tz)} to {day(x.to, tz)}
                </span>
              </div>
            ))}
            {signed ? (
              <Check ok text={`Signed ${signedWith ? `with a passkey (${signedWith.device ?? "device"})` : "by hold-to-approve"} · ${dateTime(signed.simAt, tz)}`} />
            ) : (
              <p className="text-[12px] text-[#fbbf6b]">Not signed: each instalment needs its own approval.</p>
            )}
          </>
        ) : (
          <p className="text-[12px] text-[#8193a8]">No mandate: each instalment is approved by the payer on its own.</p>
        )}
      </Block>

      <Block title="Reserve check">
        {proj ? (
          <>
            <Row k="Payer's reserve floor" v={money(proj.reserveFloor, proj.currency)} />
            <Row k="Lowest projected balance" v={money(proj.lowest.balance, proj.currency)} />
            <Row k="On" v={day(proj.lowest.at, tz)} />
            <Check
              ok={!proj.firstBreach}
              text={
                proj.firstBreach
                  ? `Falls below the reserve on ${day(proj.firstBreach.at, tz)}, short by ${money(proj.firstBreach.shortBy, proj.currency)}`
                  : `Stays above the reserve through the last instalment, ${money(proj.lowest.headroom, proj.currency)} to spare`
              }
            />
            {reserveCheckedAtPayment && <Check ok text="Checked again by the gateway when this instalment was released" />}
            <p className="text-[11px] text-[#8193a8]">Projected from the figures the family entered. Inside a bank, from the balance the bank already holds.</p>
          </>
        ) : (
          <p className="text-[12px] text-[#fbbf6b]">The family hasn&apos;t entered their figures, so there is no reserve check.</p>
        )}
      </Block>

      <Block title={`Credited by ${inst.name}`}>
        {credited?.status === "allocated" ? (
          <Check ok text={`Credited to student account ${credited.account ?? ""} · ${dateTime(credited.at, tz)}${credited.note ? ` (${credited.note.toLowerCase()})` : ""}`} />
        ) : credited?.status === "unallocated" ? (
          <Check ok={false} text={`Received but not yet credited to the student's account · ${credited.note ?? ""}`} />
        ) : (
          <p className="text-[12px] text-[#8193a8]">{p.status === "completed" ? "Delivered; waiting for the university to credit it." : "Not delivered yet."}</p>
        )}
      </Block>
    </>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5 rounded-lg border border-[#2a3441] p-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8193a8]">{title}</p>
      {children}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-[12px]">
      <span className="shrink-0 text-[#8193a8]">{k}</span>
      <span className={cn("min-w-0 truncate text-right", mono && "font-mono")}>{v}</span>
    </div>
  );
}

function Check({ ok, text, rule }: { ok: boolean; text: string; rule?: string }) {
  return (
    <div className="flex items-start gap-2 text-[12px]">
      {ok ? <CircleCheck size={13} className="mt-[2px] shrink-0 text-[#6ee7a8]" /> : <CircleAlert size={13} className="mt-[2px] shrink-0 text-[#fbbf6b]" />}
      <span className="min-w-0 flex-1">{text}</span>
      {rule && <RuleChip id={rule} className="bg-[#22303e] text-[#b9c6d4]" />}
    </div>
  );
}
