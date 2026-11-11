// The bank's checks on an institution known only from a bill the family uploaded. Each is a separate
// question with its own evidence: a genuine institution doesn't prove the account is its own, and neither
// proves this bill is authentic. Payments open only when all three are confirmed (flag "verification").
// Pure: used by the server (the gateway and the bank's workbench) and by the app.
import type { Institution, VerificationCheck, VerificationCheckId } from "./types";

export interface CheckSpec {
  id: VerificationCheckId;
  question: string;
  /** the evidence a reviewer may confirm it on; nothing else counts */
  methods: { id: string; label: string }[];
  /** what the family can usually supply if the reviewer needs more */
  askFamily: string;
}

export const VERIFICATION_CHECKS: CheckSpec[] = [
  {
    id: "institution",
    question: "Is the institution genuine?",
    methods: [
      { id: "official_register", label: "Found in the official register (health ministry or education regulator)" },
      { id: "published_contact", label: "Called the number on its official website, not the one on the bill" },
    ],
    askFamily: "the admission or appointment letter, and the institution's website address",
  },
  {
    id: "account",
    question: "Does this bank account belong to it?",
    methods: [
      { id: "account_name_check", label: "Account-name check with the receiving bank (pre-validation)" },
      { id: "institution_letter", label: "Bank letter confirmed through the institution's published contact" },
    ],
    askFamily: "a letter from the institution with its bank details, or a page from its official website that shows them",
  },
  {
    id: "invoice",
    question: "Is this bill authentic?",
    methods: [
      { id: "billing_office", label: "Confirmed by the institution's billing office" },
      { id: "matches_record", label: "Matches the admission or treatment record the family supplied" },
    ],
    askFamily: "the original bill as the institution sent it (the email or the portal page)",
  },
];

/** The Director's sandbox shortcut: confirms every check at once, and says so in the log. */
export const SANDBOX_METHOD = "sandbox_director";

export const checkSpec = (id: VerificationCheckId) => VERIFICATION_CHECKS.find((c) => c.id === id)!;

export function checksOf(inst: Institution): { spec: CheckSpec; state: VerificationCheck }[] {
  return VERIFICATION_CHECKS.map((spec) => ({ spec, state: inst.verification?.[spec.id] ?? { status: "open" } }));
}

/** All three confirmed: the bank has verified the institution, its account and the bill. */
export const allConfirmed = (inst: Institution) => checksOf(inst).every((c) => c.state.status === "confirmed");
