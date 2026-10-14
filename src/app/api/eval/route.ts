import { runtime } from "@/server/runtime";
import { evaluateRun } from "@/server/evaluate";

export async function GET() {
  const { store } = runtime();
  return Response.json(evaluateRun(store.world, store.ledger));
}
