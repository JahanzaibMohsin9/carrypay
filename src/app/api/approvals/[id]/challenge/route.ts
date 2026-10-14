import { runtime } from "@/server/runtime";
import { approvalChallenge } from "@/server/passkey";

/** A WebAuthn challenge that commits to this exact payment (amount, account, reference). */
export async function POST(_request: Request, ctx: RouteContext<"/api/approvals/[id]/challenge">) {
  const { id } = await ctx.params;
  try {
    return Response.json(approvalChallenge(runtime().store.world, id));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}
