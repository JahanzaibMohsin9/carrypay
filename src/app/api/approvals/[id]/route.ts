import { decideApproval, runtime } from "@/server/runtime";
import { verifyApproval, type Assertion } from "@/server/passkey";

export async function POST(request: Request, ctx: RouteContext<"/api/approvals/[id]">) {
  const { id } = await ctx.params;
  const body = (await request.json()) as { decision?: string; method?: string; assertion?: Assertion };
  if (body.decision !== "approved" && body.decision !== "declined") {
    return Response.json({ error: "decision must be approved or declined" }, { status: 400 });
  }
  try {
    if (body.method === "passkey") {
      // the signature must cover this payment exactly; checked before anything moves
      if (!body.assertion) throw new Error("A passkey approval needs a signed assertion.");
      const origin = request.headers.get("origin") ?? new URL(request.url).origin;
      const evidence = verifyApproval(runtime().store.world, id, body.assertion, origin);
      decideApproval(id, body.decision, "passkey", evidence);
    } else {
      decideApproval(id, body.decision, "hold");
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
