import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api-auth";
import { createLocalEmployee, deleteLocalEmployee, listLocalEmployees, permanentlyDeleteLocalEmployee, updateLocalEmployee } from "@/lib/local-data";

export const dynamic = "force-dynamic";

const storeSchema = z.enum(["duomo", "buenos_aires"]);
const availabilitySchema = z.enum(["lavoro", "riposo", "malattia", "permesso", "non_lavorato"]);

const createSchema = z.object({
  fullName: z.string().trim().min(2, "Nome troppo corto"),
  homeStore: storeSchema.optional()
});

const patchSchema = z.object({
  id: z.string().trim().min(1),
  fullName: z.string().trim().min(2).optional(),
  active: z.boolean().optional(),
  homeStore: storeSchema.optional(),
  availability: z.record(z.string(), availabilitySchema).optional(),
  overrideStoreByDate: z.record(z.string(), storeSchema).optional()
});

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if ("error" in auth) return auth.error;

  const includeInactive = request.nextUrl.searchParams.get("includeInactive");
  return NextResponse.json(await listLocalEmployees(includeInactive === "1" || includeInactive === "true"));
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Nome dipendente non valido", details: parsed.error.issues }, { status: 400 });
  }

  return NextResponse.json(await createLocalEmployee(parsed.data.fullName, parsed.data.homeStore), { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Aggiornamento dipendente non valido", details: parsed.error.issues }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await updateLocalEmployee(parsed.data.id, {
        fullName: parsed.data.fullName,
        active: parsed.data.active,
        homeStore: parsed.data.homeStore,
        availability: parsed.data.availability,
        overrideStoreByDate: parsed.data.overrideStoreByDate
      })
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Errore aggiornamento dipendente" }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id obbligatorio" }, { status: 400 });
  }

  const permanent = request.nextUrl.searchParams.get("permanent");

  try {
    if (permanent === "1" || permanent === "true") {
      return NextResponse.json(await permanentlyDeleteLocalEmployee(id, auth.session.user.name));
    }

    return NextResponse.json(await deleteLocalEmployee(id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Errore eliminazione dipendente" }, { status: 404 });
  }
}
