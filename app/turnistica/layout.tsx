import { redirect } from "next/navigation";
import { TurnisticaShell } from "@/app/turnistica/_components/TurnisticaShell";
import { getAppSession, isLoginDisabled } from "@/lib/auth";
import "./print.css";

export const dynamic = "force-dynamic";

export default async function TurnisticaLayout({ children }: { children: React.ReactNode }) {
  const session = await getAppSession();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <TurnisticaShell user={session.user} logoutEnabled={!isLoginDisabled()}>
      {children}
    </TurnisticaShell>
  );
}
