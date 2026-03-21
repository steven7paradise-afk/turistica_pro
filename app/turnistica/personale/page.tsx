import { redirect } from "next/navigation";
import { PeopleStudio } from "@/app/turnistica/_components/PeopleStudio";
import { getAppSession } from "@/lib/auth";
import { listLocalEmployees } from "@/lib/local-data";

export const dynamic = "force-dynamic";

export default async function PersonalePage() {
  const session = await getAppSession();
  if (!session?.user) {
    redirect("/login");
  }

  return <PeopleStudio initialEmployees={await listLocalEmployees(true)} />;
}
