import { Fragment } from "react";
import type { CSSProperties } from "react";
import { notFound, redirect } from "next/navigation";
import { PrintLauncher } from "./PrintLauncher";
import styles from "./page.module.css";
import { getAppSession } from "@/lib/auth";
import { getLocalSchedule } from "@/lib/local-data";
import {
  assignmentHours,
  customAssignmentAvailabilityStatus,
  formatMonthLabel,
  getEffectiveAssignmentForDate,
  getStoreForDate,
  isWeekend,
  monthDates,
  parseISODate,
  printLabel,
  STORE_LABELS,
  toISODate
} from "@/app/turnistica/_lib/utils";
import { ScheduleData, Store } from "@/app/turnistica/_lib/types";

export const dynamic = "force-dynamic";

const MONTH_REGEX = /^\d{4}-\d{2}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
function backgroundForStatus(status: "lavoro" | "riposo" | "malattia" | "permesso" | "non_lavorato") {
  if (status === "riposo") return "#dbeed6";
  if (status === "malattia") return "#f7edb1";
  if (status === "permesso") return "#d9e6f5";
  if (status === "non_lavorato") return "#f4c8c8";
  return "#ffffff";
}

function legendItems(schedule: ScheduleData) {
  const items = new Map<string, { label: string; background: string }>();

  schedule.templates.forEach((template) => {
    items.set(template.id, {
      label: template.name,
      background: backgroundForStatus(template.availabilityStatus)
    });
  });

  return [...items.values()];
}

function cellStyle(schedule: ScheduleData, employeeId: string, dateISO: string) {
  const employee = schedule.employees.find((item) => item.id === employeeId);
  if (!employee) {
    return { background: "#f8f3f6", color: "#7d6874" };
  }

  const assignment = getEffectiveAssignmentForDate(employee, dateISO, schedule.assignments[employeeId]?.[dateISO] ?? null);
  if (!assignment) {
    return { background: "#f8f3f6", color: "#7d6874" };
  }

  if (assignment.kind === "STANDARD") {
    if (assignment.type === "FULL") return { background: "#ffffff", color: "#241720" };
    if (assignment.type === "RIPOSO") return { background: "#dbeed6", color: "#244226" };
    if (assignment.type === "FERIE") return { background: "#f4c8c8", color: "#5e2424" };
    if (assignment.type === "MALATTIA") return { background: "#f7edb1", color: "#635100" };
    if (assignment.type === "MATTINA") return { background: "#ffffff", color: "#241720" };
    if (assignment.type === "POMERIGGIO") return { background: "#eef5fb", color: "#24354f" };
  }

  const status = assignment.kind === "CUSTOM" ? customAssignmentAvailabilityStatus(assignment) : "lavoro";
  return {
    background: backgroundForStatus(status),
    color: status === "riposo" ? "#244226" : status === "malattia" ? "#635100" : status === "permesso" ? "#24354f" : status === "non_lavorato" ? "#5e2424" : "#241720"
  };
}

function groupEmployees(schedule: ScheduleData, dateISO: string) {
  const active = schedule.employees.filter((employee) => employee.active);

  const buildGroup = (store: Store) => ({
    key: store,
    title: STORE_LABELS[store].toUpperCase(),
    employees: active.filter((employee) => getStoreForDate(employee, dateISO) === store)
  });

  return [buildGroup("duomo"), buildGroup("buenos_aires")];
}

function referenceDateForMonth(dates: string[], requested?: string) {
  if (requested && DATE_REGEX.test(requested) && dates.includes(requested)) {
    return requested;
  }

  const todayISO = toISODate(new Date());
  if (dates.includes(todayISO)) {
    return todayISO;
  }

  return dates[0] ?? todayISO;
}

function getPrintScale(employeeCount: number, dayCount: number, groupCount: number) {
  let scale = 1;

  if (dayCount >= 31) {
    scale -= 0.03;
  } else if (dayCount >= 30) {
    scale -= 0.02;
  }

  if (employeeCount > 14) {
    scale -= Math.min(0.17, (employeeCount - 14) * 0.013);
  }

  if (groupCount > 1) {
    scale -= 0.03;
  }

  return Math.max(0.76, Number(scale.toFixed(2)));
}

export default async function PrintMonthPage({
  params,
  searchParams
}: {
  params: { month: string };
  searchParams?: { ref?: string };
}) {
  const session = await getAppSession();
  if (!session?.user) {
    redirect("/login");
  }

  if (!MONTH_REGEX.test(params.month)) {
    notFound();
  }

  const schedule = await getLocalSchedule(params.month);
  const dates = monthDates(params.month);
  const referenceDateISO = referenceDateForMonth(dates, searchParams?.ref);
  const groups = groupEmployees(schedule, referenceDateISO);
  const activeEmployees = schedule.employees.filter((employee) => employee.active);
  const printScale = getPrintScale(activeEmployees.length, dates.length, groups.filter((group) => group.employees.length > 0).length || 1);
  const legend = legendItems(schedule);

  const hoursByEmployee = Object.fromEntries(
    schedule.employees.map((employee) => [
      employee.id,
      Number(
        dates
          .reduce(
            (sum, dateISO) => sum + assignmentHours(getEffectiveAssignmentForDate(employee, dateISO, schedule.assignments[employee.id]?.[dateISO] ?? null)),
            0
          )
          .toFixed(2)
      )
    ])
  );

  return (
    <main className={styles.page} style={{ "--print-scale": String(printScale) } as CSSProperties}>
      <PrintLauncher monthLabel={formatMonthLabel(params.month)} />

      <div className={styles.sheetViewport}>
        <section className={styles.sheet}>
          <div className={styles.header}>
            <div className={styles.brandBlock}>
              <span className={styles.brandMark}>Tp</span>
              <div>
                <span className={styles.kicker}>Paradise Studio</span>
                <h1 className={styles.title}>TABELLA TURNISTICA ({formatMonthLabel(params.month).toUpperCase()})</h1>
              </div>
            </div>
          </div>

          <div className={styles.legendRow}>
            <span>Legenda:</span>
            {legend.length > 0 ? (
              legend.map((item) => (
                <span key={item.label} className={styles.legendChip} style={{ background: item.background }}>
                  {item.label}
                </span>
              ))
            ) : (
              <span className={styles.legendChip}>Legenda da configurare</span>
            )}
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.employeeHead}>Dipendente</th>
                  {dates.map((dateISO) => {
                    const date = parseISODate(dateISO);
                    return (
                      <th key={dateISO} className={`${styles.dayHead} ${isWeekend(dateISO) ? styles.weekend : ""}`}>
                        <div>{date.toLocaleDateString("it-IT", { weekday: "short" })}</div>
                        <strong>{date.getDate()}</strong>
                      </th>
                    );
                  })}
                  <th className={styles.hoursHead}>Ore</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.key}>
                    <tr className={styles.storeSectionRow}>
                      <td colSpan={dates.length + 2} className={styles.storeSectionCell}>
                        <div className={styles.storeHeader}>
                          <span className={styles.storeTitle}>{group.title}</span>
                          <span className={styles.storeCount}>{group.employees.length} persone</span>
                        </div>
                      </td>
                    </tr>

                    {group.employees.map((employee) => (
                      <tr key={employee.id}>
                        <th className={styles.employeeCell}>
                          <span className={styles.employeeName}>{employee.fullName}</span>
                        </th>
                        {dates.map((dateISO) => {
                          const assignment = getEffectiveAssignmentForDate(employee, dateISO, schedule.assignments[employee.id]?.[dateISO] ?? null);
                          return (
                            <td key={dateISO} className={isWeekend(dateISO) ? styles.weekend : ""}>
                              <span className={styles.label} style={cellStyle(schedule, employee.id, dateISO)}>
                                {printLabel(assignment)}
                              </span>
                            </td>
                          );
                        })}
                        <td className={styles.hoursCell}>{hoursByEmployee[employee.id]} h</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <p className={styles.note}>
            Suddivisione negozi sulla data {parseISODate(referenceDateISO).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })}.
          </p>
        </section>
      </div>
    </main>
  );
}
