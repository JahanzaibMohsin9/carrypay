import { decideApproval } from "@/server/runtime";

export async function POST(request: Request, ctx: RouteContext<"/api/approvals/[id]">) {
  const { id } = await ctx.params;
  const body = (await request.json()) as { decision?: string; method?: string };
  if (body.decision !== "approved" && body.decision !== "declined") {
    return Response.json({ error: "decision must be approved or declined" }, { status: 400 });
  }
  try {
    decideApproval(id, body.decision, body.method === "passkey" ? "passkey" : "hold");
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
