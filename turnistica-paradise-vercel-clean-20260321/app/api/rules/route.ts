import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { ShiftId } from "@/app/turnistica/_lib/types";
import { requireSession } from "@/lib/api-auth";
import { deleteLocalRule, listLocalRules, upsertLocalRule } from "@/lib/local-data";

const schema = z.object({
  id: z.string().optional(),
  employeeId: z.string().min(1),
  unavailableWeekdays: z.array(z.number().int().min(0).max(6)),
  unavailableDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  forbiddenShiftIds: z.array(z.string()),
  preferredShiftId: z.string().nullable(),
  mustWorkWeekdays: z.array(z.number().int().min(0).max(6)),
  avoidRestWithEmployeeIds: z.array(z.string()),
  note: z.string()
});

export async function GET() {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;

  return NextResponse.json(await listLocalRules());
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload regola non valido", details: parsed.error.issues }, { status: 400 });
  }

  return NextResponse.json(
    await upsertLocalRule({
      ...parsed.data,
      preferredShiftId: parsed.data.preferredShiftId as ShiftId | null
    })
  );
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id obbligatorio" }, { status: 400 });
  }

  return NextResponse.json(await deleteLocalRule(id));
}
