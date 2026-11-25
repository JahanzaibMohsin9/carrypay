import { describe, expect, it } from "vitest";
import { FLAG_NAMES, parseFlags } from "./flags";

describe("feature flags", () => {
  it("are all off by default", () => {
    expect(Object.values(parseFlags(undefined)).every((v) => v === false)).toBe(true);
    expect(Object.values(parseFlags("")).every((v) => v === false)).toBe(true);
  });

  it("turn on by name, ignoring case, spaces and unknown names", () => {
    const f = parseFlags(" Plan, arrangements ,nonsense");
    expect(f.plan).toBe(true);
    expect(f.arrangements).toBe(true);
    expect(f.mandate).toBe(false);
  });

  it("support all with exceptions", () => {
    const f = parseFlags("all,-mandate");
    for (const name of FLAG_NAMES) expect(f[name]).toBe(name !== "mandate");
  });
});
