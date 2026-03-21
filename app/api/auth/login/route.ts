import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createLoginResponse, validatePin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  pin: z.string().trim().min(1)
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Codice non valido" }, { status: 400 });
  }

  if (!validatePin(parsed.data.pin)) {
    return NextResponse.json({ error: "Codice non valido" }, { status: 401 });
  }

  return createLoginResponse();
}
