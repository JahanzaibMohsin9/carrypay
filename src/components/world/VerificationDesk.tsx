"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, CircleDashed, CircleX, ShieldQuestion } from "lucide-react";
import { post } from "@/lib/client";
import { cn, dateTime } from "@/lib/format";
import { checksOf, SANDBOX_METHOD, type CheckSpec } from "@/domain/verification";
import type { Institution, VerificationCheck, World } from "@/domain/types";

// The bank reviewer's workbench for an institution known only from the family's uploaded bill (flag
// "verification"). Three separate checks, each confirmed on named evidence, sent back to the family for
// more, or rejected with a reason. Payments open only when all three are confirmed: the gateway enforces
// it, this only records the reviewer's decisions. Styled like the rest of the officer desk.

export function VerificationDesk({ w, inst, tz }: { w: World; inst: Institution; tz: string }) {
  const checks = checksOf(inst);
  const bill = Object.values(w.invoices).find((i) => i.institutionId === inst.id);
  const done = checks.filter((c) => c.state.status === "confirmed").length;
  return (
    <div className="rounded-xl border border-[#2a3441] bg-[#16202b]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#2a3441] px-3 py-2.5">
        <ShieldQuestion size={15} className="text-[#7fb3ff]" />
        <span className="text-[13px] font-semibold text-white">Verification queue · {inst.name}</span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold", inst.verifiedAt ? "bg-[#163626] text-[#6ee7a8]" : "bg-[#3a2c14] text-[#fbbf6b]")}>
          {inst.verifiedAt ? "Verified: payments open" : `${done} of 3 checks confirmed`}
        </span>
      </div>
      <div className="space-y-1.5 p-3 text-[12px]">
        <p className="text-[#8193a8]">
          From the family&apos;s uploaded bill{bill ? ` ${bill.number}` : ""}: {inst.legalName} · {inst.bank.bankName} · <span className="font-mono">{inst.bank.accountNumber}</span> · {inst.bank.swift}. Each check stands on its own: a genuine institution doesn&apos;t prove the account is its own, and neither proves the bill is authentic.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 px-3 pb-3 md:grid-cols-3">
        {checks.map(({ spec, state }) => (
          <CheckCard key={spec.id} inst={inst} spec={spec} state={state} tz={tz} />
        ))}
      </div>
    </div>
  );
}

const STATUS: Record<VerificationCheck["status"], { label: string; tone: string; icon: React.ReactNode }> = {
  open: { label: "To review", tone: "text-[#b9c6d4]", icon: <CircleDashed size={13} /> },
  requested: { label: "Waiting for the family", tone: "text-[#fbbf6b]", icon: <CircleAlert size={13} /> },
  confirmed: { label: "Confirmed", tone: "text-[#6ee7a8]", icon: <CircleCheck size={13} /> },
  rejected: { label: "Rejected", tone: "text-[#ff8a80]", icon: <CircleX size={13} /> },
};

function CheckCard({ inst, spec, state, tz }: { inst: Institution; spec: CheckSpec; state: VerificationCheck; tz: string }) {
  const [method, setMethod] = useState(spec.methods[0].id);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"request" | "reject" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = STATUS[state.status];
  const methodLabel = state.method === SANDBOX_METHOD ? "Director's sandbox shortcut" : spec.methods.find((m) => m.id === state.method)?.label;

  const send = async (action: "confirm" | "request" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      await post("/api/verification", { institutionId: inst.id, check: spec.id, action, method: action === "confirm" ? method : undefined, note: action === "confirm" ? undefined : note });
      setMode(null);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-[#2a3441] p-2.5 text-[12px]">
      <p className="font-semibold text-white">{spec.question}</p>
      <p className={cn("flex items-center gap-1.5 font-semibold", s.tone)}>
        {s.icon} {s.label}
        {state.at && <span className="font-normal text-[#8193a8]">· {dateTime(state.at, tz)}</span>}
      </p>
      {state.status === "confirmed" && methodLabel && <p className="text-[#b9c6d4]">On: {methodLabel}</p>}
      {state.note && <p className="text-[#b9c6d4]">{state.status === "rejected" ? "Reason" : "Asked for"}: {state.note}</p>}
      {state.status !== "confirmed" && (
        <div className="space-y-1.5 border-t border-[#2a3441] pt-2">
          <label className="block text-[11px] text-[#8193a8]" htmlFor={`m-${spec.id}`}>
            Confirmed on
          </label>
          <select id={`m-${spec.id}`} value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-md border border-[#2a3441] bg-[#0b1016] px-2 py-1.5 text-[12px] text-[#d7e0ea]">
            {spec.methods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-1.5">
            <button disabled={busy} onClick={() => send("confirm")} className="rounded-md bg-[#163626] px-2.5 py-1 font-semibold text-[#6ee7a8] hover:bg-[#1d4630] disabled:opacity-50">
              Confirm
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setMode(mode === "request" ? null : "request");
                setNote(`Please upload ${spec.askFamily}.`);
              }}
              className="rounded-md bg-[#22303e] px-2.5 py-1 font-semibold text-[#b9c6d4] hover:bg-[#2a3a4b] disabled:opacity-50"
            >
              Ask the family
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setMode(mode === "reject" ? null : "reject");
                setNote("");
              }}
              className="rounded-md bg-[#3a1c1c] px-2.5 py-1 font-semibold text-[#ff8a80] hover:bg-[#4a2424] disabled:opacity-50"
            >
              Reject
            </button>
          </div>
          {mode && (
            <div className="space-y-1.5">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={400}
                placeholder={mode === "reject" ? "Why it fails (the family and CarryPay see this)" : "What the family should upload"}
                aria-label={mode === "reject" ? "Reason for rejection" : "What the family should upload"}
                className="w-full rounded-md border border-[#2a3441] bg-[#0b1016] px-2 py-1.5 text-[12px] text-[#d7e0ea]"
              />
              <button disabled={busy} onClick={() => send(mode)} className="rounded-md bg-[#22303e] px-2.5 py-1 font-semibold text-white hover:bg-[#2a3a4b] disabled:opacity-50">
                {mode === "reject" ? "Reject this check" : "Send the request"}
              </button>
            </div>
          )}
          {error && <p className="text-[#ff8a80]">{error}</p>}
        </div>
      )}
    </div>
  );
}
