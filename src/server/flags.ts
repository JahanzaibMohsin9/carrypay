import { parseFlags, type Flag, type Flags } from "@/domain/flags";

// Read on every call (not cached) so tests and the Director can change them without a restart.
let override: Flags | undefined;

export function serverFlags(): Flags {
  return override ?? parseFlags(process.env.CARRYPAY_FLAGS);
}

export function flagOn(flag: Flag): boolean {
  return serverFlags()[flag];
}

/** Tests only: force a flag set (undefined goes back to the environment). */
export function setFlagsForTest(flags: Flags | undefined) {
  override = flags;
}
