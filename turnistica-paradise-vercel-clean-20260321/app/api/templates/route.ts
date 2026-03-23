import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api-auth";
import { createLocalTemplate, deleteLocalTemplate, listLocalTemplates, updateLocalTemplate } from "@/lib/local-data";

const bodySchema = z.object({
  name: z.string().trim().min(1, "Nome template obbligatorio"),
  shortCode: z.string().trim().min(1, "Sigla obbligatoria").max(4, "Massimo 4 caratteri"),
  availabilityStatus: z.enum(["lavoro", "riposo", "malattia", "permesso", "non_lavorato"]),
  startTime: z.string(),
  endTime: z.string(),
  unpaidBreakMinutes: z.coerce.number().int().min(0).max(720).default(0)
});

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export async function GET() {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;

  return NextResponse.json(await listLocalTemplates());
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload template non valido", details: parsed.error.issues }, { status: 400 });
  }

  if (parsed.data.availabilityStatus !== "lavoro") {
    parsed.data.startTime = "00:00";
    parsed.data.endTime = "00:00";
    parsed.data.unpaidBreakMinutes = 0;
  }

  if (!timeRegex.test(parsed.data.startTime) || !timeRegex.test(parsed.data.endTime)) {
    return NextResponse.json({ error: "Orari non validi (HH:MM)" }, { status: 400 });
  }

  if (parsed.data.availabilityStatus === "lavoro" && parsed.data.startTime === parsed.data.endTime) {
    return NextResponse.json({ error: "endTime deve essere diverso da startTime" }, { status: 400 });
  }

  const start = toMinutes(parsed.data.startTime);
  const end = toMinutes(parsed.data.endTime);
  const duration = end > start ? end - start : end + 1440 - start;

  if (parsed.data.availabilityStatus === "lavoro" && parsed.data.unpaidBreakMinutes >= duration) {
    return NextResponse.json({ error: "La pausa non retribuita deve essere piu corta del turno" }, { status: 400 });
  }

  return NextResponse.json(await createLocalTemplate(parsed.data), { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id obbligatorio" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload template non valido", details: parsed.error.issues }, { status: 400 });
  }

  if (parsed.data.availabilityStatus !== "lavoro") {
    parsed.data.startTime = "00:00";
    parsed.data.endTime = "00:00";
    parsed.data.unpaidBreakMinutes = 0;
  }

  if (!timeRegex.test(parsed.data.startTime) || !timeRegex.test(parsed.data.endTime)) {
    return NextResponse.json({ error: "Orari non validi (HH:MM)" }, { status: 400 });
  }

  if (parsed.data.availabilityStatus === "lavoro" && parsed.data.startTime === parsed.data.endTime) {
    return NextResponse.json({ error: "endTime deve essere diverso da startTime" }, { status: 400 });
  }

  const start = toMinutes(parsed.data.startTime);
  const end = toMinutes(parsed.data.endTime);
  const duration = end > start ? end - start : end + 1440 - start;

  if (parsed.data.availabilityStatus === "lavoro" && parsed.data.unpaidBreakMinutes >= duration) {
    return NextResponse.json({ error: "La pausa non retribuita deve essere piu corta del turno" }, { status: 400 });
  }

  const updated = await updateLocalTemplate(id, parsed.data, auth.session.user.name);
  if (!updated) {
    return NextResponse.json({ error: "Opzione non trovata" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id obbligatorio" }, { status: 400 });
  }

  return NextResponse.json(await deleteLocalTemplate(id));
}
