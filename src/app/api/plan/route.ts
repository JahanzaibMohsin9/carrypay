import { runtime } from "@/server/runtime";
import { sessionId } from "@/server/session";
import { flagOn } from "@/server/flags";
import { checkMandateSigner, decideArrangement, FundingInput, revokeMandate, setFunding, signMandate } from "@/server/plan";
import { mandateChallenge, verifyMandate, type Assertion } from "@/server/passkey";

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
    mandateId?: string;
    assertion?: Assertion;
  };
  const sid = sessionId(request);
  const { store } = runtime(sid);
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
    if (body.action === "mandate_challenge" || body.action === "sign_mandate" || body.action === "revoke_mandate") {
      if (!flagOn("mandate")) return Response.json({ error: "Plan mandates are switched off." }, { status: 404 });
      if (!body.mandateId) return Response.json({ error: "mandateId is required" }, { status: 400 });
      if (body.action === "mandate_challenge") return Response.json(mandateChallenge(store.world, body.mandateId, sid));
      if (body.action === "revoke_mandate") {
        revokeMandate(store, body.mandateId, body.personId);
        return Response.json({ ok: true });
      }
      if (body.method === "passkey") {
        // the signature must cover these exact terms; checked before the mandate can cover anything
        if (!body.assertion) throw new Error("A passkey signature needs a signed assertion.");
        checkMandateSigner(store, body.mandateId, body.personId);
        const origin = request.headers.get("origin") ?? new URL(request.url).origin;
        const evidence = verifyMandate(store.world, body.mandateId, body.assertion, origin, sid);
        signMandate(store, body.mandateId, body.personId, "passkey", evidence);
      } else {
        signMandate(store, body.mandateId, body.personId, "hold");
      }
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
