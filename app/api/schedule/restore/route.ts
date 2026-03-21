import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api-auth";
import { restoreLocalVersion } from "@/lib/local-data";

const bodySchema = z.object({ versionId: z.string().min(1) });

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "versionId obbligatorio" }, { status: 400 });
  }

  const result = await restoreLocalVersion(parsed.data.versionId, auth.session.user.name);
  if (!result) {
    return NextResponse.json({ error: "Versione non trovata" }, { status: 404 });
  }

  return NextResponse.json(result);
}
