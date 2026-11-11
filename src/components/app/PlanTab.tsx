"use client";

import { AlertTriangle, CalendarClock, Check, CircleDashed, FileCheck2, Fingerprint, Info, ShieldCheck, Sparkles, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { post, useCarry } from "@/lib/client";
import { passkeysSupported, signMandateWithPasskey } from "@/lib/passkey";
import { useT } from "@/lib/i18n";
import { useViewer } from "@/lib/viewer";
import { activeCase, caseTz } from "@/lib/selectors";
import { cn, dayLabel, money } from "@/lib/format";
import { compareSchedules, DEFAULT_STRESSES, projectCashflow, type Projection, type Schedule, type ScheduleOption } from "@/domain/plan/cashflow";
import type { Arrangement, FundingProfile, PlanMandate } from "@/domain/plan/types";
import type { CaseFile, Lang, World } from "@/domain/types";
import { Badge, Button, Card, Empty, SectionTitle } from "../ui";

// The family's plan: can they carry everything they owe without going below the safety net they chose?
// Every number here comes from the same engine functions the agent uses (src/domain/plan).

// Urdu isn't written for this tab: it falls back to English.
const S = {
  en: {
    title: "Can you carry this year?",
    keeps: "Keeps your safety net",
    keepsSub: "Even with a late salary or a dearer currency",
    keepsBase: "In the normal case",
    dips: (amt: string, date: string) => `Goes ${amt} below your safety net on ${date}`,
    noFigures: "No figures yet",
    noFiguresHint: "The person who pays enters their money, income and essentials, so CarryPay can check what they can carry.",
    chart: "Your money over time",
    reserve: "Safety net",
    today: "Today",
    ways: "Ways to pay",
    pick: "CarryPay's pick",
    total: "Total cost",
    fees: "of it fees",
    lowest: "Lowest point",
    aboveNet: "above your safety net",
    belowNet: "below your safety net",
    holds: "Holds",
    dipsShort: "Dips below",
    accept: "Accept this plan",
    decline: "Decline",
    onlyPayer: (name: string) => `Only ${name}, who pays, can accept a plan.`,
    awaiting: "Accepted. The university still has to confirm it in writing; until then the original due date applies.",
    confirmed: "Confirmed by the university",
    instalments: "Instalments",
    paid: "Paid",
    due: "Due",
    quota: (y: number) => `${y} FX quota`,
    above: "Above quota: needs proof of the expense",
    billCheck: "Bill check",
    states: { potential: "Possible", requested: "Asked to correct", confirmed: "Confirmed", credited: "Credited", rejected: "Not accepted" },
    notSaved: "Only money the university has taken off the bill counts. A possible reduction is not a saving.",
    figures: "Your figures",
    figuresNote: "Entered by you. CarryPay never sees your bank account.",
    available: "Money available",
    income: "Income",
    monthly: "each month",
    essentials: "Essentials each month",
    netLabel: "Safety net (never go below)",
    expected: "expected, not counted until confirmed",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    how: "How CarryPay worked this out",
    expires: (d: string) => `Offer open until ${d}`,
    payInFull: "Pay the statement in full",
    current: "As things stand",
    mandate: "One signature for the rest of the plan",
    mandateWhat: "Each instalment exactly, in its window, only to the university's verified account, and only while your safety net holds. Anything different and CarryPay asks you first.",
    mandateStates: { awaiting_approval: "Waiting for your signature", active: "Signed", paused: "Paused", revoked: "Revoked", completed: "Done" },
    until: (d: string) => `by ${d}`,
    signPasskey: "Sign with fingerprint",
    signHold: "Sign",
    revoke: "Revoke",
    onlyPayerSign: (name: string) => `Only ${name}, who pays, can sign. Anyone on the case can revoke it.`,
    pausedBecause: "Paused because:",
  },
  // TODO zh: whole block to MiMo review
  zh: {
    title: "这一年的费用，家里承担得了吗？",
    keeps: "应急储备不受影响",
    keepsSub: "即使工资晚到或汇率上涨",
    keepsBase: "正常情况下",
    dips: (amt: string, date: string) => `${date}会比应急储备少 ${amt}`,
    noFigures: "还没有填写家庭收支",
    noFiguresHint: "由付款人填写可用资金、收入和必要开支，CarryPay 才能核算家里能承担多少。",
    chart: "资金变化",
    reserve: "应急储备",
    today: "今天",
    ways: "付款方式",
    pick: "CarryPay 推荐",
    total: "总费用",
    fees: "其中手续费",
    lowest: "最低点",
    aboveNet: "高于应急储备",
    belowNet: "低于应急储备",
    holds: "守住",
    dipsShort: "低于储备",
    accept: "接受此方案",
    decline: "不接受",
    onlyPayer: (name: string) => `只有付款人 ${name} 可以接受付款方案。`,
    awaiting: "已接受。学校还需书面确认；确认之前，原截止日期仍然有效。",
    confirmed: "学校已确认",
    instalments: "分期",
    paid: "已付",
    due: "到期",
    quota: (y: number) => `${y} 年购汇额度`,
    above: "超出额度：需提供真实用途证明",
    billCheck: "账单核对",
    states: { potential: "可能减免", requested: "已请学校更正", confirmed: "已确认", credited: "已入账", rejected: "未获同意" },
    notSaved: "只有学校已从账单中扣除的金额才算节省。可能的减免不算节省。",
    figures: "家庭收支",
    figuresNote: "由您本人填写。CarryPay 不会查看您的银行账户。",
    available: "可用资金",
    income: "收入",
    monthly: "每月",
    essentials: "每月必要开支",
    netLabel: "应急储备（不能低于）",
    expected: "预计收入，确认前不计入",
    edit: "修改",
    save: "保存",
    cancel: "取消",
    how: "CarryPay 是怎么算的",
    expires: (d: string) => `方案有效期至 ${d}`,
    payInFull: "一次性付清",
    current: "目前的安排",
    mandate: "一次签字，完成剩余分期",
    mandateWhat: "每期金额完全一致、在规定时间内、只付到学校已核实的账户，并且不影响您的应急储备。有任何不同，CarryPay 都会先问您。",
    mandateStates: { awaiting_approval: "等待您签字", active: "已签字", paused: "已暂停", revoked: "已撤销", completed: "已完成" },
    until: (d: string) => `${d}前`,
    signPasskey: "用指纹签字",
    signHold: "签字",
    revoke: "撤销",
    onlyPayerSign: (name: string) => `只有付款人 ${name} 可以签字。案件中的任何人都可以撤销。`,
    pausedBecause: "暂停原因：",
  },
};
type Strings = (typeof S)["en"];
const strings = (lang: Lang): Strings => (lang === "zh" ? S.zh : S.en);

export function PlanTab() {
  const { state } = useCarry();
  const { lang } = useT();
  const c = state ? activeCase(state) : undefined;
  const viewer = useViewer(c);
  if (!state || !c) return null;
  const w = state.world;
  const s = strings(lang);
  const funding = w.funding?.[c.id];
  const payerId = funding?.ownerPersonId;
  const payerName = c.people.find((p) => p.id === payerId)?.name ?? "";

  if (!state.flags?.plan) return null;
  return (
    <div className="space-y-6 px-4 pb-10 pt-4">
      {funding ? <Affordability w={w} c={c} s={s} lang={lang} viewer={viewer} payerId={payerId!} payerName={payerName} hasPasskey={state.passkeys.length > 0 && passkeysSupported()} /> : (
        <Card>
          <Empty icon={<CalendarClock size={20} />} title={s.noFigures} hint={s.noFiguresHint} />
        </Card>
      )}
      <BillCheck w={w} c={c} s={s} />
      {funding && <Figures key={funding.updatedAt} c={c} s={s} f={funding} canEdit={viewer === funding.ownerPersonId} />}
    </div>
  );
}

function Affordability({ w, c, s, lang, viewer, payerId, payerName, hasPasskey }: { w: World; c: CaseFile; s: Strings; lang: Lang; viewer?: string; payerId: string; payerName: string; hasPasskey: boolean }) {
  const tz = caseTz(c);
  const arrangements = Object.values(w.arrangements ?? {}).filter((a) => a.caseId === c.id);
  const confirmed = arrangements.find((a) => a.status === "accepted" && a.confirmationDocId);
  const awaiting = arrangements.find((a) => a.status === "accepted" && !a.confirmationDocId);
  const offers = arrangements.filter((a) => a.status === "offered" && (!a.expiresAt || a.expiresAt > w.now));

  const options: ScheduleOption[] = useMemo(
    () => (confirmed || awaiting || !offers.length ? [] : [{ id: "full", label: s.payInFull, schedule: "upfront" as Schedule }, ...offers.map((a) => ({ id: a.id, label: a.title, schedule: a as Schedule }))]),
    [confirmed, awaiting, offers, s.payInFull],
  );
  const cmp = useMemo(() => (options.length > 1 ? compareSchedules(w, c.id, options, DEFAULT_STRESSES) : undefined), [w, c.id, options]);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const selectedId = chosen && options.some((o) => o.id === chosen) ? chosen : cmp?.pickId;
  const selected = options.find((o) => o.id === selectedId);
  const projection = useMemo(() => projectCashflow(w, c.id, selected ? { schedule: selected.schedule } : {}), [w, c.id, selected]);
  const stressed = useMemo(() => DEFAULT_STRESSES.map((st) => projectCashflow(w, c.id, { schedule: selected?.schedule, stress: st.stress })), [w, c.id, selected]);
  if (!projection) return null;
  const holdsAll = !projection.firstBreach && stressed.every((p) => !p?.firstBreach);
  const cur = projection.currency;

  return (
    <>
      <section>
        <SectionTitle>{s.title}</SectionTitle>
        <Card className="p-4">
          <Verdict p={projection} holdsAll={holdsAll} s={s} tz={tz} lang={lang} />
          <BalanceChart p={projection} s={s} tz={tz} lang={lang} />
          <p className="mt-2 text-[12px] text-ink-3">{selected ? selected.label : confirmed ? `${confirmed.title} · ${s.confirmed}` : s.current}</p>
        </Card>
      </section>

      {awaiting && (
        <Card className="flex items-start gap-3 p-4 text-[13px] text-ink-2">
          <CircleDashed size={18} className="mt-0.5 shrink-0 text-amber-strong" aria-hidden />
          <span>
            <b className="text-ink">{awaiting.title}</b> · {s.awaiting}
          </span>
        </Card>
      )}

      {cmp && (
        <section>
          <SectionTitle>{s.ways}</SectionTitle>
          <div className="space-y-3">
            {cmp.rows.map((r) => {
              const offer = offers.find((a) => a.id === r.id);
              return (
                <Card key={r.id} className={cn("p-4", r.id === selectedId && "ring-2 ring-brand")} onClick={() => setChosen(r.id)} role="button" aria-pressed={r.id === selectedId}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-ink">{r.label}</div>
                      {offer?.expiresAt && <div className="text-[12px] text-ink-3">{s.expires(dayLabel(offer.expiresAt, tz, lang))}</div>}
                    </div>
                    {r.id === cmp.pickId && (
                      <Badge tone="brand" icon={<Sparkles size={12} aria-hidden />}>
                        {s.pick}
                      </Badge>
                    )}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                    <dt className="text-ink-3">{s.total}</dt>
                    <dd className="num text-right font-semibold text-ink">
                      {money(r.totalHomeCost, cur)}
                      {r.feesHomeCost > 0 && <span className="block text-[11px] font-normal text-ink-3">{money(r.feesHomeCost, cur)} {s.fees}</span>}
                    </dd>
                    <dt className="text-ink-3">{s.lowest}</dt>
                    <dd className="num text-right text-ink">
                      {money(Math.abs(r.lowestHeadroom), cur)} {r.lowestHeadroom >= 0 ? s.aboveNet : s.belowNet}
                    </dd>
                  </dl>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    <StressChip ok={!r.firstBreach} label={s.keepsBase} s={s} />
                    {r.stress.map((x) => (
                      <StressChip key={x.id} ok={x.holds} label={stressLabel(x.id, lang, x.label)} s={s} />
                    ))}
                  </ul>
                  {offer && (
                    <OfferActions offer={offer} s={s} viewer={viewer} payerId={payerId} payerName={payerName} />
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {Object.values(w.mandates ?? {})
        .filter((m) => m.caseId === c.id && m.status !== "revoked")
        .slice(-1)
        .map((m) => (
          <MandateCard key={m.id} m={m} s={s} tz={tz} lang={lang} viewer={viewer} payerName={payerName} hasPasskey={hasPasskey} />
        ))}

      <Instalments p={projection} w={w} c={c} s={s} tz={tz} lang={lang} />

      <details className="rounded-[var(--radius)] border border-line bg-surface px-4 py-3 text-[13px] text-ink-2">
        <summary className="cursor-pointer font-semibold text-ink">{s.how}</summary>
        <ul className="mt-2 list-disc space-y-1 ps-5">
          {projection.assumptions.map((a) => (
            <li key={a.id}>{a.text}</li>
          ))}
          {DEFAULT_STRESSES.map((st) => (
            <li key={st.id}>{stressLabel(st.id, lang, st.label)}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

const stressLabel = (id: string, lang: Lang, fallback: string) =>
  lang === "zh" ? ({ salary_late: "工资晚到三周", fx_5: "外币贵 5%" } as Record<string, string>)[id] ?? fallback : fallback; // TODO zh

function StressChip({ ok, label, s }: { ok: boolean; label: string; s: Strings }) {
  return (
    <li>
      <Badge tone={ok ? "success" : "amber"} icon={ok ? <Check size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}>
        {label}: {ok ? s.holds : s.dipsShort}
      </Badge>
    </li>
  );
}

function Verdict({ p, holdsAll, s, tz, lang }: { p: Projection; holdsAll: boolean; s: Strings; tz: string; lang: Lang }) {
  if (p.firstBreach) {
    return (
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-strong" aria-hidden />
        <div>
          <div className="font-semibold text-ink">{s.dips(money(p.firstBreach.shortBy, p.currency), dayLabel(p.firstBreach.at, tz, lang))}</div>
          <div className="text-[13px] text-ink-3">
            {s.reserve}: {money(p.reserveFloor, p.currency)}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <ShieldCheck size={20} className="mt-0.5 shrink-0 text-success" aria-hidden />
      <div>
        <div className="font-semibold text-ink">{s.keeps}</div>
        <div className="text-[13px] text-ink-3">{holdsAll ? s.keepsSub : s.keepsBase}</div>
      </div>
    </div>
  );
}

/** Step line of the payer's balance, with the safety net as a reference line and payments as markers. */
function BalanceChart({ p, s, tz, lang }: { p: Projection; s: Strings; tz: string; lang: Lang }) {
  const W = 340;
  const H = 150;
  const pad = { l: 8, r: 8, t: 10, b: 20 };
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const t0 = Date.parse(p.from);
  const t1 = Date.parse(p.until);
  const maxB = Math.max(p.reserveFloor, ...p.points.map((x) => x.balance)) * 1.08;
  const minB = Math.min(0, ...p.points.map((x) => x.balance));
  const x = (iso: string) => pad.l + ((Date.parse(iso) - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - minB) / Math.max(1, maxB - minB)) * (H - pad.t - pad.b);
  // step-after: the balance holds until the next event
  let d = `M ${x(p.points[0].at)} ${y(p.points[0].balance)}`;
  for (let i = 1; i < p.points.length; i++) d += ` H ${x(p.points[i].at)} V ${y(p.points[i].balance)}`;
  d += ` H ${x(p.until)}`;
  const months: string[] = [];
  for (let dt = new Date(Date.UTC(new Date(p.from).getUTCFullYear(), new Date(p.from).getUTCMonth() + 1, 1)); dt.getTime() <= t1; dt.setUTCMonth(dt.getUTCMonth() + 1)) months.push(dt.toISOString());
  const pays = p.points.filter((q) => q.kind === "payment");
  const hp = hover !== null ? p.points[hover] : undefined;

  const onMove = (e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 0; i < p.points.length; i++) if (Math.abs(x(p.points[i].at) - px) < Math.abs(x(p.points[best].at) - px)) best = i;
    setHover(best);
  };

  return (
    <figure className="relative mt-4">
      <figcaption className="mb-1 text-[12px] font-semibold text-ink-3">{s.chart}</figcaption>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`${s.chart}. ${s.reserve} ${money(p.reserveFloor, p.currency)}. ${s.lowest} ${money(p.lowest.balance, p.currency)}.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {months.map((m) => (
          <g key={m}>
            <line x1={x(m)} x2={x(m)} y1={pad.t} y2={H - pad.b} className="stroke-line" strokeWidth={1} />
            <text x={x(m) + 2} y={H - 6} className="fill-ink-3 text-[9px]">
              {new Date(m).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-GB", { month: "short", timeZone: "UTC" })}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(p.reserveFloor)} y2={y(p.reserveFloor)} className="stroke-ink-3" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={W - pad.r} y={y(p.reserveFloor) - 4} textAnchor="end" className="fill-ink-2 text-[10px] font-semibold">
          {s.reserve}
        </text>
        <path d={d} fill="none" className="stroke-brand" strokeWidth={2} strokeLinejoin="round" />
        {pays.map((q) => (
          <circle key={q.at + q.label} cx={x(q.at)} cy={y(q.balance)} r={4} className={cn("stroke-surface", q.balance < p.reserveFloor ? "fill-amber" : "fill-brand")} strokeWidth={2} />
        ))}
        {p.firstBreach && (
          <g>
            <circle cx={x(p.firstBreach.at)} cy={y(p.firstBreach.balance)} r={6} className="fill-none stroke-amber-strong" strokeWidth={2} />
          </g>
        )}
        {hp && (
          <g>
            <line x1={x(hp.at)} x2={x(hp.at)} y1={pad.t} y2={H - pad.b} className="stroke-ink-3" strokeWidth={1} />
            <circle cx={x(hp.at)} cy={y(hp.balance)} r={4} className="fill-surface stroke-ink" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-6 z-10 max-w-[60%] rounded-lg border border-line bg-surface px-2 py-1 text-[11px] shadow-card"
          style={{ left: `${Math.min(70, Math.max(0, (x(hp.at) / W) * 100 - 15))}%` }}
        >
          <div className="text-ink-3">{dayLabel(hp.at, tz, lang)}</div>
          <div className="text-ink">{hp.kind === "start" ? s.today : hp.label}</div>
          <div className="num font-semibold text-ink">{money(hp.balance, p.currency)}</div>
        </div>
      )}
    </figure>
  );
}

function Instalments({ p, w, c, s, tz, lang }: { p: Projection; w: World; c: CaseFile; s: Strings; tz: string; lang: Lang }) {
  const paid = Object.values(w.payments).filter((x) => x.caseId === c.id && x.status === "completed");
  if (!p.payments.length && !paid.length) return null;
  return (
    <section>
      <SectionTitle>{s.instalments}</SectionTitle>
      <Card className="divide-y divide-line">
        {paid.map((x) => (
          <div key={x.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[13px]">
            <span className="flex items-center gap-2 text-ink">
              <Check size={16} className="text-success" aria-hidden /> {s.paid} · {dayLabel(x.completedAt ?? x.createdAt, tz, lang)}
            </span>
            <span className="num font-semibold text-ink">{money(x.amount, x.currency)}</span>
          </div>
        ))}
        {p.payments.map((x) => {
          const above = x.evaluation.warnings.some((wn) => wn.ruleId === "CN.FX.ABOVE_QUOTA_CURRENT");
          return (
            <div key={x.obligation.id} className="px-4 py-3 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink">
                  {x.obligation.label} · {s.due} {dayLabel(x.obligation.dueAt, tz, lang)}
                </span>
                <span className="num font-semibold text-ink">{money(x.deliverAmount, x.obligation.currency)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
                <span className="num">≈ {money(x.homeCost, x.cost.sourceCurrency)}</span>
                {c.corridor.startsWith("CN") && <Badge>{s.quota(x.quotaYear)}</Badge>}
                {above && <Badge tone="info" icon={<Info size={12} aria-hidden />}>{s.above}</Badge>}
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-ink-3">
                {x.evaluation.requiredDocs.map((dc) => (
                  <span key={dc.kind} className="inline-flex items-center gap-1">
                    <FileCheck2 size={12} aria-hidden /> {dc.label}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </Card>
    </section>
  );
}

function OfferActions({ offer, s, viewer, payerId, payerName }: { offer: Arrangement; s: Strings; viewer?: string; payerId: string; payerName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: "accept" | "decline") => {
    setBusy(true);
    setError(null);
    try {
      await post("/api/plan", { action: "decide", arrangementId: offer.id, decision, personId: viewer });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const isPayer = viewer === payerId;
  return (
    <div className="mt-4" onClick={(e) => e.stopPropagation()}>
      {isPayer ? (
        <div className="flex gap-2">
          <Button className="flex-1" disabled={busy} onClick={() => decide("accept")}>
            {s.accept}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => decide("decline")} aria-label={s.decline}>
            <X size={16} aria-hidden />
          </Button>
        </div>
      ) : (
        <p className="text-[12px] text-ink-3">{s.onlyPayer(payerName)}</p>
      )}
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

function BillCheck({ w, c, s }: { w: World; c: CaseFile; s: Strings }) {
  const adjustments = Object.values(w.adjustments ?? {}).filter((a) => a.caseId === c.id);
  if (!adjustments.length) return null;
  return (
    <section>
      <SectionTitle>{s.billCheck}</SectionTitle>
      <Card className="divide-y divide-line">
        {adjustments.map((a) => {
          const doc = w.docs[a.basisDocId];
          const tone = a.status === "confirmed" || a.status === "credited" ? "success" : a.status === "rejected" ? "danger" : "amber";
          return (
            <div key={a.id} className="px-4 py-3 text-[13px]">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-ink">{String(doc?.fields.award ?? doc?.title ?? "")}</span>
                <span className="num font-semibold text-ink">−{money(a.amount, a.currency)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Badge tone={tone}>{s.states[a.status]}</Badge>
                {doc && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
                    <FileCheck2 size={12} aria-hidden /> {doc.title}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <p className="px-4 py-3 text-[12px] text-ink-3">{s.notSaved}</p>
      </Card>
    </section>
  );
}

function Figures({ c, s, f, canEdit }: { c: CaseFile; s: Strings; f: FundingProfile; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => ({
    balances: f.balances.map((b) => b.amount),
    income: f.income.map((i) => i.amount),
    essentials: f.essentialsMonthly,
    reserve: f.reserveFloor,
  }));
  const [error, setError] = useState<string | null>(null);
  const cur = f.currency;
  const save = async () => {
    setError(null);
    try {
      await post("/api/plan", {
        action: "funding",
        caseId: c.id,
        personId: f.ownerPersonId,
        funding: {
          balances: f.balances.map((b, i) => ({ label: b.label, amount: draft.balances[i] })),
          income: f.income.map((x, i) => ({ label: x.label, amount: draft.income[i], firstAt: x.firstAt, everyMonths: x.everyMonths })),
          essentialsMonthly: draft.essentials,
          reserveFloor: draft.reserve,
          conditional: f.conditional,
        },
      });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const num = (v: number, set: (n: number) => void, label: string) =>
    editing ? (
      <input type="number" inputMode="numeric" min={0} aria-label={label} className="num w-32 rounded-lg border border-line-strong bg-surface px-2 py-1 text-right text-ink" value={v} onChange={(e) => set(Number(e.target.value) || 0)} />
    ) : (
      <span className="num font-semibold text-ink">{money(v, cur)}</span>
    );
  const entered = c.people.find((p) => p.id === f.enteredBy)?.name;
  return (
    <section>
      <SectionTitle action={canEdit && !editing ? <Button size="sm" variant="soft" onClick={() => setEditing(true)}>{s.edit}</Button> : undefined}>{s.figures}</SectionTitle>
      <Card className="divide-y divide-line text-[13px]">
        {f.balances.map((b, i) => (
          <Row key={b.label} label={`${s.available} · ${b.label}`}>
            {num(draft.balances[i], (n) => setDraft((d) => ({ ...d, balances: d.balances.map((x, k) => (k === i ? n : x)) })), b.label)}
          </Row>
        ))}
        {f.income.map((x, i) => (
          <Row key={x.label} label={`${s.income} · ${x.label}${x.everyMonths === 1 ? ` (${s.monthly})` : ""}`}>
            {num(draft.income[i], (n) => setDraft((d) => ({ ...d, income: d.income.map((y, k) => (k === i ? n : y)) })), x.label)}
          </Row>
        ))}
        <Row label={s.essentials}>{num(draft.essentials, (n) => setDraft((d) => ({ ...d, essentials: n })), s.essentials)}</Row>
        <Row label={s.netLabel}>{num(draft.reserve, (n) => setDraft((d) => ({ ...d, reserve: n })), s.netLabel)}</Row>
        {f.conditional.map((x) => (
          <Row key={x.label} label={`${x.label} (${x.status === "confirmed" ? s.income : s.expected})`}>
            <span className="num text-ink-3">{money(x.amount, cur)}</span>
          </Row>
        ))}
        <div className="px-4 py-3 text-[12px] text-ink-3">
          {s.figuresNote}
          {entered ? ` · ${entered}` : ""}
        </div>
        {editing && (
          <div className="flex justify-end gap-2 px-4 py-3">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {s.cancel}
            </Button>
            <Button size="sm" onClick={save}>
              {s.save}
            </Button>
          </div>
        )}
        {error && <p className="px-4 pb-3 text-[12px] text-danger">{error}</p>}
      </Card>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="min-w-0 text-ink-2">{label}</span>
      {children}
    </div>
  );
}

function MandateCard({ m, s, tz, lang, viewer, payerName, hasPasskey }: { m: PlanMandate; s: Strings; tz: string; lang: Lang; viewer?: string; payerName: string; hasPasskey: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error && e.name !== "NotAllowedError" ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const isPayer = viewer === m.payerId;
  const tone = m.status === "active" ? "success" : m.status === "paused" ? "amber" : "neutral";
  return (
    <section>
      <SectionTitle>{s.mandate}</SectionTitle>
      <Card className="p-4 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <Badge tone={tone}>{s.mandateStates[m.status]}</Badge>
          <span className="num font-semibold text-ink">{money(m.totalCap, m.currency)}</span>
        </div>
        <ul className="mt-3 space-y-1">
          {m.windows.map((x) => (
            <li key={x.instalment} className="flex justify-between gap-3 text-ink-2">
              <span>
                #{x.instalment} · {s.until(dayLabel(x.to, tz, lang))}
              </span>
              <span className="num text-ink">{money(x.amount, m.currency)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-ink-3">{s.mandateWhat}</p>
        {m.status === "paused" && m.pausedReason && (
          <p className="mt-2 flex items-start gap-2 text-[12px] text-ink-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-strong" aria-hidden />
            <span>
              {s.pausedBecause} {m.pausedReason}
            </span>
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {m.status === "awaiting_approval" &&
            (isPayer ? (
              <Button className="flex-1" disabled={busy} onClick={() => run(() => (hasPasskey ? signMandateWithPasskey(m.id, viewer) : post("/api/plan", { action: "sign_mandate", mandateId: m.id, personId: viewer, method: "hold" })))}>
                {hasPasskey && <Fingerprint size={16} aria-hidden />}
                {hasPasskey ? s.signPasskey : s.signHold}
              </Button>
            ) : (
              <p className="w-full text-[12px] text-ink-3">{s.onlyPayerSign(payerName)}</p>
            ))}
          {(m.status === "active" || m.status === "paused" || m.status === "awaiting_approval") && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => post("/api/plan", { action: "revoke_mandate", mandateId: m.id, personId: viewer }))}>
              {s.revoke}
            </Button>
          )}
        </div>
        {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
      </Card>
    </section>
  );
}
