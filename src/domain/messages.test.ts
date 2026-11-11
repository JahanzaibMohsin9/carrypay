import { describe, expect, it } from "vitest";
import { allTexts, messageTexts, messageView } from "./messages";

// What each family member's phone shows of one agent message (flag "family").

const both = { text: "Your dad accepts it in the app.", texts: { en: "Your dad accepts it in the app.", zh: "请在应用里确认。" } };
// a live run recorded before per-person language: one English message, the parent's Chinese paragraph last
const recorded = { text: "The first payment is ready.\n\n• £14,370, due 1 December\n\n爸爸：第一期 £14,370 已备好，请在手机上确认。" };

describe("message versions by language", () => {
  it("uses the versions the agent sent", () => {
    expect(messageTexts(both, "en")).toEqual({ en: both.text, zh: "请在应用里确认。" });
  });

  it("splits an older bilingual message into the English part and the parent's Chinese part", () => {
    expect(messageTexts(recorded, "en")).toEqual({ en: "The first payment is ready.\n\n• £14,370, due 1 December", zh: "第一期 £14,370 已备好，请在手机上确认。" });
  });

  it("leaves single-language messages, Chinese cases and Chinese in the middle alone", () => {
    expect(messageTexts({ text: "All paid." }, "en")).toEqual({ en: "All paid." });
    expect(messageTexts({ text: "已付清。\n\nRef KG2611392" }, "zh")).toEqual({ zh: "已付清。\n\nRef KG2611392" });
    const mixed = "Intro.\n\n中文段落。\n\nEnglish again.";
    expect(messageTexts({ text: mixed }, "en")).toEqual({ en: mixed });
    expect(messageTexts({ text: "全是中文。" }, "en")).toEqual({ en: "全是中文。" });
  });
});

describe("what each reader sees", () => {
  it("the student reads English, the father Chinese, each with the other version behind a toggle", () => {
    expect(messageView(both, "en", "en", true)).toEqual({ text: both.text, lang: "en", others: [{ lang: "zh", text: "请在应用里确认。" }] });
    expect(messageView(both, "en", "zh", true)).toEqual({ text: "请在应用里确认。", lang: "zh", others: [{ lang: "en", text: both.text }] });
    expect(messageView(recorded, "en", "zh", true).text).toBe("第一期 £14,370 已备好，请在手机上确认。");
  });

  it("falls back to the case language when there is no version in the reader's", () => {
    expect(messageView({ text: "All paid." }, "en", "zh", true)).toEqual({ text: "All paid.", lang: "en", others: [] });
    expect(messageView(both, "en", "ur", true).text).toBe(both.text);
  });

  it("with per-person language off, shows every version in one message as before", () => {
    expect(messageView(both, "en", "zh", false)).toEqual({ text: "Your dad accepts it in the app.\n\n请在应用里确认。", lang: "en", others: [] });
    expect(messageView(recorded, "en", "zh", false).text).toBe(recorded.text);
  });

  it("checks for words look at every version", () => {
    expect(allTexts(both)).toContain("请在应用里确认");
  });
});
