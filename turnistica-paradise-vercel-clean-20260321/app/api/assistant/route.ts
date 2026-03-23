import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getLocalSchedule } from "@/lib/local-data";
import { buildAssistantMemoryFromRules, interpretScheduleRequest } from "@/lib/scheduling-assistant";
import { STORE_LABELS, toMonthKey, toISODate } from "@/app/turnistica/_lib/utils";

export async function POST(request: NextRequest) {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const requestText = typeof body?.request === "string" ? body.request.trim() : "";
  const monthKey = typeof body?.monthKey === "string" && /^\d{4}-\d{2}$/.test(body.monthKey) ? body.monthKey : toMonthKey(new Date());

  if (!requestText) {
    return NextResponse.json(
      {
        reply: "Richiesta vuota, scrivi cosa vuoi fare.",
        actions: [],
        warnings: [],
        memory_updates: []
      },
      { status: 400 }
    );
  }

  const schedule = await getLocalSchedule(monthKey);
  const shiftTypes = schedule.templates.map((template) => template.name);

  return NextResponse.json(
    interpretScheduleRequest({
      request: requestText,
      currentSchedule: schedule,
      employees: schedule.employees.filter((employee) => employee.active),
      stores: [STORE_LABELS.duomo, STORE_LABELS.buenos_aires],
      shiftTypes,
      memory: buildAssistantMemoryFromRules(schedule),
      rules: schedule.rules,
      currentDateISO: toISODate(new Date())
    })
  );
}
