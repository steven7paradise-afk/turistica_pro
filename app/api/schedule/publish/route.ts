import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { publishLocalSchedule } from "@/lib/local-data";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const month = request.nextUrl.searchParams.get("month") || "";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Formato mese non valido" }, { status: 400 });
  }

  return NextResponse.json(await publishLocalSchedule(month, auth.session.user.name));
}
