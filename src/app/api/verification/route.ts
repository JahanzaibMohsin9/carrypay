import { runtime } from "@/server/runtime";
import { sessionId } from "@/server/session";
import { flagOn } from "@/server/flags";
import { BankReviewInput, ReviewInput, reviewBankChange, reviewVerification } from "@/server/verification";

// The bank reviewer's decisions on an uploaded institution (the sandbox bank's workbench, /bank).
export async function POST(request: Request) {
  if (!flagOn("verification")) return Response.json({ error: "The verification workbench is switched off." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { store } = runtime(sessionId(request));
  // a known institution's announced new account
  if (body.kind === "bank_change") {
    const parsed = BankReviewInput.safeParse(body);
    if (!parsed.success) return Response.json({ error: "institutionId and action (confirm or reject) are required" }, { status: 400 });
    try {
      reviewBankChange(store, parsed.data);
      return Response.json({ ok: true });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
    }
  }
  const parsed = ReviewInput.safeParse(body);
  if (!parsed.success) return Response.json({ error: "institutionId, check (institution, account or invoice) and action (confirm, request or reject) are required" }, { status: 400 });
  try {
    reviewVerification(store, parsed.data);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
