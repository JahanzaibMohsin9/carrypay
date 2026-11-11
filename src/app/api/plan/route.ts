import { runtime } from "@/server/runtime";
import { sessionId } from "@/server/session";
import { flagOn } from "@/server/flags";
import { decideArrangement, FundingInput, setFunding } from "@/server/plan";

// The family's side of the plan workflow: their own figures, and their decision on the institution's offers.
export async function POST(request: Request) {
  if (!flagOn("plan")) return Response.json({ error: "The plan feature is switched off." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    caseId?: string;
    personId?: string;
    funding?: unknown;
    arrangementId?: string;
    decision?: string;
    method?: string;
  };
  const { store } = runtime(sessionId(request));
  try {
    if (body.action === "funding") {
      if (!body.caseId || !body.personId) return Response.json({ error: "caseId and personId are required" }, { status: 400 });
      const parsed = FundingInput.safeParse(body.funding);
      if (!parsed.success) return Response.json({ error: "Please check the figures.", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
      setFunding(store, body.caseId, parsed.data, body.personId);
      return Response.json({ ok: true });
    }
    if (body.action === "decide") {
      if (!flagOn("arrangements")) return Response.json({ error: "Payment plans are switched off." }, { status: 404 });
      if (!body.arrangementId || (body.decision !== "accept" && body.decision !== "decline") || !body.personId) {
        return Response.json({ error: "arrangementId, decision (accept or decline) and personId are required" }, { status: 400 });
      }
      decideArrangement(store, body.arrangementId, body.decision, body.personId, body.method === "passkey" ? "passkey" : "hold");
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
