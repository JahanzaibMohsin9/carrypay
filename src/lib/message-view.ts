"use client";

import type { FamilyMessage, Lang } from "@/domain/types";
import { messageView, type MessageView } from "@/domain/messages";
import { useCarry } from "./client";
import { useT } from "./i18n";
import { activeCase } from "./selectors";

/** Each language's own name, as its readers write it. */
export const LANG_NAME: Record<Lang, string> = { en: "English", zh: "中文", ur: "اردو" };

/** The version of an agent message this phone's reader sees (in the app's language), and the others it went out in. */
export function useMessageView(m: Pick<FamilyMessage, "text" | "texts">): MessageView {
  const { state } = useCarry();
  const { lang } = useT();
  const c = state ? activeCase(state) : undefined;
  return messageView(m, c?.lang ?? "en", lang, !!state?.flags?.family);
}
