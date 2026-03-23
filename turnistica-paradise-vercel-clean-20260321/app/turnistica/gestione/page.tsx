import { redirect } from "next/navigation";
import { TurnisticaApp } from "@/app/turnistica/_components/TurnisticaApp";
import { getAppSession } from "@/lib/auth";
import { getLocalSchedule, listLocalVersions } from "@/lib/local-data";
import { toMonthKey } from "@/app/turnistica/_lib/utils";

export const dynamic = "force-dynamic";

export default async function GestioneTurnisticaPage() {
  const session = await getAppSession();
  if (!session?.user) {
    redirect("/login");
  }

  const monthKey = toMonthKey(new Date());
  const [schedule, versions] = await Promise.all([getLocalSchedule(monthKey), listLocalVersions(monthKey)]);

  return <TurnisticaApp user={session.user} initialSchedule={schedule} initialVersions={versions} />;
}
