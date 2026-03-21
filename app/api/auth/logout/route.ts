import { createLogoutResponse } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  return createLogoutResponse();
}
