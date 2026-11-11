// Feature flags for the work after the online submission. Every new feature ships behind one, off by
// default, so a feature that misbehaves can be switched off before (or during) a presentation without a
// code change. Set on the server: CARRYPAY_FLAGS=plan,arrangements  ·  CARRYPAY_FLAGS=all  ·  CARRYPAY_FLAGS=all,-mandate

export const FLAG_NAMES = [
  /** affordability planner: funding profile, cash-flow projection, plan comparison */
  "plan",
  /** payment arrangements requested from and confirmed by the institution */
  "arrangements",
  /** bill review against the family's evidence (scholarships, discounts, credits) */
  "entitlements",
  /** plan mandate: one signed approval for a bounded series of instalments */
  "mandate",
  /** payment tracked until the institution confirms it credited the student or patient */
  "allocation",
] as const;

export type Flag = (typeof FLAG_NAMES)[number];
export type Flags = Record<Flag, boolean>;

export const NO_FLAGS: Flags = Object.fromEntries(FLAG_NAMES.map((f) => [f, false])) as Flags;

const isFlag = (s: string): s is Flag => (FLAG_NAMES as readonly string[]).includes(s);

/** "plan,mandate" · "all" · "all,-mandate". Unknown names are ignored. */
export function parseFlags(spec: string | undefined): Flags {
  const flags = { ...NO_FLAGS };
  for (const raw of (spec ?? "").split(",")) {
    const item = raw.trim().toLowerCase();
    if (!item) continue;
    const off = item.startsWith("-");
    const name = off ? item.slice(1) : item;
    if (name === "all") for (const f of FLAG_NAMES) flags[f] = !off;
    else if (isFlag(name)) flags[name] = !off;
  }
  return flags;
}
