// One agent message, several readers: which version each family member reads (flag "family").
import type { FamilyMessage, Lang } from "./types";

const han = (s: string) => (s.match(/\p{Script=Han}/gu) ?? []).length;
const latin = (s: string) => (s.match(/\p{Script=Latin}/gu) ?? []).length;
const DAD = /^(爸爸|爸)[：:]\s*/;

/**
 * The versions of a message by language. New messages carry them (`texts`); older ones, and live runs recorded
 * before per-person language, wrote one English message with a Chinese paragraph for the parent at the end
 * ("…\n\n爸爸：…"). That trailing Chinese block is split off, so a recorded run still reaches each reader in their language.
 */
export function messageTexts(m: Pick<FamilyMessage, "text" | "texts">, caseLang: Lang): Partial<Record<Lang, string>> {
  if (m.texts && Object.keys(m.texts).length) return { [caseLang]: m.text, ...m.texts };
  if (caseLang !== "en") return { [caseLang]: m.text };
  const paras = m.text.split(/\n\s*\n/);
  const firstZh = paras.findIndex((p) => han(p) > latin(p));
  if (firstZh <= 0 || paras.slice(firstZh).some((p) => han(p) <= latin(p))) return { en: m.text };
  return { en: paras.slice(0, firstZh).join("\n\n"), zh: paras.slice(firstZh).join("\n\n").replace(DAD, "") };
}

export interface MessageView {
  /** the version this reader sees */
  text: string;
  lang: Lang;
  /** the same message as sent to others on the case, in their languages */
  others: { lang: Lang; text: string }[];
}

/**
 * What one reader sees. With per-person language on, their own language (or the case language when the message
 * has no version in it) and the other versions behind a toggle; with it off, every version in one message as before.
 */
export function messageView(m: Pick<FamilyMessage, "text" | "texts">, caseLang: Lang, reader: Lang, perPerson: boolean): MessageView {
  const texts = messageTexts(m, caseLang);
  if (!perPerson) {
    const extra = Object.entries(texts).filter(([l, t]) => l !== caseLang && t && !m.text.includes(t)).map(([, t]) => t);
    return { text: [m.text, ...extra].join("\n\n"), lang: caseLang, others: [] };
  }
  const lang: Lang = texts[reader] ? reader : caseLang in texts ? caseLang : (Object.keys(texts)[0] as Lang);
  const others = (Object.entries(texts) as [Lang, string][]).filter(([l, t]) => l !== lang && !!t).map(([l, t]) => ({ lang: l, text: t }));
  return { text: texts[lang] ?? m.text, lang, others };
}

/** Every version of a message in one string, for checks that look for words in any language. */
export const allTexts = (m: Pick<FamilyMessage, "text" | "texts">) => [m.text, ...Object.values(m.texts ?? {})].join("\n\n");
