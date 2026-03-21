import { redirect } from "next/navigation";
import { AvailabilityStudio } from "@/app/turnistica/_components/AvailabilityStudio";
import { getAppSession } from "@/lib/auth";
import { getLocalSchedule } from "@/lib/local-data";
import { toMonthKey } from "@/app/turnistica/_lib/utils";

export const dynamic = "force-dynamic";

export default async function DisponibilitaPage() {
  const session = await getAppSession();
  if (!session?.user) {
    redirect("/login");
  }

  const monthKey = toMonthKey(new Date());
  const schedule = await getLocalSchedule(monthKey);

  return <AvailabilityStudio user={session.user} initialSchedule={schedule} />;
}
