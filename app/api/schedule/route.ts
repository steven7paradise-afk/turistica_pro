import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api-auth";
import { getLocalSchedule, saveLocalSchedule } from "@/lib/local-data";

const monthRegex = /^\d{4}-\d{2}$/;

const assignmentSchema = z.union([
  z.null(),
  z.object({ kind: z.literal("STANDARD"), type: z.enum(["MATTINA", "POMERIGGIO", "FULL", "RIPOSO", "FERIE", "MALATTIA"]) }),
  z.object({
    kind: z.literal("CUSTOM"),
    templateId: z.string(),
    name: z.string(),
    shortCode: z.string().max(4).optional(),
    availabilityStatus: z.enum(["lavoro", "riposo", "malattia", "permesso", "non_lavorato"]).optional(),
    startTime: z.string(),
    endTime: z.string(),
    unpaidBreakMinutes: z.coerce.number().int().min(0).default(0)
  })
]);

const putSchema = z.object({
  expectedVersion: z.number().int().positive(),
  assignments: z.record(z.string(), z.record(z.string(), assignmentSchema))
});

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;

  const month = request.nextUrl.searchParams.get("month") || "";
  if (!monthRegex.test(month)) {
    return NextResponse.json({ error: "Formato mese non valido (YYYY-MM)" }, { status: 400 });
  }

  return NextResponse.json(await getLocalSchedule(month));
}

export async function PUT(request: NextRequest) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const month = request.nextUrl.searchParams.get("month") || "";
  if (!monthRegex.test(month)) {
    return NextResponse.json({ error: "Formato mese non valido (YYYY-MM)" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload non valido", details: parsed.error.issues }, { status: 400 });
  }

  const result = await saveLocalSchedule(month, parsed.data.expectedVersion, parsed.data.assignments, auth.session.user.name);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: "Conflitto: il piano è stato modificato da un altro dispositivo. Ricarica prima di salvare.",
        currentVersion: result.currentVersion,
        currentUpdatedAt: result.currentUpdatedAt
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ version: result.version, updatedAt: result.updatedAt });
}
