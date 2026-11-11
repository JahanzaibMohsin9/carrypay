"use client";

import { Activity, CircleAlert, CircleCheck } from "lucide-react";
import { corridorOf } from "@/domain/corridors";
import { midRate } from "@/domain/market";
import { projectCashflow } from "@/domain/plan/cashflow";
import { mandateReserve } from "@/domain/plan/mandate";
import type { CaseFile, World } from "@/domain/types";
import { dateTime, money } from "@/lib/format";

/**
 * The bank's view of the payer's safety net under a plan mandate: the gateway's reserve check run now, and any
 * sandbox stress test in force (a late salary, a dearer currency). Same engine, same world as the family's Plan tab.
 */
export function OfficerStress({ w, c, tz, planOn }: { w: World; c: CaseFile; tz: string; planOn: boolean }) {
  const funding = w.funding?.[c.id];
  const tests = (w.stressTests ?? []).filter((t) => t.caseId === c.id);
  const mandate = Object.values(w.mandates ?? {}).filter((m) => m.caseId === c.id && m.status !== "revoked" && m.status !== "awaiting_approval").at(-1);
  if (!planOn || !funding || (!tests.length && !mandate)) return null;
  const check = mandate ? mandateReserve(w, mandate) : projectCashflow(w, c.id);
  if (!check) return null;
  const cur = check.currency;
  const dest = w.institutions[c.institutionId].bank.currency;
  const home = corridorOf(c.corridor).sourceCurrency;
  const breach = check.firstBreach;

  return (
    <div className="min-w-0 space-y-1.5 rounded-xl border border-[#2a3441] bg-[#16202b] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8193a8]">Payer&apos;s safety net{mandate ? ` · plan mandate ${mandate.id} (${mandate.status})` : ""}</p>
      <div className="flex items-start gap-2 text-[12px]">
        {breach ? <CircleAlert size={13} className="mt-[2px] shrink-0 text-[#fbbf6b]" /> : <CircleCheck size={13} className="mt-[2px] shrink-0 text-[#6ee7a8]" />}
        <span className="min-w-0 flex-1">
          {breach
            ? `Reserve check fails: the payer's balance would fall ${money(breach.shortBy, cur)} below their ${money(check.reserveFloor, cur)} safety net on ${dateTime(breach.at, tz)}.${mandate?.status === "active" ? " The next instalment under the mandate will pause for the payer's own approval." : ""}`
            : `Reserve check holds: lowest point ${money(check.lowest.balance, cur)}, ${money(check.lowest.headroom, cur)} above the ${money(check.reserveFloor, cur)} safety net.`}
        </span>
      </div>
      {tests.map((t) => (
        <div key={t.id} className="flex items-start gap-2 text-[12px]">
          <Activity size={13} className="mt-[2px] shrink-0 text-[#fbbf6b]" />
          <span className="min-w-0 flex-1">
            Sandbox stress test: {t.label} ·{" "}
            {t.kind === "salary_late"
              ? t.moved?.map((m) => `${m.label} now ${dateTime(m.to, tz)} (was ${dateTime(m.from, tz)})`).join("; ")
              : t.rate && `1 ${t.rate.currency} = ${t.rate.homeCurrency} ${t.rate.after.toFixed(4)} (was ${t.rate.before.toFixed(4)})`}
            <span className="block text-[11px] text-[#8193a8]">Applied {dateTime(t.at, tz)} by the Director</span>
          </span>
        </div>
      ))}
      {w.fxShocks?.length ? (
        <div className="flex justify-between gap-3 text-[12px]">
          <span className="shrink-0 text-[#8193a8]">Sandbox mid rate now</span>
          <span className="min-w-0 truncate text-right font-mono">
            1 {dest} = {home} {midRate(home, dest, w.now, w.fxShocks).toFixed(4)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
