import { NextRequest, NextResponse } from "next/server";
import { monthDates, toCsvRows } from "@/app/turnistica/_lib/utils";
import { requireSession } from "@/lib/api-auth";
import { exportLocalBackup, exportLocalMonth, getLocalSchedule } from "@/lib/local-data";

export const dynamic = "force-dynamic";

const monthRegex = /^\d{4}-\d{2}$/;

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;

  const format = request.nextUrl.searchParams.get("format") || "json";
  const scope = request.nextUrl.searchParams.get("scope") || "month";

  if (scope === "backup") {
    const backup = await exportLocalBackup();
    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="turnistica-paradise-backup.json"'
      }
    });
  }

  const month = request.nextUrl.searchParams.get("month") || "";
  if (!monthRegex.test(month)) {
    return NextResponse.json({ error: "Formato mese non valido (YYYY-MM)" }, { status: 400 });
  }

  if (format === "csv") {
    const schedule = await getLocalSchedule(month);
    const csv = toCsvRows(schedule.assignments, schedule.employees, monthDates(month));
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="turnistica-${month}.csv"`
      }
    });
  }

  const payload = await exportLocalMonth(month);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="turnistica-${month}.json"`
    }
  });
}
