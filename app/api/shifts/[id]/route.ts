import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api-auth";
import { deleteLocalShift, listLocalShifts, upsertLocalShift } from "@/lib/local-data";

export const dynamic = "force-dynamic";

const monthRegex = /^\d{4}-\d{2}$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const writeSchema = z.object({
  employeeId: z.string().trim().min(1),
  store: z.enum(["duomo", "buenos_aires"]),
  dateISO: z.string().regex(dateRegex),
  startTime: z.string().regex(timeRegex),
  endTime: z.string().regex(timeRegex),
  withStandardBreak: z.boolean().default(false),
  note: z.string().trim().max(400).nullable().optional(),
  duplicateDates: z.array(z.string().regex(dateRegex)).max(31).default([])
});

type Context = {
  params: { id: string };
};

export async function GET(request: NextRequest, { params }: Context) {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;

  const month = request.nextUrl.searchParams.get("month") || "";
  if (!monthRegex.test(month)) {
    return NextResponse.json({ error: "Formato mese non valido (YYYY-MM)" }, { status: 400 });
  }

  const shift = (await listLocalShifts(month)).find((item) => item.id === params.id);
  if (!shift) {
    return NextResponse.json({ error: "Turno non trovato" }, { status: 404 });
  }

  return NextResponse.json(shift);
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const month = request.nextUrl.searchParams.get("month") || "";
  if (!monthRegex.test(month)) {
    return NextResponse.json({ error: "Formato mese non valido (YYYY-MM)" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = writeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dati turno non validi", details: parsed.error.issues }, { status: 400 });
  }

  const result = await upsertLocalShift(month, parsed.data, auth.session.user.name, params.id);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: "Il turno non può essere aggiornato.",
        conflicts: result.conflicts,
        warnings: result.warnings
      },
      { status: 409 }
    );
  }

  return NextResponse.json(result.result);
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const month = request.nextUrl.searchParams.get("month") || "";
  if (!monthRegex.test(month)) {
    return NextResponse.json({ error: "Formato mese non valido (YYYY-MM)" }, { status: 400 });
  }

  const result = await deleteLocalShift(month, params.id, auth.session.user.name);
  if (!result) {
    return NextResponse.json({ error: "Turno non trovato" }, { status: 404 });
  }

  return NextResponse.json(result);
}
