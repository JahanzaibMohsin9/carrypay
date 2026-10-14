// Core domain types shared by the server (agent, mock world) and the UI.

export type Currency = "USD" | "PKR" | "THB" | "GBP" | "CNY";
export type Lang = "en" | "ur" | "zh";

export type CaseType = "medical" | "tuition";
export type CorridorId = "PK-TH" | "CN-GB" | "PK-GB";

export type Route = "bank_transfer" | "card_payment" | "atm_cash" | "carried_cash";

export type Actor = "family" | "agent" | "hospital" | "university" | "bank" | "card" | "system" | "director" | "gateway";

export interface Person {
  id: string;
  name: string;
  role: "patient" | "attendant" | "student" | "parent" | "sponsor";
  adult: boolean;
  /** Has this person already left the home country? (carried cash is no longer possible) */
  abroad: boolean;
  /** FX already bought by bank this calendar year, before the case (USD) */
  priorFxYearUSD?: number;
  /** identity document number for regulatory forms (sandbox values); never shown to the LLM */
  passport?: string;
}

export interface Institution {
  id: string;
  kind: "hospital" | "university";
  name: string; // trading name shown to people
  /** universities: applicants with a genuine offer (the sandbox stand-in for the admissions system) */
  students?: { id: string; name: string; programme: string; start: string }[];
  legalName: string; // name on the bank account
  country: string;
  city: string;
  email: string; // verified contact address
  emailDomain: string;
  bank: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    swift: string;
    currency: Currency;
  };
  /** Payment reference requirements enforced by the receiving bank. */
  referenceRule?: { label: string; pattern: string };
  acceptsCards: boolean;
  cardSurchargePct?: number;
}

export interface LineItem {
  id: string;
  description: string;
  date?: string;
  amount: number;
}

export type InvoiceKind = "estimate" | "deposit_request" | "interim" | "final" | "fee_statement" | "corrected_final";

export interface Invoice {
  id: string;
  caseId: string;
  institutionId: string;
  kind: InvoiceKind;
  number: string;
  currency: Currency;
  lineItems: LineItem[];
  total: number;
  /** Amount requested now (deposit / top-up). Defaults to total. */
  amountDue: number;
  dueAt?: string; // sim time ISO
  issuedAt: string;
  documentId: string;
  /** Reference the receiving bank needs, e.g. patient hospital number */
  patientRef?: string;
  status: "open" | "paid" | "superseded" | "disputed";
  supersededBy?: string;
}

export type PaymentStatus =
  | "awaiting_approval"
  | "approved"
  | "submitted"
  | "processing"
  | "completed"
  | "returned"
  | "rejected"
  | "cancelled";

export interface CostBreakdown {
  route: Route;
  /** amount to deliver in destination currency */
  deliverAmount: number;
  deliverCurrency: Currency;
  sourceCurrency: Currency;
  midRate: number; // source per 1 unit of destination
  fxMarkupPct: number;
  fxMarkupCost: number; // source currency
  fees: { label: string; amount: number }[]; // source currency
  taxes: { label: string; amount: number; ruleId?: string }[]; // source currency
  totalSource: number;
  totalUSD: number;
  arrivesInHours: number;
}

export interface Payment {
  id: string;
  caseId: string;
  invoiceId: string;
  institutionId: string;
  route: Route;
  amount: number;
  currency: Currency;
  payerId: string; // person funding it
  reference: string;
  beneficiary: { accountName: string; accountNumber: string; swift: string; bankName: string };
  cost: CostBreakdown;
  rationale: string;
  status: PaymentStatus;
  statusHistory: { at: string; status: PaymentStatus; note?: string }[];
  approvalId?: string;
  createdAt: string;
  completedAt?: string;
  returnReason?: string;
  attempts: number;
}

export interface Approval {
  id: string;
  caseId: string;
  paymentId: string;
  requestedAt: string;
  decidedAt?: string;
  decision?: "approved" | "declined";
  method?: "passkey" | "hold";
  summary: string;
}

export interface Mail {
  id: string;
  caseId: string;
  direction: "inbound" | "outbound";
  from: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  at: string;
  attachments: string[]; // document ids
  read: boolean;
  /** set by the security layer when the sender is not a verified contact */
  unverifiedSender?: boolean;
  /** for institution replies: the email this answers, and the topics it answered */
  inReplyTo?: string;
  topics?: string[];
}

export type DocumentKind =
  | "invoice"
  | "bank_letter"
  | "remittance_application"
  | "self_declaration"
  | "fx_purchase_application"
  | "admission_letter"
  | "receipt"
  | "other";

export interface Doc {
  id: string;
  caseId: string;
  kind: DocumentKind;
  title: string;
  /** text as the agent/OCR would see it (untrusted when from outside) */
  text: string;
  fields: Record<string, string | number>;
  origin: "institution" | "agent" | "family" | "bank" | "unknown";
  createdAt: string;
}

export interface FamilyMessage {
  id: string;
  caseId: string;
  from: "family" | "agent";
  text: string;
  at: string;
  importance?: "info" | "action" | "good_news" | "warning";
}

export interface SecurityEvent {
  id: string;
  caseId?: string;
  at: string;
  severity: "info" | "warning" | "critical";
  kind:
    | "blocked_unverified_beneficiary"
    | "blocked_limit"
    | "blocked_forbidden"
    | "blocked_kill_switch"
    | "blocked_recipient"
    | "suspicious_message"
    | "approval_required"
    | "validation_failed";
  title: string;
  detail: string;
  ruleIds?: string[];
}

export interface CaseNote {
  at: string;
  text: string;
}

export interface CaseFile {
  id: string;
  type: CaseType;
  corridor: CorridorId;
  title: string;
  lang: Lang;
  people: Person[];
  institutionId: string;
  openedAt: string;
  status: "active" | "closed";
  /** What the family told the agent when opening the case */
  brief: string;
  notes: CaseNote[];
  /** payment that counts against the medical/education allowance etc. */
  expectedRefund?: { amount: number; currency: Currency; requestedAt: string; receivedAt?: string };
}

export interface CardAccount {
  personId: string;
  label: string; // e.g. "Visa debit •• 4821"
  annualUsedUSD: number; // before this case
  currency: Currency;
}

export interface ScheduledItem {
  id: string;
  at: string;
  kind: string;
  payload: Record<string, unknown>;
  label: string;
}

/** live = the LLM decides; replay = decisions replayed from a recorded live run; scripted = hand-written demo plan (no AI) */
export type AgentMode = "live" | "replay" | "scripted";

export interface AgentState {
  status: "idle" | "working" | "stopped";
  mode: AgentMode;
  killSwitch: boolean;
  currentCaseId?: string;
  lastError?: string;
  runs: number;
  /** exactly what the LLM was sent at its last wake-up, after the privacy firewall (for the Security Centre) */
  lastPrompt?: { at: string; caseId: string; text: string; withheld: Record<string, number> };
}

export interface World {
  scenarioId: string;
  now: string; // simulated time
  startedAt: string;
  cases: Record<string, CaseFile>;
  institutions: Record<string, Institution>;
  invoices: Record<string, Invoice>;
  payments: Record<string, Payment>;
  approvals: Record<string, Approval>;
  mail: Record<string, Mail>;
  docs: Record<string, Doc>;
  messages: FamilyMessage[];
  security: SecurityEvent[];
  cards: CardAccount[];
  schedule: ScheduledItem[];
  agent: AgentState;
  autoReply: boolean;
  /** director's chaos mode: faults injected into the outside world, each consumed when it fires */
  chaos?: { bankOutage?: boolean; cardDecline?: boolean; silentUntil?: string };
  /** director: advance the clock automatically whenever the agent is idle */
  autoplay: boolean;
  counters: Record<string, number>;
}

/** One hash-chained entry in the tamper-evident activity log. */
export interface LedgerEntry {
  seq: number;
  at: string; // wall clock
  simAt: string; // simulated clock
  actor: Actor;
  type: string;
  caseId?: string;
  /** plain-language line shown in the activity feed */
  narration?: string;
  data: Record<string, unknown>;
  prevHash: string;
  hash: string;
}
