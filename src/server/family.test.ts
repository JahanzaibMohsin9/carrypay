import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseFlags } from "@/domain/flags";
import { messageTexts } from "@/domain/messages";
import { Store } from "./store";
import { seedScenario } from "./scenarios";
import { anthropicToolDefs, executeTool } from "./agent/tools";
import { caseSnapshot } from "./agent/snapshot";
import { buildVault } from "./agent/privacy";
import { FAMILY_PROMPT, systemPrompt } from "./agent/prompt";
import { setFlagsForTest } from "./flags";

// Family roles (flag "family"): in "A year in London" Yutong reads English and her father Chinese, so one
// agent message carries both versions and each phone shows its reader's.

function boot(flags: string) {
  setFlagsForTest(parseFlags(flags));
  const store = new Store();
  store.load(() => seedScenario("uk-year"));
  store.reset(seedScenario("uk-year"));
  const tool = (name: string, input: Record<string, unknown>) => JSON.parse(executeTool(name, { narration: "test step", ...input }, { store, caseId: "case_yr" }));
  return { store, tool };
}

afterEach(() => setFlagsForTest(undefined));

describe("per-person language for agent messages", () => {
  it("tells the model who reads which language, only with the flag on", () => {
    const people = (s: Store) => caseSnapshot(s.world, "case_yr").people;
    const on = boot("all").store;
    expect(people(on).find((p) => p.id === "p_jianhua")).toMatchObject({ reads: "zh" });
    expect(people(on).find((p) => p.id === "p_yutong")).not.toHaveProperty("reads"); // she reads the case language
    expect(systemPrompt()).toContain(FAMILY_PROMPT);
    expect(JSON.stringify(anthropicToolDefs().find((t) => t.name === "message_family"))).toContain("translations");

    const off = boot("all,-family").store;
    expect(people(off).some((p) => "reads" in p)).toBe(false);
    expect(systemPrompt()).not.toContain(FAMILY_PROMPT);
    // the evaluated tool schema is unchanged with the flag off
    expect(JSON.stringify(anthropicToolDefs().find((t) => t.name === "message_family"))).not.toContain("translations");
  });

  it("delivers one message in both languages", () => {
    const { store, tool } = boot("all");
    const r = tool("message_family", { text: "Your dad can approve the first instalment now.", translations: { zh: "第一期已备好，请您批准。" }, importance: "action" });
    expect(r).toMatchObject({ delivered: true, languages: ["en", "zh"] });
    expect(store.world.messages.at(-1)).toMatchObject({ text: "Your dad can approve the first instalment now.", texts: { en: "Your dad can approve the first instalment now.", zh: "第一期已备好，请您批准。" } });
  });

  it("keeps the case-language text authoritative and single-language messages unchanged", () => {
    const { store, tool } = boot("all");
    tool("message_family", { text: "All paid.", translations: { en: "Something else." }, importance: "info" });
    expect(store.world.messages.at(-1)).not.toHaveProperty("texts");
    expect(tool("message_family", { text: "All paid.", importance: "info" })).toEqual({ delivered: true, message_id: expect.any(String) });
    expect(tool("message_family", { text: "Too long.", translations: { zh: "长".repeat(801) }, importance: "info" }).error).toBe("INVALID_INPUT");
  });

  it("writes names in each version's own script", () => {
    const { store } = boot("all");
    const v = buildVault(store.world, "case_yr");
    const token = v.mask("周雨桐 Zhou Yutong");
    const input = v.unmaskDeep({ text: `Hi ${token}!`, translations: { zh: `${token}的学费已付清。` }, narration: `Telling ${token}` });
    expect(input.text).toBe("Hi Zhou Yutong!");
    expect(input.translations.zh).toBe("周雨桐的学费已付清。");
  });

  it("gives the father the recorded live run's messages in Chinese, so a replay reaches him in Chinese too", () => {
    const rec = JSON.parse(readFileSync(path.join(process.cwd(), "recordings", "uk-year.json"), "utf8"));
    // a recording made with per-person language writes the Chinese as a translation; an older one appended it
    // to the English text as a paragraph for "爸爸": both must reach the father in Chinese
    const msgs: { text: string; texts?: Partial<Record<"en" | "zh", string>> }[] = [];
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === "object") {
        const x = o as { tool?: string; input?: { text?: string; translations?: Partial<Record<"en" | "zh", string>> } };
        if (x.tool === "message_family" && x.input?.text) msgs.push({ text: x.input.text, texts: x.input.translations });
        Object.values(o).forEach(walk);
      }
    };
    walk(rec);
    expect(msgs.length).toBeGreaterThan(10);
    const split = msgs.map((m) => messageTexts(m, "en")).filter((v) => v.zh);
    expect(split.length).toBeGreaterThanOrEqual(msgs.length - 2);
    // a combined message is split at the "爸爸：" paragraph, and that label must not reach either reader
    // (in a translation, "爸爸，…" is the agent's own greeting to him, so it isn't checked there)
    for (const v of msgs.filter((m) => !m.texts?.zh).map((m) => messageTexts(m, "en")).filter((x) => x.zh)) {
      expect(v.zh).not.toMatch(/^爸爸/);
      expect(v.en).not.toMatch(/爸爸/);
    }
    for (const m of msgs.filter((x) => x.texts?.zh)) expect(m.text).not.toMatch(/^爸爸/);
  });
});
