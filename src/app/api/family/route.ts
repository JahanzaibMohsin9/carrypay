import { familyMessage, runtime, setKillSwitch } from "@/server/runtime";

export async function POST(request: Request) {
  const body = (await request.json()) as { action?: string; caseId?: string; text?: string; on?: boolean };
  if (body.action === "kill") {
    setKillSwitch(Boolean(body.on));
    return Response.json({ ok: true });
  }
  const { store } = runtime();
  if (!body.caseId || !store.world.cases[body.caseId] || !body.text?.trim()) {
    return Response.json({ error: "caseId and text are required" }, { status: 400 });
  }
  familyMessage(body.caseId, body.text.trim().slice(0, 1000));
  return Response.json({ ok: true });
}
