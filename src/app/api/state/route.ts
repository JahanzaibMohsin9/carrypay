import { publicState } from "@/server/runtime";

export async function GET() {
  return Response.json(publicState());
}
