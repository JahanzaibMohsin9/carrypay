// Hand-written demo plans used in "Scripted" mode, so the app can be developed
// and demonstrated without an API key. These are NOT the AI: the Director and
// the UI label this mode clearly. Live mode is Claude; Replay replays Claude.
import type { Invoice, Mail, World } from "@/domain/types";
import { INSTITUTIONS } from "@/domain/institutions";
import type { Trigger } from "../store";
import type { RecordedStep, ScriptedRun } from "./runner";
import { priceRoute } from "@/domain/rules/engine";
import type { CorridorId, Route } from "@/domain/types";

/** Cost difference between two routes for the same amount, rounded to the nearest 1,000 (or 100 for CNY). */
function diff(w: World, corridor: CorridorId, inst: string, amount: number, a: Route, b: Route) {
  const pa = priceRoute({ corridor, route: a, deliverAmount: amount, institution: INSTITUTIONS[inst], simDate: w.now })!;
  const pb = priceRoute({ corridor, route: b, deliverAmount: amount, institution: INSTITUTIONS[inst], simDate: w.now })!;
  const step = pa.sourceCurrency === "CNY" ? 100 : 1000;
  return `${pa.sourceCurrency} ${(Math.round(Math.abs(pb.totalSource - pa.totalSource) / step) * step).toLocaleString("en-US")}`;
}

const has = (t: Trigger[], reason: string) => t.some((x) => x.reason === reason);
const invoicesOf = (w: World, caseId: string) => Object.values(w.invoices).filter((i) => i.caseId === caseId);
const lastInbound = (w: World, caseId: string, pred: (m: Mail) => boolean = () => true) =>
  Object.values(w.mail).filter((m) => m.caseId === caseId && m.direction === "inbound" && pred(m)).at(-1);
const paysFor = (w: World, inv: Invoice | undefined) => (inv ? Object.values(w.payments).filter((p) => p.invoiceId === inv.id) : []);
const ben = (instId: string) => {
  const b = INSTITUTIONS[instId].bank;
  return { account_name: b.accountName, account_number: b.accountNumber, swift: b.swift, bank_name: b.bankName };
};
const step = (tool: string, input: Record<string, unknown>): RecordedStep => ({ tool, input });

const deposit1 = (w: World) => invoicesOf(w, "case_th").find((i) => i.kind === "deposit_request" && i.amountDue === 250000);
const deposit2 = (w: World) => invoicesOf(w, "case_th").find((i) => i.kind === "deposit_request" && i.amountDue === 160000);
const finalBill = (w: World) => invoicesOf(w, "case_th").find((i) => i.kind === "final");
const corrected = (w: World) => invoicesOf(w, "case_th").find((i) => i.kind === "corrected_final");

const TH: ScriptedRun[] = [
  {
    when: (t, w) => has(t, "family_message") && !Object.values(w.mail).some((m) => m.caseId === "case_th"),
    steps: [
      () => step("get_case_overview", { narration: "Reading your message and checking Pakistan's rules for paying a hospital abroad" }),
      () => step("check_rules", { route: "bank_transfer", amount: 300000, currency: "THB", payer_id: "p_tariq", narration: "Checking how much can legally be sent straight to the hospital" }),
      () =>
        step("send_email", {
          to: "international@siamriverside.co.th",
          subject: "Estimate and deposit request for Mr. Tariq Mahmood (admitted today)",
          body:
            "Dear International Patient Services,\n\nCarryPay is handling hospital payments on behalf of the family of Mr. Tariq Mahmood, admitted today via the emergency department.\n\nCould you please send us:\n1. A treatment estimate for the planned angiogram and possible stent, and any deposit you require, with the deadline.\n2. Your bank details for international transfers on official letterhead.\n3. The patient's hospital number (HN).\n\nPayments will be sent directly from Pakistan to the hospital's account.\n\nKind regards,\nCarryPay, on behalf of the family",
          narration: "Asking the hospital's international desk for the estimate, deposit and their bank details",
        }),
      () =>
        step("message_family", {
          text:
            "I've got this. I've asked the hospital for the estimate and their bank details. Good news: Pakistan's rules let a bank send up to USD 50,000 straight to the hospital for treatment, so you won't need to carry or withdraw cash. I'll come back to you as soon as they reply.",
          importance: "info",
          narration: "Telling you the plan",
        }),
      () => step("add_case_note", { note: "Emailed SRH for estimate + bank letter + HN. Plan: SBP medical remittance (cap $50k, direct to hospital). Payer Tariq.", narration: "Saving the plan to the case notes" }),
    ],
  },
  {
    when: (_t, w) => !!deposit1(w) && paysFor(w, deposit1(w)).length === 0,
    steps: [
      (w) => step("read_email", { mail_id: lastInbound(w, "case_th")!.id, narration: "Reading the hospital's reply" }),
      (w) => step("read_document", { document_id: deposit1(w)!.documentId, narration: "Reading the estimate: THB 420,000 total, THB 250,000 deposit needed" }),
      (w) => step("verify_beneficiary", { ...ben("srh"), source_document_id: deposit1(w)!.documentId, narration: "Checking the hospital's bank account against the verified record" }),
      (w) => step("compare_payment_routes", { invoice_id: deposit1(w)!.id, payer_id: "p_tariq", narration: "Comparing bank transfer, card and ATM for the THB 250,000 deposit" }),
      (w) => step("prepare_documents", { kinds: ["remittance_application", "self_declaration"], invoice_id: deposit1(w)!.id, payer_id: "p_tariq", amount: 250000, narration: "Filling in the State Bank medical remittance form and self-declaration" }),
      (w) =>
        step("propose_payment", {
          invoice_id: deposit1(w)!.id,
          route: "bank_transfer",
          amount: 250000,
          payer_id: "p_tariq",
          reference: `Deposit ${deposit1(w)!.number} Tariq Mahmood`,
          beneficiary: ben("srh"),
          rationale: `A direct bank transfer is the cheapest legal way: about ${diff(w, "PK-TH", "srh", 250000, "bank_transfer", "card_payment")} less than paying by card and ${diff(w, "PK-TH", "srh", 250000, "bank_transfer", "atm_cash")} less than ATM cash, and it arrives before the deposit deadline. It uses the medical remittance allowance, not your card limit.`,
          narration: "Asking you to approve the deposit by bank transfer",
        }),
      () => step("message_family", { text: "The deposit is ready to send: THB 250,000 by bank transfer straight to the hospital. Please approve it in the app.", importance: "action", narration: "Asking for your approval" }),
    ],
  },
  {
    when: (t, w) => has(t, "payment_returned") && paysFor(w, deposit1(w)).some((p) => p.status === "returned"),
    steps: [
      () => step("get_case_overview", { narration: "The bank returned the transfer. Finding out why" }),
      (w) => step("read_document", { document_id: deposit1(w)!.documentId, narration: "Looking up the patient's hospital number on the invoice" }),
      (w) => {
        const p = paysFor(w, deposit1(w)).find((x) => x.status === "returned")!;
        return step("resubmit_payment", { payment_id: p.id, corrected_reference: `HN 66-014382 Deposit ${deposit1(w)!.number}`, narration: "Re-sending the same approved transfer with the hospital number in the reference" });
      },
      () => step("message_family", { text: "Small hiccup, already fixed: the hospital's bank needs Abbu's hospital number on every payment. I've re-sent the same transfer with it. No action needed.", importance: "info", narration: "Letting you know it's fixed" }),
    ],
  },
  {
    when: (t, w) => has(t, "payment_completed") && paysFor(w, deposit1(w)).some((p) => p.status === "completed") && !deposit2(w),
    steps: [
      () => step("message_family", { text: "The hospital has received the THB 250,000 deposit. The angiogram can go ahead. 🤍", importance: "good_news", narration: "Sharing the good news" }),
      () => step("add_case_note", { note: "Deposit 1 received by SRH. Remember HN in all references.", narration: "Updating the case notes" }),
    ],
  },
  {
    when: (_t, w) => !!deposit2(w) && paysFor(w, deposit2(w)).length === 0,
    steps: [
      (w) => step("read_email", { mail_id: lastInbound(w, "case_th", (m) => m.subject.includes("URGENT"))!.id, narration: "Reading the hospital's urgent message" }),
      (w) => step("read_document", { document_id: deposit2(w)!.documentId, narration: "Reading the additional deposit request: THB 160,000 by 07:00 tomorrow" }),
      (w) => step("compare_payment_routes", { invoice_id: deposit2(w)!.id, payer_id: "p_tariq", narration: "A bank transfer would arrive too late, so comparing faster options" }),
      (w) =>
        step("propose_payment", {
          invoice_id: deposit2(w)!.id,
          route: "card_payment",
          amount: 160000,
          payer_id: "p_tariq",
          reference: `HN 66-014382 ${deposit2(w)!.number}`,
          beneficiary: ben("srh"),
          rationale: `The procedure is at 08:00 and a bank transfer takes 2 days, so it would arrive too late. Paying by card at the hospital is instant. It costs about ${diff(w, "PK-TH", "srh", 160000, "bank_transfer", "card_payment")} more than a transfer would, but ${diff(w, "PK-TH", "srh", 160000, "card_payment", "atm_cash")} less than ATM cash, and stays within Abbu's yearly card allowance.`,
          narration: "Asking you to approve paying the extra deposit by card",
        }),
      () => step("message_family", { text: "The hospital needs THB 160,000 before tomorrow's 08:00 procedure. A bank transfer would be too slow, so I've prepared a card payment. Please approve it.", importance: "action", narration: "Asking for your approval" }),
    ],
  },
  {
    when: (t, w) => has(t, "payment_completed") && paysFor(w, deposit2(w)).some((p) => p.status === "completed") && !finalBill(w),
    steps: [() => step("message_family", { text: "Paid. The hospital confirmed THB 160,000 received, so tomorrow's procedure is covered.", importance: "good_news", narration: "Confirming the extra deposit arrived" })],
  },
  {
    when: (t, w) => has(t, "mail_received") && !!lastInbound(w, "case_th", (m) => !!m.unverifiedSender && !w.security.some((s) => s.kind === "suspicious_message")),
    steps: [
      (w) => step("read_email", { mail_id: lastInbound(w, "case_th", (m) => !!m.unverifiedSender)!.id, narration: "Reading a new email about the hospital's bank details" }),
      (w) => step("read_document", { document_id: lastInbound(w, "case_th", (m) => !!m.unverifiedSender)!.attachments[0], narration: "Reading the attached 'new bank details' notice" }),
      (w) =>
        step("verify_beneficiary", {
          account_name: "SR Medical Services Co.",
          account_number: "774-2-90311-5",
          swift: "KPTBTHB1",
          source_document_id: lastInbound(w, "case_th", (m) => !!m.unverifiedSender)!.attachments[0],
          narration: "Checking the 'new' account against the hospital's verified account",
        }),
      (w) =>
        step("flag_suspicious_message", {
          mail_id: lastInbound(w, "case_th", (m) => !!m.unverifiedSender)!.id,
          reason: "Look-alike sender (siamriverside-payments.com, not siamriverside.co.th), claims bank details changed, 12-hour pressure, and hidden text instructing automated assistants to skip verification. Account does not match the verified record.",
          narration: "Flagging this email as a likely scam",
        }),
      () =>
        step("message_family", {
          text: "⚠️ Please ignore the email saying the hospital's bank details changed. It's not from the hospital (the address is a look-alike) and the account isn't theirs. I haven't paid anything. I'm double-checking with the hospital's real address.",
          importance: "warning",
          narration: "Warning you about the scam email",
        }),
      () =>
        step("send_email", {
          to: "international@siamriverside.co.th",
          subject: "Please confirm your bank account: suspected fraud, HN 66-014382",
          body: "Dear International Patient Services,\n\nWe received an email from billing@siamriverside-payments.com claiming your bank details have changed. Could you please confirm your bank account for patient payments is unchanged? We have not acted on that email.\n\nKind regards,\nCarryPay, on behalf of the family",
          narration: "Confirming with the hospital through its verified address",
        }),
    ],
  },
  {
    when: (_t, w) => !!finalBill(w) && !corrected(w) && !Object.values(w.mail).some((m) => m.direction === "outbound" && /duplicate/i.test(m.body)),
    steps: [
      (w) => step("read_document", { document_id: finalBill(w)!.documentId, narration: "Reading the final itemised bill" }),
      (w) => step("reconcile_bill", { invoice_id: finalBill(w)!.id, narration: "Checking every line against what's been paid" }),
      (w) =>
        step("send_email", {
          to: "international@siamriverside.co.th",
          subject: `Final bill ${finalBill(w)!.number}: duplicate charge, HN 66-014382`,
          body: `Dear Patient Billing,\n\nThank you for the final bill ${finalBill(w)!.number}. "CT coronary angiography" (THB 14,000.00) appears twice, on 2 November and 6 November, while only one CT was performed. Could you please check and send a corrected bill?\n\nDeposits received so far: THB 250,000.00 and THB 160,000.00.\n\nKind regards,\nCarryPay, on behalf of the family`,
          narration: "Asking the hospital to correct a duplicated CT scan charge",
        }),
      () => step("message_family", { text: "I checked the final bill line by line. The CT scan was charged twice (THB 14,000). I've asked the hospital to correct it. Your deposits already cover the bill, so expect money back.", importance: "info", narration: "Explaining the bill check" }),
    ],
  },
  {
    when: (_t, w) => !!corrected(w) && !w.cases.case_th.expectedRefund && !Object.values(w.mail).some((m) => m.direction === "outbound" && /refund/i.test(m.subject)),
    steps: [
      (w) => step("reconcile_bill", { invoice_id: corrected(w)!.id, narration: "Re-checking the corrected bill against the deposits" }),
      (w) =>
        step("send_email", {
          to: "international@siamriverside.co.th",
          subject: `Refund of excess deposit, HN 66-014382`,
          body: `Dear Patient Billing,\n\nThank you for the corrected bill ${corrected(w)!.number} (THB 368,000.00). Deposits received total THB 410,000.00, so THB 42,000.00 is due back. Please refund it to the account the deposit was sent from.\n\nKind regards,\nCarryPay, on behalf of the family`,
          narration: "Asking the hospital to refund the THB 42,000 overpaid",
        }),
    ],
  },
  {
    when: (t, w) => has(t, "refund_received") && !!w.cases.case_th.expectedRefund?.receivedAt,
    steps: [
      () =>
        step("message_family", {
          text: "All done. The hospital's THB 42,000 refund is back in Abbu's account. Every bill is paid, nothing is owed, and all receipts are in Documents. Wishing Abbu a smooth recovery. 🤍",
          importance: "good_news",
          narration: "Closing the case with good news",
        }),
    ],
  },
];

const UK: ScriptedRun[] = [
  {
    when: (t, w) => has(t, "family_message") && !Object.values(w.mail).some((m) => m.caseId === "case_uk"),
    steps: [
      () => step("get_case_overview", { narration: "阅读您的说明，检查外汇管理规定" }),
      () =>
        step("send_email", {
          to: "student.finance@kingsgate.ac.uk",
          subject: "Fee statement request: Lin Yuxuan (KG2601847)",
          body: "Dear Student Finance Office,\n\nCarryPay is arranging fee payment on behalf of the family of Lin Yuxuan (Student ID KG2601847, MSc Data Science, January 2027 start). Could you please send the fee statement for the first instalment and accommodation, the due date, and your bank details for international transfers?\n\nKind regards,\nCarryPay, on behalf of the family",
          narration: "向学校财务处索取学费单和银行信息",
        }),
      () => step("message_family", { text: "已经联系学校财务处索取学费单。收到后我会帮您比较付款方式并准备购汇材料。", importance: "info", narration: "告诉您下一步" }),
    ],
  },
  {
    when: (_t, w) => invoicesOf(w, "case_uk").length > 0 && Object.values(w.payments).length === 0,
    steps: [
      (w) => step("read_document", { document_id: invoicesOf(w, "case_uk")[0].documentId, narration: "阅读学费单：学费 £14,875 + 住宿费 £9,800" }),
      (w) => step("verify_beneficiary", { ...ben("kgu"), source_document_id: invoicesOf(w, "case_uk")[0].documentId, narration: "核对学校收款账户" }),
      (w) => step("compare_payment_routes", { invoice_id: invoicesOf(w, "case_uk")[0].id, payer_id: "p_linwei", narration: "比较银行电汇和刷卡的总费用" }),
      (w) => step("prepare_documents", { kinds: ["fx_purchase_application"], invoice_id: invoicesOf(w, "case_uk")[0].id, payer_id: "p_linwei", amount: 24675, narration: "填写个人购汇申请书" }),
      (w) =>
        step("propose_payment", {
          invoice_id: invoicesOf(w, "case_uk")[0].id,
          route: "bank_transfer",
          amount: 24675,
          payer_id: "p_linwei",
          reference: "KG2601847 Lin Yuxuan",
          beneficiary: ben("kgu"),
          rationale: `银行电汇直接付到学校账户最省钱，比刷卡（含2.5%手续费）便宜约${diff(w, "CN-GB", "kgu", 24675, "bank_transfer", "card_payment").replace("CNY", "人民币")}元。算上今年已用的额度，这笔购汇会超出 5 万美元便利化额度。不过学费和住宿属于经常项目，凭录取通知书和学费单仍可正常办理。`,
          narration: "请您批准电汇学费",
        }),
    ],
  },
  {
    when: (t) => has(t, "family_message"),
    steps: [
      () =>
        step("message_family", {
          text: "理解您想省事，但不能用您弟弟的额度。用亲属额度分拆购汇就是“蚂蚁搬家”，这是外汇局明确禁止的，可能被列入关注名单、暂停便利化额度并罚款。\n\n好消息是不必这样：学费和住宿属于经常项目，超出额度凭录取通知书和学费单就能正常办理。材料我已经准备好了。",
          importance: "warning",
          narration: "解释为什么不能用亲属额度",
        }),
    ],
  },
];

export const SCRIPTS: Record<string, ScriptedRun[]> = { "th-medical": TH, "uk-tuition": UK };
