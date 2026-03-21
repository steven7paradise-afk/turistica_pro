import { TurnisticaOverview } from "@/app/turnistica/_components/TurnisticaOverview";
import { getLocalSchedule } from "@/lib/local-data";
import { toISODate, toMonthKey } from "@/app/turnistica/_lib/utils";

export const dynamic = "force-dynamic";

export default async function TurnisticaPage() {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayMonth = toMonthKey(today);
  const tomorrowMonth = toMonthKey(tomorrow);
  const todaySchedule = await getLocalSchedule(todayMonth);
  const tomorrowSchedule = tomorrowMonth === todayMonth ? todaySchedule : await getLocalSchedule(tomorrowMonth);

  return (
    <TurnisticaOverview
      todayISO={toISODate(today)}
      tomorrowISO={toISODate(tomorrow)}
      todaySchedule={todaySchedule}
      tomorrowSchedule={tomorrowSchedule}
    />
  );
}
