// The plan workflow: what the family really owes, whether they can carry it, and the payment terms the
// institution has agreed to. One shared model for the affordability planner, payment arrangements, bill
// review and plan mandates, so there is one source of truth and the engine (not the model) does the maths.
import type { Currency } from "../types";

/** Money the family expects in or out, entered by the family themselves. CarryPay sees no bank account. */
export interface FundingProfile {
  caseId: string;
  /** the person whose money this is; the payer of the plan */
  ownerPersonId: string;
  /** home currency (PKR, CNY): everything below is in it */
  currency: Currency;
  /** money available now, by account or pot */
  balances: { label: string; amount: number }[];
  /** salary and other regular income; everyMonths = 1 for a monthly salary, absent for a one-off */
  income: {
    label: string;
    amount: number;
    firstAt: string;
    everyMonths?: number;
    /** every payment of it due on or after `from` arrives `days` late (a Director stress test in the sandbox) */
    late?: { from: string; days: number };
  }[];
  /** household costs that must be covered every month whatever happens (rent, food, school, loans) */
  essentialsMonthly: number;
  /** the family's chosen safety net: the plan should never take the balance below it */
  reserveFloor: number;
  /** money that may come but isn't certain (a reimbursement, a refund, a bonus); only "confirmed" counts by default */
  conditional: { label: string; amount: number; expectedAt: string; status: "expected" | "confirmed" }[];
  enteredBy: string;
  updatedAt: string;
}

/** A change to what is owed, backed by a document. The three money states are never added together. */
export interface Adjustment {
  id: string;
  caseId: string;
  invoiceId: string;
  /** reduction in the invoice currency */
  amount: number;
  currency: Currency;
  /** the document that entitles the family to it (scholarship award, accepted fee schedule, credit note) */
  basisDocId: string;
  reason: string;
  /**
   * potential: CarryPay's review found it · requested: asked the institution to correct the bill ·
   * confirmed: the institution issued a corrected bill · credited: money actually refunded or set off ·
   * rejected: the institution said no, with its reason
   */
  status: "potential" | "requested" | "confirmed" | "credited" | "rejected";
  requestMailId?: string;
  /** the institution's corrected invoice or written decision */
  resolutionDocId?: string;
  history: { at: string; status: Adjustment["status"]; note?: string }[];
}

export interface Instalment {
  amount: number;
  dueAt: string;
}

/**
 * Payment terms from the institution. Only an institution document moves an arrangement to "offered"
 * or "accepted"-and-confirmed; an email asking for an extension never changes a deadline by itself.
 */
export interface Arrangement {
  id: string;
  caseId: string;
  institutionId: string;
  /** the invoice whose amount this schedule replaces */
  invoiceId: string;
  kind: "published_plan" | "extension" | "deposit_reduction";
  /** the institution's own name for it, e.g. "Three-instalment plan" */
  title: string;
  status: "requested" | "offered" | "accepted" | "declined" | "expired";
  instalments: Instalment[];
  /** administration fee in the invoice currency, payable with the first instalment */
  fee?: number;
  currency: Currency;
  requestMailId?: string;
  /** the institution's offer (doc kind payment_plan_offer) */
  offerDocId?: string;
  expiresAt?: string;
  acceptedBy?: string;
  acceptedAt?: string;
  /** the institution's confirmation of the accepted plan: only this changes the due dates */
  confirmationDocId?: string;
  history: { at: string; status: Arrangement["status"]; note?: string }[];
}

/** One signed approval for a bounded series of payments. Anything outside it pauses and asks the payer again. */
export interface PlanMandate {
  id: string;
  caseId: string;
  arrangementId: string;
  payerId: string;
  institutionId: string;
  beneficiary: { accountName: string; accountNumber: string; swift: string; bankName: string };
  currency: Currency;
  /** each payment at most this much (invoice currency) */
  perInstalmentCap: number;
  /** all payments together at most this much (invoice currency) */
  totalCap: number;
  /** a payment may only be made inside one of these windows */
  windows: { from: string; to: string; instalment: number; /** exactly this amount (invoice currency) */ amount: number }[];
  /** home currency: no payment may take the projected balance below this */
  reserveFloor: number;
  status: "awaiting_approval" | "active" | "paused" | "revoked" | "completed";
  approvalId?: string;
  /** SHA-256 of the canonical mandate terms, signed with the payer's passkey */
  digest?: string;
  pausedReason?: string;
  history: { at: string; status: PlanMandate["status"]; note?: string }[];
}

/** Explicit what-ifs, never probabilities. */
export interface Stress {
  /** every salary or other income arrives this many days late */
  incomeDelayDays?: number;
  /** the foreign currency costs this much more (0.05 = 5%) */
  fxShockPct?: number;
  /** bills not yet paid go up by this much (0.05 = 5%) */
  costIncreasePct?: number;
  /** conditional money (refunds, reimbursements) arrives this many days late */
  conditionalDelayDays?: number;
  /** count "expected" conditional money as if it were certain (default false) */
  countExpectedConditional?: boolean;
}

export interface NamedStress {
  id: string;
  label: string;
  stress: Stress;
}
