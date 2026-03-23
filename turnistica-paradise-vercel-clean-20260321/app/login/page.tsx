import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth";
import { LoginScreen } from "@/app/login/LoginScreen";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getAppSession();
  if (session?.user) {
    redirect("/turnistica");
  }

  return <LoginScreen />;
}
