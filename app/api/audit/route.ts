import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { listLocalAudit } from "@/lib/local-data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;

  const month = request.nextUrl.searchParams.get("month") || "";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Formato mese non valido" }, { status: 400 });
  }

  const employeeId = request.nextUrl.searchParams.get("employeeId") || undefined;
  return NextResponse.json(await listLocalAudit(month, employeeId));
}
