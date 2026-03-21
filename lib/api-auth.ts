import { NextResponse } from "next/server";
import type { AppRole } from "@/lib/roles";
import { getAppSession } from "@/lib/auth";

export async function requireSession(roles?: AppRole[]) {
  const session = await getAppSession();

  if (!session?.user) {
    return { error: NextResponse.json({ error: "Accesso richiesto" }, { status: 401 }) };
  }

  if (roles && !roles.includes(session.user.role)) {
    return { error: NextResponse.json({ error: "Permesso insufficiente" }, { status: 403 }) };
  }

  return { session };
}
