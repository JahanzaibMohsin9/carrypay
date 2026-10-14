import { listPasskeys, removePasskeys } from "@/server/passkey";
import { runtime } from "@/server/runtime";

export async function GET() {
  return Response.json(listPasskeys().map((k) => ({ id: k.id, label: k.label, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })));
}

export async function DELETE() {
  removePasskeys();
  runtime().store.mutate(() => {});
  return Response.json({ ok: true });
}
