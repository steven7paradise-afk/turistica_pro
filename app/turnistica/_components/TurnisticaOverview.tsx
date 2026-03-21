import styles from "@/app/turnistica/_components/overview.module.css";
import { EmployeeAvatar } from "@/app/turnistica/_components/EmployeeAvatar";
import type { AvailabilityStatus, ScheduleData, ShiftAssignment, Store } from "@/app/turnistica/_lib/types";
import {
  assignmentLabel,
  AVAILABILITY_LABELS,
  getAvailabilityStatusForDate,
  getStoreForDate,
  hasStoreOverrideForDate,
  isPermessoAssignment,
  parseISODate,
  STANDARD_SHIFT_COLORS,
  STORE_LABELS
} from "@/app/turnistica/_lib/utils";

type DayPerson = {
  id: string;
  fullName: string;
  photoUrl?: string | null;
  assignment: ShiftAssignment;
  status: AvailabilityStatus | null;
  moved: boolean;
};

type OverviewPerson = DayPerson & { store: Store };

type DayCardProps = {
  title: string;
  dateISO: string;
  people: OverviewPerson[];
};

type StoreBlockProps = {
  title: string;
  people: DayPerson[];
};

function badgeStyle(status: AvailabilityStatus | null, assignment: ShiftAssignment) {
  if (status === "riposo") return { background: "#dbeed6" };
  if (status === "malattia") return { background: "#f7edb1" };
  if (status === "permesso") return { background: "#d9e6f5" };
  if (status === "non_lavorato") return { background: "#f4c8c8" };
  if (!assignment) return { background: "#f7eef4" };
  if (assignment.kind === "STANDARD") return { background: STANDARD_SHIFT_COLORS[assignment.type] };
  if (isPermessoAssignment(assignment)) return { background: "#d9e6f5" };
  return { background: "#f6e8ef" };
}

function badgeLabel(status: AvailabilityStatus | null, assignment: ShiftAssignment) {
  if (status && status !== "lavoro") {
    return AVAILABILITY_LABELS[status];
  }

  if (assignment) {
    return assignmentLabel(assignment);
  }

  if (status === "lavoro") {
    return AVAILABILITY_LABELS.lavoro;
  }

  return "Da confermare";
}

function StoreBlock({ title, people }: StoreBlockProps) {
  const available = people.filter((person) => person.status === "lavoro");
  const unavailable = people.filter((person) => person.status !== "lavoro");

  return (
    <section className={styles.storeBlock}>
      <div className={styles.storeHeader}>
        <h3 className={styles.storeTitle}>{title}</h3>
        <span className={styles.storeCount}>{available.length} disponibili</span>
      </div>

      <h4 className={styles.sectionTitle}>Disponibili</h4>
      {available.length > 0 ? (
        <ul className={styles.shiftList}>
          {available.map((person) => (
            <li key={person.id} className={styles.shiftItem}>
              <div className={styles.personCluster}>
                <EmployeeAvatar fullName={person.fullName} photoUrl={person.photoUrl} size="md" />
                <div className={styles.person}>
                  <span className={styles.personName}>
                    {person.fullName}
                  </span>
                  <span className={styles.personMeta}>Disponibile</span>
                </div>
              </div>
              <span className={styles.badge} style={badgeStyle(person.status, person.assignment)}>
                {badgeLabel(person.status, person.assignment)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>Nessuna persona disponibile.</p>
      )}

      <h4 className={styles.sectionTitle}>Non disponibili</h4>
      {unavailable.length > 0 ? (
        <ul className={styles.shiftList}>
          {unavailable.map((person) => (
            <li key={person.id} className={styles.shiftItem}>
              <div className={styles.personCluster}>
                <EmployeeAvatar fullName={person.fullName} photoUrl={person.photoUrl} size="md" />
                <div className={styles.person}>
                  <span className={styles.personName}>
                    {person.fullName}
                  </span>
                  <span className={styles.personMeta}>Non disponibile</span>
                </div>
              </div>
              <span className={styles.badge} style={badgeStyle(person.status, person.assignment)}>
                {badgeLabel(person.status, person.assignment)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>Nessuna persona non disponibile.</p>
      )}
    </section>
  );
}

function DayCard({ title, dateISO, people }: DayCardProps) {
  const byStore: Record<Store, OverviewPerson[]> = {
    duomo: people.filter((person) => person.store === "duomo"),
    buenos_aires: people.filter((person) => person.store === "buenos_aires")
  };

  const availableCount = people.filter((person) => person.status === "lavoro").length;

  return (
    <section className={styles.board}>
      <div className={styles.boardHeader}>
        <div>
          <h2 className={styles.boardTitle}>{title}</h2>
          <span className={styles.boardDate}>
            {parseISODate(dateISO).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}
          </span>
        </div>
        <span className={styles.boardCount}>{availableCount} disponibili</span>
      </div>

      <div className={styles.storeGrid}>
        <StoreBlock title={STORE_LABELS.duomo.toUpperCase()} people={byStore.duomo} />
        <StoreBlock title={STORE_LABELS.buenos_aires.toUpperCase()} people={byStore.buenos_aires} />
      </div>
    </section>
  );
}

type Props = {
  todayISO: string;
  tomorrowISO: string;
  todaySchedule: ScheduleData;
  tomorrowSchedule: ScheduleData;
};

function peopleForDate(schedule: ScheduleData, dateISO: string): OverviewPerson[] {
  return schedule.employees.map((employee) => {
    const assignment = schedule.assignments[employee.id]?.[dateISO] ?? null;
    return {
      id: employee.id,
      fullName: employee.fullName,
      photoUrl: employee.photoUrl,
      assignment,
      status: getAvailabilityStatusForDate(employee, dateISO, assignment),
      moved: hasStoreOverrideForDate(employee, dateISO),
      store: getStoreForDate(employee, dateISO)
    };
  });
}

export function TurnisticaOverview({ todayISO, tomorrowISO, todaySchedule, tomorrowSchedule }: Props) {
  const todayPeople = peopleForDate(todaySchedule, todayISO);
  const tomorrowPeople = peopleForDate(tomorrowSchedule, tomorrowISO);

  const todayDuomo = todayPeople.filter((person) => person.store === "duomo" && person.status === "lavoro").length;
  const todayBuenos = todayPeople.filter((person) => person.store === "buenos_aires" && person.status === "lavoro").length;

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroBadge}>
          <div className={styles.heroMark}>Tp</div>
          <div className={styles.heroBadgeText}>
            <span className={styles.eyebrow}>Vista operativa</span>
            <h2 className={styles.title}>Oggi e domani, divisi per negozio.</h2>
          </div>
        </div>
        <p className={styles.subtitle}>
          La home resta immediata, ma adesso distingue chiaramente il team di Duomo e quello di Corso Buenos Aires in base alla data reale.
        </p>
      </section>

      <section className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Disponibili oggi</span>
          <strong className={styles.summaryValue}>{todayPeople.filter((person) => person.status === "lavoro").length}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Disponibili domani</span>
          <strong className={styles.summaryValue}>{tomorrowPeople.filter((person) => person.status === "lavoro").length}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Duomo oggi</span>
          <strong className={styles.summaryValue}>{todayDuomo}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Corso oggi</span>
          <strong className={styles.summaryValue}>{todayBuenos}</strong>
        </article>
      </section>

      <section className={styles.boards}>
        <DayCard title="Oggi" dateISO={todayISO} people={todayPeople} />
        <DayCard title="Domani" dateISO={tomorrowISO} people={tomorrowPeople} />
      </section>
    </main>
  );
}
