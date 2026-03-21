import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { importLocalBackup, importLocalCsv, importLocalMonth, isBackupFile, isMonthExport } from "@/lib/local-data";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File obbligatorio" }, { status: 400 });
  }

  const text = await file.text();

  if (file.name.toLowerCase().endsWith(".csv") || file.type.includes("csv")) {
    return NextResponse.json(await importLocalCsv(text, auth.session.user.name));
  }

  try {
    const payload = JSON.parse(text) as unknown;

    if (isBackupFile(payload)) {
      return NextResponse.json(await importLocalBackup(payload));
    }

    if (isMonthExport(payload)) {
      return NextResponse.json(await importLocalMonth(payload, auth.session.user.name));
    }

    return NextResponse.json({ error: "Formato JSON non riconosciuto" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Impossibile leggere il file importato" }, { status: 400 });
  }
}
