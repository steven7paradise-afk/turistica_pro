import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { readLocalEmployeePhoto, removeLocalEmployeePhoto, setLocalEmployeePhoto } from "@/lib/local-data";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function GET(request: NextRequest) {
  const employeeId = request.nextUrl.searchParams.get("employeeId")?.trim();
  if (!employeeId) {
    return NextResponse.json({ error: "employeeId obbligatorio" }, { status: 400 });
  }

  const photo = await readLocalEmployeePhoto(employeeId);
  if (!photo) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(photo.buffer, {
    status: 200,
    headers: {
      "Content-Type": photo.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const formData = await request.formData().catch(() => null);
  const employeeId = String(formData?.get("employeeId") ?? "").trim();
  const file = formData?.get("file");

  if (!employeeId) {
    return NextResponse.json({ error: "employeeId obbligatorio" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File foto obbligatorio" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Formato immagine non supportato. Usa JPG, PNG, WEBP o GIF" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Foto troppo pesante. Mantieni il file sotto 5 MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return NextResponse.json(await setLocalEmployeePhoto(employeeId, buffer, file.type));
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSession(["ADMIN", "MANAGER"]);
  if ("error" in auth) return auth.error;

  const employeeId = request.nextUrl.searchParams.get("employeeId")?.trim();
  if (!employeeId) {
    return NextResponse.json({ error: "employeeId obbligatorio" }, { status: 400 });
  }

  return NextResponse.json(await removeLocalEmployeePhoto(employeeId));
}
