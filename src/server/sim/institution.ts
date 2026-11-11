import type { Doc, Institution, Invoice, Mail } from "@/domain/types";
import type { Arrangement } from "@/domain/plan/types";
import { INSTITUTIONS } from "@/domain/institutions";
import type { Store } from "../store";
import { flagOn } from "../flags";
import { addDoc, hoursFrom, issueInvoice, sendMail } from "./factory";
import { liftHolds, schedule } from "./engine";

// ---------------------------------------------------------------------------
// Sandbox institutions answer email like a competent back office: one reply
// per email, answering every question asked in it, and saying when something
// that doesn't exist yet (such as the final bill) will come.

export type Intent = "estimate" | "bank_details" | "fraud_alert" | "payment_status" | "allocation" | "cash" | "dispute" | "refund" | "statement" | "admission" | "correction" | "arrangement" | "accept";

/** Order in which answers appear in the reply (a dispute is settled before a refund is worked out). */
const PATTERNS: [Intent, RegExp][] = [
  ["estimate", /estimate|pro-?forma|quotation|fee statement|fee schedule|deposit (is )?(required|needed|amount)|how much|cost of (the )?(treatment|procedure|programme)/],
  ["bank_details", /bank (details|account|letter|confirmation)|account (details|name|number)|letterhead|beneficiary|swift|iban/],
  ["fraud_alert", /fraud|scam|phishing|suspicious|look-?alike|impersonat|did not come from|not (been )?(sent|come) from (you|your|the hospital|the university)/],
  ["payment_status", /receipt|received|arriv|credited|(transfer|payment|deposit) (has been |was |is )?(sent|initiated|made|submitted|on its way|in progress)|we (have )?(sent|paid|transferred|initiated)/],
  ["allocation", /remittance advice|allocat|student account|could not (be )?match|not (yet )?(been )?matched/],
  ["cash", /\bcash\b|cashier/],
  ["dispute", /duplicate|twice|double[- ]?charg|charged two|same (test|scan)|dispute|corrected (bill|invoice)|billing error/],
  ["refund", /refund|excess deposit|money back|return the (balance|difference)|overpa/],
  ["statement", /statement|final (bill|invoice)|itemi[sz]ed|outstanding|balance|account summary/],
  ["admission", /(confirm|verify) (the |her |his |this |that )?(admission|offer|enrol|applicant|student)|genuine offer/],
  // after the statement is issued, so a correction or a plan always works on the current statement
  ["correction", /(?=[\s\S]*\b(scholarship|bursary|award)\b)(?=[\s\S]*\b(missing|not (yet )?(been )?(applied|shown|deducted|included|reflected)|correct|revis|omit|left out|apply|applied|deduct))/],
  ["arrangement", /instal?ments? plan|payment plan|pay(ing)? (it |the fees? )?in (two|three|2|3|parts|stages|instal?ments)|spread (the )?(payments?|cost|fees)|extension|extend the (deadline|due date)|defer|lower (initial )?deposit|reduced deposit|hardship/],
  ["accept", /accept (the |your |this )?(instal?ment|payment) plan|we accept/],
];

export function detectIntents(text: string): Intent[] {
  const t = text.toLowerCase();
  return PATTERNS.filter(([, re]) => re.test(t)).map(([k]) => k);
}

interface Profile {
  desk: string;
  billing: string;
  tz: string;
  subjectName: string;
  subjectRef: string;
  refLabel: string;
}

const PROFILES: Record<string, Profile> = {
  srh: { desk: "SRH International Patient Services", billing: "Patient Billing", tz: "Asia/Bangkok", subjectName: "Mr. Tariq Mahmood", subjectRef: "HN 66-014382", refLabel: "HN" },
  kgu: { desk: "Kingsgate Student Finance", billing: "Student Finance Office", tz: "Europe/London", subjectName: "Lin Yuxuan", subjectRef: "KG2601847", refLabel: "Student ID" },
};

const money = (cur: string, n: number) => `${cur} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string, tz: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: tz });

interface Answer {
  text: string;
  attachments?: string[];
}

export function institutionReply(store: Store, mailId: string) {
  const w = store.world;
  const original = w.mail[mailId];
  if (!original) return;
  const inst = Object.values(INSTITUTIONS).find((i) => i.email === original.to);
  if (!inst) return;
  const caseId = original.caseId;
  const student = w.cases[caseId].people.find((p) => p.role === "student");
  const enrolled = inst.kind === "university" ? inst.students?.find((s) => student && student.name.includes(s.name)) : undefined;
  const latinName = (n: string) => n.split(/\s+/).filter((x) => !/\p{Script=Han}/u.test(x)).join(" ") || n;
  const prof = inst.kind === "university" ? { ...PROFILES[inst.id], subjectName: latinName(student?.name ?? ""), subjectRef: enrolled?.id ?? "" } : PROFILES[inst.id];
  const invoices = () => Object.values(store.world.invoices).filter((i) => i.caseId === caseId);

  const intents = new Set(detectIntents(`${original.subject}\n${original.body}`));
  if (original.request?.kind === "correction") intents.add("correction");
  if (original.request?.kind === "arrangement") intents.add("arrangement");
  if (original.request?.kind === "accept_arrangement") intents.add("accept");
  // a scholarship correction is not a dispute about a final bill
  if (intents.has("correction")) intents.delete("dispute");
  if (inst.kind === "university" && !enrolled) {
    // the admissions office looks the student up first: no applicant means no fees, whatever was asked
    intents.add("admission");
    for (const other of ["estimate", "statement", "bank_details", "payment_status", "refund", "dispute"] as const) intents.delete(other);
  }
  // a first contact always gets the estimate / fee statement: that's what any back office sends a new case
  else if (!invoices().length) intents.add("estimate");
  // a fraud alert is answered with the real bank details
  if (intents.has("fraud_alert")) intents.add("bank_details");
  const current = currentBill(invoices());
  if ((intents.has("dispute") || intents.has("refund")) && current) {
    intents.delete("statement");
    intents.delete("payment_status");
  }

  const ctx: ReplyCtx = { store, inst, prof, caseId, invoices, enrolled, original };
  const answers: Answer[] = [];
  const answered = new Set<Intent>();
  for (const [intent] of PATTERNS) {
    if (!intents.has(intent)) continue;
    const a = HANDLERS[intent](ctx);
    if (a) {
      answers.push(a);
      answered.add(intent);
    }
  }
  // the plan workflow's topics only count when they were answered (other cases mention "instalment 1 of 2" in passing)
  for (const k of ["correction", "arrangement", "accept", "allocation"] as const) if (!answered.has(k)) intents.delete(k);

  const body =
    answers.length === 0
      ? "Thank you for your message, which we have noted. Nothing further is needed from you at the moment."
      : answers.length === 1
        ? `Thank you for your email.\n\n${answers[0].text}`
        : `Thank you for your email. Answering each of your points:\n\n${answers.map((a, i) => `${i + 1}. ${a.text}`).join("\n\n")}`;
  const signature = inst.kind === "hospital" ? "International Patient Services\nSiam Riverside International Hospital" : "Student Finance Office\nKingsgate University";
  const subject = "Re: " + original.subject.replace(/^(re:\s*)+/i, "");
  const topics = [...intents].filter((i) => PATTERNS.some(([k]) => k === i));
  const m = sendMail(store, {
    caseId,
    direction: "inbound",
    from: inst.email,
    fromName: prof.desk,
    to: original.from,
    subject,
    body: `Dear CarryPay team,\n\n${body}\n\nKind regards,\n${signature}`,
    attachments: answers.flatMap((a) => a.attachments ?? []),
    inReplyTo: original.id,
    topics,
  });
  store.log({
    actor: inst.kind === "hospital" ? "hospital" : "university",
    type: "mail.received",
    caseId,
    narration: `${inst.name} replied${topics.length ? ` (${topics.map((t) => TOPIC_LABEL[t]).join(", ")})` : ""}`,
    data: { mailId: m.id, inReplyTo: original.id, topics },
  });
  store.trigger({ caseId, reason: "mail_received", detail: subject });
}

const TOPIC_LABEL: Record<Intent, string> = {
  estimate: "estimate",
  bank_details: "bank details",
  fraud_alert: "fraud alert",
  payment_status: "payment status",
  allocation: "allocation to the student's account",
  cash: "cash paid at the cashier",
  dispute: "bill query",
  refund: "refund",
  statement: "statement",
  admission: "admission",
  correction: "fee correction",
  arrangement: "payment plan",
  accept: "plan acceptance",
};

interface ReplyCtx {
  store: Store;
  inst: Institution;
  prof: Profile;
  caseId: string;
  invoices: () => Invoice[];
  enrolled?: NonNullable<Institution["students"]>[number];
  original: Mail;
}

function currentBill(invs: Invoice[]) {
  return invs.find((i) => (i.kind === "corrected_final" || i.kind === "final") && i.status !== "superseded");
}

function received(ctx: ReplyCtx) {
  return Object.values(ctx.store.world.payments).filter((p) => p.caseId === ctx.caseId && p.institutionId === ctx.inst.id && p.status === "completed");
}

function inFlight(ctx: ReplyCtx) {
  return Object.values(ctx.store.world.payments).filter((p) => p.caseId === ctx.caseId && p.institutionId === ctx.inst.id && (p.status === "submitted" || p.status === "processing"));
}

function bankLetterSent(ctx: ReplyCtx) {
  return Object.values(ctx.store.world.docs).find((d) => d.caseId === ctx.caseId && d.kind === "bank_letter" && d.origin === "institution");
}

/** When the hospital expects to discharge the patient: the scenario's discharge beat, if any. */
function expectedDischarge(ctx: ReplyCtx) {
  return ctx.store.world.schedule.find((s) => s.kind === "beat" && String((s.payload as { beat?: string }).beat).endsWith(".discharge"))?.at;
}

const HANDLERS: Record<Intent, (c: ReplyCtx) => Answer | null> = {
  estimate: (c) => {
    const cur = c.inst.bank.currency;
    const existing = c.invoices().find((i) => i.kind === "deposit_request" || i.kind === "estimate" || i.kind === "fee_statement");
    if (existing) {
      const paid = received(c).filter((p) => p.invoiceId === existing.id).reduce((s, p) => s + p.amount, 0);
      return {
        text: `Our ${existing.kind === "fee_statement" ? "fee statement" : "estimate"} ${existing.number} of ${day(existing.issuedAt, c.prof.tz)} is still current (${money(cur, existing.total)}${existing.amountDue !== existing.total ? `, of which ${money(cur, existing.amountDue)} was requested in advance` : ""}). ${paid >= existing.amountDue - 0.01 ? "That amount has been received in full." : existing.dueAt ? `It is due by ${day(existing.dueAt, c.prof.tz)}.` : ""}`.trim(),
      };
    }
    if (c.inst.id === "srh") {
      const inv = issueInvoice(c.store, {
        caseId: c.caseId,
        institutionId: "srh",
        kind: "deposit_request",
        title: "Treatment estimate and deposit request",
        patientName: c.prof.subjectName,
        patientRef: "HN 66-014382",
        lineItems: [
          { description: "Diagnostic coronary angiogram", amount: 68000 },
          { description: "Possible PCI with stent (if required)", amount: 230000 },
          { description: "Room and nursing, est. 5 nights", amount: 72000 },
          { description: "Medication, labs and physician fees (est.)", amount: 50000 },
        ],
        amountDue: 250000,
        dueInHours: 70,
        extraText:
          "This is an estimate. A deposit of THB 250,000.00 is required before the angiogram and possible intervention, at the latest by the morning of 5 November. Final charges may differ.",
      });
      return {
        text: `Please find attached the treatment estimate of ${money("THB", inv.total)} and our deposit request of ${money("THB", inv.amountDue)}, due by ${day(inv.dueAt!, c.prof.tz)}. Our bank details are on the document. For international transfers please allow 2 working days.`,
        attachments: [inv.documentId],
      };
    }
    const fees = c.enrolled ? STUDENT_FEES[c.enrolled.id] : undefined;
    if (!fees || !c.enrolled) return null;
    const admission = addDoc(c.store, {
      caseId: c.caseId,
      kind: "admission_letter",
      title: `Offer of admission: ${c.enrolled.programme}`,
      text: `KINGSGATE UNIVERSITY: UNCONDITIONAL OFFER OF ADMISSION\nStudent: ${c.enrolled.name}   Student ID: ${c.enrolled.id}\nProgramme: ${c.enrolled.programme} (full-time, 12 months)\nStart date: ${c.enrolled.start}\nThis letter confirms your place on the programme.`,
      fields: { studentId: c.enrolled.id, programme: c.enrolled.programme },
      origin: "institution",
    });
    const inv = issueInvoice(c.store, {
      caseId: c.caseId,
      institutionId: "kgu",
      kind: "fee_statement",
      title: "Fee statement",
      patientName: c.enrolled.name,
      patientRef: c.enrolled.id,
      lineItems: fees.lineItems,
      ...(fees.dueAt ? { dueAt: fees.dueAt } : { dueInHours: fees.dueInHours }),
      extraText: fees.hold && flagOn("resolution") ? `${fees.extraText} ${fees.hold.label}: ${fees.hold.condition} Until then the student cannot complete registration.` : fees.extraText,
    });
    if (fees.hold && flagOn("resolution") && !Object.values(c.store.world.holds ?? {}).some((h) => h.caseId === c.caseId)) {
      const id = c.store.nextId("hold");
      const hold = fees.hold;
      c.store.mutate((w) => {
        w.holds ??= {};
        w.holds[id] = { id, caseId: c.caseId, institutionId: c.inst.id, label: hold.label, condition: hold.condition, status: "on", placedAt: w.now };
      });
      c.store.log({ actor: "university", type: "hold.placed", caseId: c.caseId, narration: `${c.inst.name}: ${hold.label}, until the first payment is credited to the student account`, data: { holdId: id } });
    }
    const scholarshipNote =
      c.enrolled.awards?.length && intentsOf(c).has("correction")
        ? " Scholarship awards are added to the fee account once the Scholarships Office has confirmed them to us. If an award is missing from your statement, please send us a copy of the award letter and we will correct the statement."
        : "";
    return {
      text: `Please find attached the fee statement (${money("GBP", inv.total)}) and a copy of the offer letter. Payment is due by ${day(inv.dueAt!, c.prof.tz)}. Please quote the Student ID ${c.enrolled.id} as the payment reference. Card payments via our portal carry a 2.5% surcharge.${fees.plans ? " Instalment plans are available on request." : ""}${scholarshipNote}`,
      attachments: [admission.id, inv.documentId],
    };
  },

  bank_details: (c) => {
    const b = c.inst.bank;
    const sent = bankLetterSent(c);
    if (sent) {
      return {
        text: `Our bank details have not changed. The only account for ${c.inst.kind === "hospital" ? "patient" : "fee"} payments is the one in our confirmation letter of ${day(sent.createdAt, c.prof.tz)}: ${b.bankName}, account name ${b.accountName}, account ${b.accountNumber}, SWIFT ${b.swift}.`,
      };
    }
    const doc = addDoc(c.store, {
      caseId: c.caseId,
      kind: "bank_letter",
      title: c.inst.kind === "hospital" ? "Bank account confirmation letter" : "University bank details confirmation",
      text: `To whom it may concern,\n\nWe confirm that ${c.inst.legalName} (trading as ${c.inst.name}) holds the following account for receiving ${c.inst.kind === "hospital" ? "international patient payments" : "student fees"}:\n  Bank: ${b.bankName}\n  Account name: ${b.accountName}\n  ${c.inst.kind === "hospital" ? "Account number" : "IBAN"}: ${b.accountNumber}\n  SWIFT: ${b.swift}\nPayments must quote the ${c.inst.referenceRule?.label ?? "reference"} in the payment reference. We never change our bank details by email.\n\nFinance Department`,
      fields: { accountName: b.accountName, accountNumber: b.accountNumber, swift: b.swift },
      origin: "institution",
    });
    return {
      text: `Our signed bank confirmation letter is attached. Please always quote the ${c.inst.referenceRule?.label ?? "reference"} in the payment reference.`,
      attachments: [doc.id],
    };
  },

  fraud_alert: (c) => ({
    text: `Thank you for alerting us. That message did not come from us: our only address for ${c.inst.kind === "hospital" ? "patient" : "student"} payment matters is ${c.inst.email}, and we never change bank details by email. Please do not pay any other account. We have reported the message to our IT security team.`,
  }),

  payment_status: (c) => {
    const cur = c.inst.bank.currency;
    const got = received(c);
    const coming = inFlight(c);
    const parts: string[] = [];
    if (got.length) parts.push(`We confirm receipt of ${got.map((p) => money(cur, p.amount)).join(" and ")} (total ${money(cur, got.reduce((s, p) => s + p.amount, 0))}).`);
    if (coming.length)
      parts.push(
        `${coming.length > 1 ? "The transfers" : `The transfer of ${money(cur, coming[0].amount)}`} you mentioned ${coming.length > 1 ? "have" : "has"} not reached our account yet. International transfers usually take about 2 working days; we will email the official receipt as soon as ${coming.length > 1 ? "they arrive" : "it arrives"}, so there is no need to check with us again.`,
      );
    if (!parts.length) parts.push("We have not received any payment for this case yet.");
    return { text: parts.join(" ") };
  },

  cash: (c) =>
    c.inst.kind === "hospital"
      ? {
          text: "Cash paid at our cashier on admission (the emergency assessment and first tests) was settled at the time and is separate from the deposits and from this bill; nothing from it is owed or refundable. Receipts were issued at the cashier, and copies can be collected from the cashier desk on the ground floor at any time. There is no need to reconcile it with us by email.",
        }
      : null,

  dispute: (c) => {
    const final = currentBill(c.invoices());
    if (!final) return { text: "The final bill has not been issued yet. If anything on it looks wrong once you receive it, please let us know and we will check it." };
    const seen = new Set<string>();
    const dupes = new Set<string>();
    const kept = final.lineItems.filter((li) => {
      if (seen.has(li.description)) {
        dupes.add(li.description);
        return false;
      }
      seen.add(li.description);
      return true;
    });
    if (dupes.size === 0) return { text: `We have reviewed bill ${final.number} line by line and found no duplicate charges.` };
    const corrected = issueInvoice(c.store, {
      caseId: c.caseId,
      institutionId: c.inst.id,
      kind: "corrected_final",
      title: "Corrected final bill",
      patientName: c.prof.subjectName,
      patientRef: final.patientRef,
      lineItems: kept.map(({ description, date, amount }) => ({ description, date, amount })),
      extraText: `Correction: duplicate line removed (${[...dupes].join(", ")}). We apologise for the error.`,
    });
    c.store.mutate((w) => {
      w.invoices[final.id].status = "superseded";
      w.invoices[final.id].supersededBy = corrected.id;
    });
    return {
      text: `You are right: ${[...dupes].join(", ")} was entered twice. The corrected final bill ${corrected.number} is attached (${money(c.inst.bank.currency, corrected.total)}).`,
      attachments: [corrected.documentId],
    };
  },

  refund: (c) => {
    const cur = c.inst.bank.currency;
    const w = c.store.world;
    const exp = w.cases[c.caseId].expectedRefund;
    if (exp) {
      return {
        text: exp.receivedAt
          ? `The refund of ${money(exp.currency, exp.amount)} was completed on ${day(exp.receivedAt, c.prof.tz)}.`
          : `The refund of ${money(exp.currency, exp.amount)} was initiated on ${day(exp.requestedAt, c.prof.tz)} to the account the deposit came from. International refunds take about 3 working days, so there is no need to request it again.`,
      };
    }
    const bill = currentBill(c.invoices());
    const paid = received(c).reduce((s, p) => s + p.amount, 0);
    if (!bill) {
      const dis = expectedDischarge(c);
      return {
        text: `Any excess deposit is refunded after the final bill is settled${dis ? `, which we expect on discharge around ${day(dis, c.prof.tz)}` : ""}. It will be returned to the account it came from; there is nothing to request before then.`,
      };
    }
    const due = Math.round((paid - bill.total) * 100) / 100;
    if (due <= 0) return { text: `Our records show no refund is due: bill ${bill.number} is ${money(cur, bill.total)} and we have received ${money(cur, paid)}.` };
    c.store.mutate((w2) => {
      w2.cases[c.caseId].expectedRefund = { amount: due, currency: cur, requestedAt: w2.now };
      // deposits already cover the bill: it is settled
      w2.invoices[bill.id].status = "paid";
    });
    schedule(c.store, { at: hoursFrom(w.now, 72), kind: "refund.credit", payload: { caseId: c.caseId }, label: `${c.inst.kind === "hospital" ? "Hospital" : "University"} refund reaches the family's account` });
    return {
      text: `Bill ${bill.number} is ${money(cur, bill.total)} and we have received ${money(cur, paid)}, so we have initiated a refund of ${money(cur, due)} to the account the deposits were sent from. International refunds take about 3 working days. Bill ${bill.number} is now settled.`,
    };
  },

  statement: (c) => {
    const cur = c.inst.bank.currency;
    const paid = received(c).reduce((s, p) => s + p.amount, 0);
    const bill = currentBill(c.invoices());
    if (bill) {
      const bal = Math.round((bill.total - paid) * 100) / 100;
      return {
        text: `The ${bill.kind === "corrected_final" ? "corrected " : ""}final bill ${bill.number} of ${day(bill.issuedAt, c.prof.tz)} is ${money(cur, bill.total)}. We have received ${money(cur, paid)}, so ${bal > 0 ? `${money(cur, bal)} remains due` : bal < 0 ? `${money(cur, -bal)} is in excess of the bill` : "the account is fully settled"}.`,
      };
    }
    if (c.inst.kind === "hospital") {
      const dis = expectedDischarge(c);
      return {
        text: `${c.prof.subjectName} is still under our care, so the final itemised bill is not ready yet. We will email it on the day of discharge${dis ? `, currently expected around ${day(dis, c.prof.tz)}` : ""}. So far we have received deposits totalling ${money(cur, paid)}. Nothing further is due before discharge unless the treatment plan changes, in which case we will write to you.`,
      };
    }
    const fs = c.invoices().find((i) => i.kind === "fee_statement");
    return { text: fs ? `Fee statement ${fs.number} (${money(cur, fs.total)}) is the current statement; we have received ${money(cur, paid)} against it.` : "No fees have been invoiced yet." };
  },

  admission: (c) => {
    if (c.inst.kind !== "university") return null;
    if (c.enrolled) return { text: `We confirm that ${c.enrolled.name} (Student ID ${c.enrolled.id}) holds an unconditional offer for ${c.enrolled.programme} starting ${c.enrolled.start}.` };
    return {
      text: `We have no applicant or student named ${c.prof.subjectName || "in your message"} in our admissions records, and no offer has been issued in that name. Our offers are only sent from @kingsgate.ac.uk addresses, we never charge "guaranteed admission", "visa guarantee", scholarship processing or other such fees, and no agent, consultant or agency collects tuition on our behalf: fees are paid only to the university's own account, quoting a Kingsgate Student ID, after a genuine offer has been accepted. The letter you describe is not from us. We recommend reporting it to the police, and we have alerted our fraud team.`,
    };
  },

  allocation: (c) => (flagOn("allocation") ? allocateHeld(c) : null),
  correction: (c) => (flagOn("entitlements") ? correctStatement(c) : null),
  arrangement: (c) => (flagOn("arrangements") ? offerPlans(c) : null),
  accept: (c) => (flagOn("arrangements") ? confirmPlan(c) : null),
};

// ---------------------------------------------------------------------------
// Fee statements and payment plans (the sandbox stand-in for the university's student finance system)

interface StudentFees {
  lineItems: { description: string; amount: number }[];
  dueInHours?: number;
  dueAt?: string;
  extraText: string;
  /** published instalment plans: shares of the statement total and due dates; the first instalment carries the fee */
  plans?: { title: string; shares: number[]; dueAt: string[]; fee: number }[];
  /** resolution flag: a hold the university keeps on the registration until the first payment is credited */
  hold?: { label: string; condition: string };
}

const STUDENT_FEES: Record<string, StudentFees> = {
  KG2601847: {
    lineItems: [
      { description: "Tuition fee 2026/27, instalment 1 of 2", amount: 14875 },
      { description: "University accommodation, Jan-Jun 2027", amount: 9800 },
    ],
    dueInHours: 18 * 24,
    extraText: "Please quote your Student ID as the payment reference.",
  },
  // the award is in the university's records but not yet on the first statement (the Scholarships Office posts awards later)
  KG2611392: {
    lineItems: [
      { description: "Tuition fee 2026/27, MSc Finance (full year)", amount: 29750 },
      { description: "University accommodation, Jan-Jun 2027", amount: 9800 },
    ],
    dueAt: "2026-12-01T12:00:00.000Z",
    extraText: "Please quote your Student ID as the payment reference. Instalment plans are available on request from the Student Finance Office.",
    plans: [
      { title: "Two-instalment plan", shares: [0.5, 0.5], dueAt: ["2026-12-01T12:00:00.000Z", "2027-03-01T12:00:00.000Z"], fee: 0 },
      { title: "Three-instalment plan", shares: [0.4, 0.3, 0.3], dueAt: ["2026-12-01T12:00:00.000Z", "2027-02-01T12:00:00.000Z", "2027-04-01T12:00:00.000Z"], fee: 150 },
    ],
    hold: {
      label: "Financial hold on registration for 2026/27",
      condition: "Lifted when the first payment (the amount requested now, or the first instalment of a confirmed plan) has been credited to the student account.",
    },
  },
};

const OFFER_DAYS = 7;
const nextArrId = (store: Store) => store.nextId("arr");

function intentsOf(c: ReplyCtx) {
  const found = new Set(detectIntents(`${c.original.subject}\n${c.original.body}`));
  if (c.original.request?.kind === "correction") found.add("correction");
  return found;
}

/** The open fee statement of this case that nothing has replaced. */
function currentStatement(c: ReplyCtx) {
  return c.invoices().find((i) => i.kind === "fee_statement" && i.status !== "superseded" && i.status !== "paid");
}

function correctStatement(c: ReplyCtx): Answer | null {
  const fees = c.enrolled ? STUDENT_FEES[c.enrolled.id] : undefined;
  if (!fees || !c.enrolled) return null;
  const fs = currentStatement(c);
  // first contact: the statement goes out with a note on how awards are added (estimate handler)
  if (!fs || fs.issuedAt === c.store.world.now) return null;
  // a deposit already paid that the statement doesn't credit: checked against the finance office's own records
  const receipts = c.original.attachments.map((id) => c.store.world.docs[id]).filter((d) => d?.kind === "deposit_receipt");
  if (receipts.length && !c.original.attachments.some((id) => c.store.world.docs[id]?.kind === "scholarship_award")) return creditDeposits(c, fs, receipts);
  const award = c.enrolled.awards?.[0];
  if (award && fs.lineItems.some((li) => li.amount < 0 && li.description.includes(award.name))) {
    return { text: `The ${award.name} is already applied to statement ${fs.number}.` };
  }
  const letters = c.original.attachments.map((id) => c.store.world.docs[id]).filter((d) => d?.kind === "scholarship_award");
  if (!letters.length) {
    return { text: "To correct a statement for a scholarship, please send us a copy of the award letter. Awards are added only against the Scholarships Office's letter." };
  }
  const pending = Object.values(c.store.world.adjustments ?? {}).filter((a) => a.caseId === c.caseId && a.invoiceId === fs.id && (a.status === "potential" || a.status === "requested"));
  const matches = award && letters.some((d) => String(d.fields.studentId) === c.enrolled!.id && Number(d.fields.amount) === award.amount);
  if (!award || !matches) {
    c.store.mutate((w) => {
      for (const a of pending) {
        const adj = w.adjustments![a.id];
        adj.status = "rejected";
        adj.history.push({ at: w.now, status: "rejected", note: "No matching award in the university's records" });
      }
    });
    return {
      text: `We have checked with the Scholarships Office: there is no award matching that letter in ${c.enrolled.name}'s records (Student ID ${c.enrolled.id}), so statement ${fs.number} stands. The Scholarships Office can be contacted at scholarships@kingsgate.ac.uk.`,
    };
  }
  const tuition = fs.lineItems.find((li) => /tuition/i.test(li.description));
  const reduction = Math.min(award.amount, tuition?.amount ?? award.amount);
  const corrected = issueInvoice(c.store, {
    caseId: c.caseId,
    institutionId: c.inst.id,
    kind: "fee_statement",
    title: "Revised fee statement",
    patientName: c.enrolled.name,
    patientRef: c.enrolled.id,
    lineItems: [...fs.lineItems.map(({ description, amount }) => ({ description, amount })), { description: `${award.name} 2026/27`, amount: -reduction }],
    ...(fs.dueAt ? { dueAt: fs.dueAt } : {}),
    extraText: `This statement replaces ${fs.number}: the ${award.name} (GBP ${reduction.toFixed(2)}) has been applied to the tuition fee. Please quote your Student ID as the payment reference.`,
  });
  const hadOffers = Object.values(c.store.world.arrangements ?? {}).some((a) => a.invoiceId === fs.id && a.status === "offered");
  c.store.mutate((w) => {
    w.invoices[fs.id].status = "superseded";
    w.invoices[fs.id].supersededBy = corrected.id;
    for (const a of pending) {
      const adj = w.adjustments![a.id];
      adj.status = "confirmed";
      adj.resolutionDocId = corrected.documentId;
      adj.history.push({ at: w.now, status: "confirmed", note: `Revised statement ${corrected.number}` });
    }
    // plans offered on the old statement no longer fit it
    for (const arr of Object.values(w.arrangements ?? {})) {
      if (arr.invoiceId === fs.id && arr.status === "offered") {
        arr.status = "expired";
        arr.history.push({ at: w.now, status: "expired", note: `Statement ${fs.number} was replaced by ${corrected.number}` });
      }
    }
  });
  const plans = hadOffers ? issueOffer(c, c.store.world.invoices[corrected.id]) : null;
  return {
    text: `Thank you for sending the award letter. You are right: the ${award.name} had not yet been applied. The revised fee statement ${corrected.number} is attached (${money("GBP", corrected.total)}, previously ${money("GBP", fs.total)}) and replaces ${fs.number}. The due date is unchanged.${plans ? ` ${plans.text}` : ""}`,
    attachments: [corrected.documentId, ...(plans?.attachments ?? [])],
  };
}

/** A revised statement crediting deposits the university's records show it received; anything else is refused. */
function creditDeposits(c: ReplyCtx, fs: Invoice, receipts: Doc[]): Answer {
  const records = c.enrolled!.deposits ?? [];
  const pending = Object.values(c.store.world.adjustments ?? {}).filter((a) => a.caseId === c.caseId && a.invoiceId === fs.id && (a.status === "potential" || a.status === "requested"));
  const credited = new Set(fs.lineItems.filter((li) => li.amount < 0 && /deposit/i.test(li.description)).map((li) => Math.round(-li.amount * 100) / 100));
  const matched = receipts
    .map((d) => ({ d, rec: records.find((r) => r.amount === Number(d.fields.amount) && r.reference === String(d.fields.reference ?? "") && String(d.fields.studentId ?? c.enrolled!.id) === c.enrolled!.id) }))
    .filter((x): x is { d: Doc; rec: { amount: number; paidAt: string; reference: string } } => !!x.rec && !credited.has(x.rec.amount));
  if (!matched.length) {
    c.store.mutate((w) => {
      for (const a of pending.filter((p) => receipts.some((r) => r.id === p.basisDocId))) {
        const adj = w.adjustments![a.id];
        adj.status = "rejected";
        adj.history.push({ at: w.now, status: "rejected", note: "No matching deposit in the university's finance records" });
      }
    });
    return { text: `We have checked our finance records for ${c.enrolled!.name} (Student ID ${c.enrolled!.id}): there is no deposit matching that receipt, or it is already credited, so statement ${fs.number} stands. If you paid a deposit, please send us the payment reference and the date it was paid.` };
  }
  const lines = matched.map(({ rec }) => ({ description: `Deposit received ${rec.paidAt.slice(0, 10)} (${rec.reference})`, amount: -rec.amount }));
  const corrected = issueInvoice(c.store, {
    caseId: c.caseId,
    institutionId: c.inst.id,
    kind: "fee_statement",
    title: "Revised fee statement",
    patientName: c.enrolled!.name,
    patientRef: c.enrolled!.id,
    lineItems: [...fs.lineItems.map(({ description, amount }) => ({ description, amount })), ...lines],
    ...(fs.dueAt ? { dueAt: fs.dueAt } : {}),
    extraText: `This statement replaces ${fs.number}: the deposit already received (${lines.map((l) => money("GBP", -l.amount)).join(", ")}) has been credited. Please quote your Student ID as the payment reference.`,
  });
  const basis = new Set(matched.map((m) => m.d.id));
  c.store.mutate((w) => {
    w.invoices[fs.id].status = "superseded";
    w.invoices[fs.id].supersededBy = corrected.id;
    for (const a of pending.filter((p) => basis.has(p.basisDocId))) {
      const adj = w.adjustments![a.id];
      adj.status = "confirmed";
      adj.resolutionDocId = corrected.documentId;
      adj.history.push({ at: w.now, status: "confirmed", note: `Revised statement ${corrected.number}` });
    }
    for (const arr of Object.values(w.arrangements ?? {})) {
      if (arr.invoiceId === fs.id && arr.status === "offered") {
        arr.status = "expired";
        arr.history.push({ at: w.now, status: "expired", note: `Statement ${fs.number} was replaced by ${corrected.number}` });
      }
    }
  });
  return {
    text: `Thank you for the receipt. You are right: the deposit had not been credited. The revised fee statement ${corrected.number} is attached (${money("GBP", corrected.total)}, previously ${money("GBP", fs.total)}) and replaces ${fs.number}. The due date is unchanged.`,
    attachments: [corrected.documentId],
  };
}

function issueOffer(c: ReplyCtx, fs: Invoice): Answer | null {
  const fees = c.enrolled ? STUDENT_FEES[c.enrolled.id] : undefined;
  if (!fees?.plans || !c.enrolled) return null;
  const now = c.store.world.now;
  const expiresAt = hoursFrom(now, OFFER_DAYS * 24);
  const plans = fees.plans.map((p) => {
    const amounts = p.shares.map((sh) => Math.round(fs.total * sh * 100) / 100);
    // rounding goes to the last instalment, so the plan adds up to the statement exactly
    amounts[amounts.length - 1] = Math.round((fs.total - amounts.slice(0, -1).reduce((x, y) => x + y, 0)) * 100) / 100;
    return { ...p, amounts };
  });
  const text = [
    `PAYMENT PLAN OFFER · Student Finance Office, Kingsgate University · ${c.inst.email}`,
    `Student: ${c.enrolled.name}   Student ID: ${c.enrolled.id}   Statement: ${fs.number} (${money("GBP", fs.total)})`,
    `This offer is open until ${expiresAt.slice(0, 10)}. A plan applies once you accept it in writing and we confirm it.`,
    "",
    ...plans.flatMap((p) => [
      `${p.title}${p.fee ? ` (administration fee ${money("GBP", p.fee)}, payable with the first instalment)` : " (no fee)"}:`,
      ...p.amounts.map((a, k) => `  ${k + 1}. ${money("GBP", a)} by ${p.dueAt[k].slice(0, 10)}`),
    ]),
    "",
    "Paying in full by the statement's due date remains available.",
  ].join("\n");
  const doc = addDoc(c.store, {
    caseId: c.caseId,
    kind: "payment_plan_offer",
    title: `Payment plan offer for ${fs.number}`,
    text,
    fields: { statement: fs.number, invoiceId: fs.id, expiresAt, plans: plans.map((p) => p.title).join("; ") },
    origin: "institution",
  });
  const ids = plans.map(() => nextArrId(c.store));
  c.store.mutate((w) => {
    w.arrangements ??= {};
    plans.forEach((p, k) => {
      const arr: Arrangement = {
        id: ids[k],
        caseId: c.caseId,
        institutionId: c.inst.id,
        invoiceId: fs.id,
        kind: "published_plan",
        title: p.title,
        status: "offered",
        instalments: p.amounts.map((amount, n) => ({ amount, dueAt: p.dueAt[n] })),
        fee: p.fee || undefined,
        currency: fs.currency,
        requestMailId: c.original.id,
        offerDocId: doc.id,
        expiresAt,
        history: [{ at: w.now, status: "offered" }],
      };
      w.arrangements![arr.id] = arr;
    });
  });
  return {
    text: `Our published instalment plans for statement ${fs.number} are attached: ${plans
      .map((p) => `the ${p.title.toLowerCase()} (${p.amounts.map((a) => money("GBP", a)).join(" + ")}${p.fee ? `, plus a ${money("GBP", p.fee)} administration fee` : ", no fee"})`)
      .join(" and ")}. The offer is open until ${day(expiresAt, c.prof.tz)}; please reply in writing to accept one.`,
    attachments: [doc.id],
  };
}

function offerPlans(c: ReplyCtx): Answer | null {
  const fees = c.enrolled ? STUDENT_FEES[c.enrolled.id] : undefined;
  if (!fees?.plans) return null;
  const fs = currentStatement(c);
  if (!fs) return null;
  const now = c.store.world.now;
  const text = `${c.original.subject}\n${c.original.body}`.toLowerCase();
  const req = c.original.request;
  const wantsExtension = req?.kind === "arrangement" ? req.arrangementKind === "extension" : /extension|extend the (deadline|due date)|defer/.test(text) && !/instal?ment|payment plan/.test(text);
  if (wantsExtension) {
    // a later deadline is a credit decision for a person at the university, never automatic
    const id = nextArrId(c.store);
    c.store.mutate((w) => {
      w.arrangements ??= {};
      w.arrangements[id] = {
        id,
        caseId: c.caseId,
        institutionId: c.inst.id,
        invoiceId: fs.id,
        kind: "extension",
        title: "Deadline extension",
        status: "requested",
        instalments: [{ amount: fs.amountDue, dueAt: hoursFrom(fs.dueAt ?? w.now, 30 * 24) }],
        currency: fs.currency,
        requestMailId: c.original.id,
        history: [{ at: w.now, status: "requested" }],
      };
    });
    return {
      text: `Deadline extensions are decided by our Credit Control team, and we have passed your request on. They usually decide within 2 working days and will write to you. Until then, the due date on statement ${fs.number} (${day(fs.dueAt ?? now, c.prof.tz)}) still applies.`,
    };
  }
  const open = Object.values(c.store.world.arrangements ?? {}).filter((a) => a.invoiceId === fs.id && a.status === "offered" && (!a.expiresAt || a.expiresAt > now));
  if (open.length) {
    return {
      text: `The instalment plans in our offer for statement ${fs.number} remain open until ${day(open[0].expiresAt!, c.prof.tz)}: ${open.map((a) => a.title.toLowerCase()).join(" and ")}. Please reply in writing to accept one.`,
    };
  }
  return issueOffer(c, fs);
}

function confirmPlan(c: ReplyCtx): Answer | null {
  const req = c.original.request;
  if (req?.kind !== "accept_arrangement") return null;
  const w = c.store.world;
  const arr = w.arrangements?.[req.arrangementId];
  if (!arr || arr.caseId !== c.caseId) return null;
  if (arr.status !== "accepted") return { text: "We could not find an open payment plan to confirm. Please contact the Student Finance Office." };
  if (arr.expiresAt && arr.acceptedAt && arr.acceptedAt > arr.expiresAt) {
    return { text: `The offer for the ${arr.title.toLowerCase()} expired on ${day(arr.expiresAt, c.prof.tz)}. Please ask us for a new offer.` };
  }
  const fs = w.invoices[arr.invoiceId];
  const fee = arr.fee ?? 0;
  const doc = addDoc(c.store, {
    caseId: c.caseId,
    kind: "payment_plan_offer",
    title: `Payment plan confirmation: ${arr.title}`,
    text: [
      `PAYMENT PLAN CONFIRMATION · Student Finance Office, Kingsgate University · ${c.inst.email}`,
      `Student: ${c.enrolled?.name}   Student ID: ${c.enrolled?.id}   Statement: ${fs.number} (${money("GBP", fs.total)})`,
      `We confirm the ${arr.title.toLowerCase()} accepted on ${(arr.acceptedAt ?? w.now).slice(0, 10)}. These due dates replace the statement's single due date:`,
      ...arr.instalments.map((ins, k) => `  ${k + 1}. ${money("GBP", ins.amount + (k === 0 ? fee : 0))} by ${ins.dueAt.slice(0, 10)}${k === 0 && fee ? ` (includes the ${money("GBP", fee)} administration fee)` : ""}`),
      "Please quote the Student ID as the payment reference for every instalment.",
    ].join("\n"),
    fields: { arrangementId: arr.id, statement: fs.number, instalments: arr.instalments.length },
    origin: "institution",
  });
  c.store.mutate((w2) => {
    const a = w2.arrangements![arr.id];
    a.confirmationDocId = doc.id;
    a.history.push({ at: w2.now, status: "accepted", note: "Confirmed by the university" });
    // the plan's administration fee is charged to the fee account, so the statement now owes it too
    if (fee > 0) {
      const inv = w2.invoices[arr.invoiceId];
      inv.lineItems.push({ id: `${inv.id}_li${inv.lineItems.length + 1}`, description: `${arr.title} administration fee`, amount: fee });
      inv.total = Math.round((inv.total + fee) * 100) / 100;
      inv.amountDue = Math.round((inv.amountDue + fee) * 100) / 100;
    }
    for (const other of Object.values(w2.arrangements!)) {
      if (other.id !== arr.id && other.invoiceId === arr.invoiceId && other.status === "offered") {
        other.status = "declined";
        other.history.push({ at: w2.now, status: "declined", note: `Not chosen: the family accepted the ${arr.title.toLowerCase()}` });
      }
    }
  });
  // the confirmed plan becomes a calendar: a reminder a week before each later instalment
  arr.instalments.slice(1).forEach((ins, k) => {
    schedule(c.store, { at: hoursFrom(ins.dueAt, -7 * 24), kind: "plan.instalment_due", payload: { caseId: c.caseId, arrangementId: arr.id, instalment: k + 2 }, label: `Instalment ${k + 2} of the ${arr.title.toLowerCase()} is due in a week` });
  });
  const first = arr.instalments[0];
  return {
    text: `We confirm the ${arr.title.toLowerCase()} for statement ${fs.number}. The confirmation with the new due dates is attached; the first instalment of ${money("GBP", first.amount + fee)} is due by ${day(first.dueAt, c.prof.tz)}.`,
    attachments: [doc.id],
  };
}


/** Remittance advice for money the university's bank received but its finance system couldn't match. */
function allocateHeld(c: ReplyCtx): Answer | null {
  const held = Object.values(c.store.world.payments).filter((p) => p.caseId === c.caseId && p.allocation?.status === "unallocated");
  if (!held.length || !c.enrolled) return null;
  const advice = `${c.original.subject} ${c.original.body}`;
  if (!advice.includes(c.enrolled.id)) return { text: "To allocate the payment we need the Student ID in the remittance advice, together with the payer's name, the amount and the date it was sent." };
  const account = c.enrolled.id;
  const receipts = held.map((p) =>
    addDoc(c.store, {
      caseId: c.caseId,
      kind: "receipt",
      title: `Receipt: ${p.currency} ${p.amount.toLocaleString()}`,
      text: [`${c.inst.name}`, "OFFICIAL RECEIPT", `Received with thanks ${money(p.currency, p.amount)}`, `Reference: ${p.reference}`, "Method: International bank transfer", `Credited to student account ${account} after remittance advice`].join("\n"),
      fields: { amount: p.amount, currency: p.currency, reference: p.reference, account },
      origin: "institution",
    }),
  );
  c.store.mutate((w) => {
    for (const p of held) w.payments[p.id].allocation = { status: "allocated", at: w.now, account, note: "Allocated after the remittance advice" };
  });
  c.store.log({ actor: "university", type: "payment.allocated", caseId: c.caseId, narration: `${c.inst.name} credited ${held.map((p) => money(p.currency, p.amount)).join(" and ")} to the student's account`, data: { paymentIds: held.map((p) => p.id), account } });
  const lifted = liftHolds(c.store, c.caseId);
  return {
    text: `Thank you for the remittance advice. ${held.map((p) => money(p.currency, p.amount)).join(" and ")} ${held.length > 1 ? "have" : "has"} now been credited to student account ${account}, and the official receipt is attached.${lifted?.sentence ?? ""}`,
    attachments: [...receipts.map((r) => r.id), ...(lifted ? [lifted.docId] : [])],
  };
}
