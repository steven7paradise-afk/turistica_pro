import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function RegolePage() {
  const session = await getAppSession();
  if (!session?.user) {
    redirect("/login");
  }

  redirect("/turnistica/gestione");
}
