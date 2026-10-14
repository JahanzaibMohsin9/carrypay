import { register, registrationOptions } from "@/server/passkey";
import { runtime } from "@/server/runtime";

const originOf = (req: Request) => req.headers.get("origin") ?? new URL(req.url).origin;

export async function GET(request: Request) {
  return Response.json(registrationOptions(originOf(request)));
}

export async function POST(request: Request) {
  try {
    const key = register(await request.json(), originOf(request));
    // push fresh state to open apps so the approval screen switches to the passkey
    runtime().store.mutate(() => {});
    return Response.json({ ok: true, id: key.id, label: key.label });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
