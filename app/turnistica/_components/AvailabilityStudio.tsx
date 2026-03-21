"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import availabilityStyles from "@/app/turnistica/_components/availability.module.css";
import { EmployeeAvatar } from "@/app/turnistica/_components/EmployeeAvatar";
import studioStyles from "@/app/turnistica/_components/studio.module.css";
import { getSchedule, updateEmployee, upsertRule } from "@/app/turnistica/_lib/api";
import type { AvailabilityStatus, AssignmentMatrix, Employee, EmployeeRule, SaveState, ScheduleData, SessionUser, Store } from "@/app/turnistica/_lib/types";
import {
  AVAILABILITY_LABELS,
  assignmentHours,
  formatHours,
  formatMonthLabel,
  getEffectiveAssignmentForDate,
  getAvailabilityStatusForDate,
  isWeekend,
  monthDates,
  monthNav,
  parseISODate,
  STORE_LABELS,
  toMonthKey
} from "@/app/turnistica/_lib/utils";
import gridStyles from "@/app/turnistica/turnistica.module.css";

const STATUS_ORDER: AvailabilityStatus[] = ["lavoro", "riposo", "malattia", "permesso", "non_lavorato"];

const STATUS_STYLE: Record<
  AvailabilityStatus,
  { label: string; code: string; background: string; borderColor: string; color: string; description: string }
> = {
  lavoro: {
    label: "Lavoro",
    code: "L",
    background: "#ffffff",
    borderColor: "rgba(225, 208, 218, 0.98)",
    color: "#33222b",
    description: "Persona disponibile al lavoro"
  },
  riposo: {
    label: "Riposo",
    code: "R",
    background: "var(--shift-riposo)",
    borderColor: "rgba(191, 215, 183, 0.96)",
    color: "#2d4629",
    description: "Giornata di riposo"
  },
  malattia: {
    label: "Malattia",
    code: "MA",
    background: "var(--shift-malattia)",
    borderColor: "rgba(223, 206, 123, 0.92)",
    color: "#63511f",
    description: "Assenza per malattia"
  },
  permesso: {
    label: "Permesso",
    code: "PE",
    background: "var(--shift-permesso)",
    borderColor: "rgba(176, 197, 225, 0.96)",
    color: "#24354f",
    description: "Permesso o uscita autorizzata"
  },
  non_lavorato: {
    label: "Non lavorato",
    code: "NL",
    background: "var(--shift-ferie)",
    borderColor: "rgba(228, 170, 170, 0.96)",
    color: "#6b2e2e",
    description: "Assenza non operativa"
  }
};

type Props = {
  user: SessionUser;
  initialSchedule: ScheduleData;
};

function defaultQuickDate(monthKey: string, dates: string[]) {
  const today = toMonthKey(new Date()) === monthKey ? new Date() : null;
  const todayISO = today
    ? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
    : "";

  if (todayISO && dates.includes(todayISO)) {
    return todayISO;
  }

  return dates[0] ?? "";
}

function saveStateLabel(saveState: SaveState, lastSavedAt: string) {
  if (saveState === "saving") return "Salvataggio in corso";
  if (saveState === "saved") return `Salvato ${lastSavedAt}`;
  if (saveState === "error") return "Errore salvataggio";
  return "Pronto";
}

function groupByHomeStore(employees: Employee[]): Array<{ store: Store; title: string; employees: Employee[] }> {
  return [
    { store: "duomo", title: STORE_LABELS.duomo.toUpperCase(), employees: employees.filter((employee) => employee.homeStore === "duomo") },
    {
      store: "buenos_aires",
      title: STORE_LABELS.buenos_aires.toUpperCase(),
      employees: employees.filter((employee) => employee.homeStore === "buenos_aires")
    }
  ];
}

export function AvailabilityStudio({ user, initialSchedule }: Props) {
  const [monthKey, setMonthKey] = useState(initialSchedule.monthKey);
  const [employees, setEmployees] = useState<Employee[]>(initialSchedule.employees.filter((employee) => employee.active));
  const [rules, setRules] = useState<EmployeeRule[]>(initialSchedule.rules);
  const [assignments, setAssignments] = useState<AssignmentMatrix>(initialSchedule.assignments);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSavedAt, setLastSavedAt] = useState(new Date(initialSchedule.updatedAt).toLocaleTimeString("it-IT"));
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("ALL");
  const [employeeNote, setEmployeeNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const initializedRef = useRef(false);

  const readOnly = user.role === "STAFF";
  const dates = useMemo(() => monthDates(monthKey), [monthKey]);
  const [quickDateISO, setQuickDateISO] = useState(() => defaultQuickDate(initialSchedule.monthKey, monthDates(initialSchedule.monthKey)));
  const filteredEmployees = useMemo(() => {
    if (selectedEmployeeId === "ALL") {
      return employees;
    }
    return employees.filter((employee) => employee.id === selectedEmployeeId);
  }, [employees, selectedEmployeeId]);
  const groups = useMemo(() => groupByHomeStore(filteredEmployees), [filteredEmployees]);
  const selectedEmployee = useMemo(
    () => (selectedEmployeeId === "ALL" ? null : employees.find((employee) => employee.id === selectedEmployeeId) ?? null),
    [employees, selectedEmployeeId]
  );
  const selectedRule = useMemo(
    () => (selectedEmployee ? rules.find((rule) => rule.employeeId === selectedEmployee.id) ?? null : null),
    [rules, selectedEmployee]
  );

  const stats = useMemo(() => {
    const counters: Record<AvailabilityStatus, number> = {
      lavoro: 0,
      riposo: 0,
      malattia: 0,
      permesso: 0,
      non_lavorato: 0
    };

    employees.forEach((employee) => {
      dates.forEach((dateISO) => {
        const status = getAvailabilityStatusForDate(employee, dateISO, assignments[employee.id]?.[dateISO] ?? null, { defaultToWork: true });
        if (status) {
          counters[status] += 1;
        }
      });
    });

    return counters;
  }, [assignments, dates, employees]);

  const selectedEmployeeHours = useMemo(() => {
    if (!selectedEmployee) return 0;

    const total = dates.reduce(
      (sum, dateISO) =>
        sum +
        assignmentHours(
          getEffectiveAssignmentForDate(selectedEmployee, dateISO, assignments[selectedEmployee.id]?.[dateISO] ?? null)
        ),
      0
    );

    return Number(total.toFixed(2));
  }, [assignments, dates, selectedEmployee]);

  const selectedEmployeeStats = useMemo(() => {
    if (!selectedEmployee) {
      return {
        lavoro: 0,
        riposo: 0,
        malattia: 0,
        permesso: 0,
        non_lavorato: 0
      };
    }

    return dates.reduce(
      (acc, dateISO) => {
        const status = getAvailabilityStatusForDate(
          selectedEmployee,
          dateISO,
          assignments[selectedEmployee.id]?.[dateISO] ?? null,
          { defaultToWork: true }
        );

        if (status) {
          acc[status] += 1;
        }

        return acc;
      },
      {
        lavoro: 0,
        riposo: 0,
        malattia: 0,
        permesso: 0,
        non_lavorato: 0
      } as Record<AvailabilityStatus, number>
    );
  }, [assignments, dates, selectedEmployee]);

  function setMessageTimed(next: string) {
    setMessage(next);
    window.setTimeout(() => setMessage(""), 3200);
  }

  useEffect(() => {
    setQuickDateISO((current) => (current && dates.includes(current) ? current : defaultQuickDate(monthKey, dates)));
  }, [dates, monthKey]);

  useEffect(() => {
    setEmployeeNote(selectedRule?.note ?? "");
  }, [selectedRule?.id, selectedRule?.note, selectedEmployee?.id]);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

    async function loadSchedule(targetMonth: string) {
      setLoading(true);
      try {
        const data = await getSchedule(targetMonth);
        const nextEmployees = data.employees.filter((employee) => employee.active);
        setEmployees(nextEmployees);
        setRules(data.rules);
        setAssignments(data.assignments);
        setSelectedEmployeeId((current) => (current === "ALL" || nextEmployees.some((employee) => employee.id === current) ? current : "ALL"));
        setSaveState("saved");
        setLastSavedAt(new Date(data.updatedAt).toLocaleTimeString("it-IT"));
      } catch (error) {
        setMessageTimed(error instanceof Error ? error.message : "Errore caricamento disponibilita");
      } finally {
        setLoading(false);
      }
    }

    void loadSchedule(monthKey);
  }, [monthKey]);

  async function cycleStatus(employee: Employee, dateISO: string) {
    if (readOnly) return;

    const currentStatus = getAvailabilityStatusForDate(employee, dateISO, assignments[employee.id]?.[dateISO] ?? null, { defaultToWork: true }) || "lavoro";
    const currentIndex = STATUS_ORDER.indexOf(currentStatus);
    const nextStatus = STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length] || "lavoro";
    const previousAvailability = employee.availability;
    const nextAvailability = {
      ...employee.availability,
      [dateISO]: nextStatus
    };

    setSaveState("saving");
    setEmployees((current) => current.map((item) => (item.id === employee.id ? { ...item, availability: nextAvailability } : item)));

    try {
      const updated = await updateEmployee({ id: employee.id, availability: nextAvailability });
      setEmployees((current) => current.map((item) => (item.id === employee.id ? updated : item)));
      setLastSavedAt(new Date(updated.updatedAt).toLocaleTimeString("it-IT"));
      setSaveState("saved");
    } catch (error) {
      setEmployees((current) => current.map((item) => (item.id === employee.id ? { ...item, availability: previousAvailability } : item)));
      setSaveState("error");
      setMessageTimed(error instanceof Error ? error.message : "Errore salvataggio disponibilita");
    }
  }

  async function setStatus(employee: Employee, dateISO: string, nextStatus: AvailabilityStatus) {
    if (readOnly) return;

    const previousAvailability = employee.availability;
    const nextAvailability = {
      ...employee.availability,
      [dateISO]: nextStatus
    };

    setSaveState("saving");
    setEmployees((current) => current.map((item) => (item.id === employee.id ? { ...item, availability: nextAvailability } : item)));

    try {
      const updated = await updateEmployee({ id: employee.id, availability: nextAvailability });
      setEmployees((current) => current.map((item) => (item.id === employee.id ? updated : item)));
      setLastSavedAt(new Date(updated.updatedAt).toLocaleTimeString("it-IT"));
      setSaveState("saved");
      setMessageTimed(`${updated.fullName}: ${AVAILABILITY_LABELS[nextStatus]} impostato per ${parseISODate(dateISO).toLocaleDateString("it-IT", { day: "numeric", month: "long" })}`);
    } catch (error) {
      setEmployees((current) => current.map((item) => (item.id === employee.id ? { ...item, availability: previousAvailability } : item)));
      setSaveState("error");
      setMessageTimed(error instanceof Error ? error.message : "Errore salvataggio disponibilita");
    }
  }

  async function saveSelectedNote() {
    if (!selectedEmployee) return;

    setNoteSaving(true);
    try {
      const savedRule = await upsertRule({
        id: selectedRule?.id,
        employeeId: selectedEmployee.id,
        unavailableWeekdays: selectedRule?.unavailableWeekdays ?? [],
        unavailableDates: selectedRule?.unavailableDates ?? [],
        forbiddenShiftIds: selectedRule?.forbiddenShiftIds ?? [],
        preferredShiftId: selectedRule?.preferredShiftId ?? null,
        note: employeeNote.trim()
      });

      setRules((current) => [...current.filter((rule) => rule.employeeId !== selectedEmployee.id), savedRule]);
      setMessageTimed(`Nota aggiornata per ${selectedEmployee.fullName}`);
    } catch (error) {
      setMessageTimed(error instanceof Error ? error.message : "Errore salvataggio nota");
    } finally {
      setNoteSaving(false);
    }
  }

  if (loading) {
    return <main className={studioStyles.loading}>Caricamento disponibilita...</main>;
  }

  return (
    <main className={studioStyles.page}>
      <section className={studioStyles.hero}>
        <span className={studioStyles.eyebrow}>Disponibilita</span>
        <h2 className={studioStyles.title}>Una pagina dedicata solo agli stati giornalieri del team.</h2>
        <p className={studioStyles.subtitle}>
          Qui imposti soltanto la disponibilita del mese: lavoro, riposo, malattia, permesso e non lavorato. Le opzioni orarie di lavoro invece le configuri direttamente dentro `Pianificazione`.
        </p>

        <div className={availabilityStyles.heroChips}>
          {STATUS_ORDER.map((status) => (
            <div key={status} className={availabilityStyles.statusChip}>
              <span
                className={availabilityStyles.statusCode}
                style={{ background: STATUS_STYLE[status].background, borderColor: STATUS_STYLE[status].borderColor, color: STATUS_STYLE[status].color }}
              >
                {STATUS_STYLE[status].code}
              </span>
              <span className={availabilityStyles.statusMeta}>
                <span className={availabilityStyles.statusLabel}>{STATUS_STYLE[status].label}</span>
                <span className={availabilityStyles.statusDescription}>{STATUS_STYLE[status].description}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className={studioStyles.summaryGrid}>
        <article className={studioStyles.summaryCard}>
          <span className={studioStyles.summaryLabel}>Team attivo</span>
          <strong className={studioStyles.summaryValue}>{employees.length}</strong>
        </article>
        <article className={studioStyles.summaryCard}>
          <span className={studioStyles.summaryLabel}>Lavoro</span>
          <strong className={studioStyles.summaryValue}>{stats.lavoro}</strong>
        </article>
        <article className={studioStyles.summaryCard}>
          <span className={studioStyles.summaryLabel}>Riposi</span>
          <strong className={studioStyles.summaryValue}>{stats.riposo}</strong>
        </article>
        <article className={studioStyles.summaryCard}>
          <span className={studioStyles.summaryLabel}>Assenze</span>
          <strong className={studioStyles.summaryValue}>{stats.malattia + stats.permesso + stats.non_lavorato}</strong>
        </article>
      </section>

      {message ? <div className={studioStyles.notice}>{message}</div> : null}

      <section className={studioStyles.panel}>
        <div className={studioStyles.panelHeader}>
          <div>
            <h3 className={studioStyles.panelTitle}>Controlli rapidi del mese</h3>
            <p className={studioStyles.panelSubtitle}>Ogni click cicla lo stato del giorno e salva direttamente dentro `person.availability[date]`.</p>
          </div>
          <span className={studioStyles.badge}>{saveStateLabel(saveState, lastSavedAt)}</span>
        </div>

        <div className={availabilityStyles.controlsGrid}>
          <div className={availabilityStyles.employeeFilterWrap}>
            <div className={availabilityStyles.monthToolbar}>
              <button type="button" className={studioStyles.secondaryButton} onClick={() => setMonthKey(monthNav(monthKey, -1))}>
                Mese precedente
              </button>
              <span className={availabilityStyles.monthLabel}>{formatMonthLabel(monthKey)}</span>
              <button type="button" className={studioStyles.secondaryButton} onClick={() => setMonthKey(monthNav(monthKey, 1))}>
                Mese successivo
              </button>
              <button type="button" className={studioStyles.button} onClick={() => setMonthKey(toMonthKey(new Date()))}>
                Vai a oggi
              </button>
            </div>

            <div className={studioStyles.formRow}>
              <label className={studioStyles.field}>
                Persona visibile
                <select className={studioStyles.select} value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
                  <option value="ALL">Tutto il team</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.fullName}
                    </option>
                  ))}
                </select>
              </label>

              <label className={studioStyles.field}>
                Salvataggio
                <input className={studioStyles.input} value={saveStateLabel(saveState, lastSavedAt)} readOnly aria-label="Stato salvataggio disponibilita" />
              </label>
            </div>
          </div>

          <aside className={availabilityStyles.helperCard}>
            {selectedEmployee ? (
              <div className={availabilityStyles.employeeFocus}>
                <div className={availabilityStyles.employeeFocusHeader}>
                  <EmployeeAvatar fullName={selectedEmployee.fullName} photoUrl={selectedEmployee.photoUrl} size="md" />
                  <div className={availabilityStyles.employeeFocusMeta}>
                    <span className={availabilityStyles.helperTitle}>Scheda persona</span>
                    <strong className={availabilityStyles.employeeFocusName}>{selectedEmployee.fullName}</strong>
                    <span className={availabilityStyles.employeeFocusStore}>{STORE_LABELS[selectedEmployee.homeStore]} · {formatHours(selectedEmployeeHours)} h nel mese</span>
                  </div>
                </div>

                <label className={studioStyles.field}>
                  Giorno rapido
                  <input className={studioStyles.input} type="date" value={quickDateISO} onChange={(event) => setQuickDateISO(event.target.value)} min={dates[0]} max={dates[dates.length - 1]} />
                </label>

                <div className={availabilityStyles.quickActions}>
                  {STATUS_ORDER.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={availabilityStyles.quickAction}
                      style={{ background: STATUS_STYLE[status].background, borderColor: STATUS_STYLE[status].borderColor, color: STATUS_STYLE[status].color }}
                      disabled={readOnly || !quickDateISO}
                      onClick={() => void setStatus(selectedEmployee, quickDateISO, status)}
                    >
                      <span>{STATUS_STYLE[status].code}</span>
                      <strong>{STATUS_STYLE[status].label}</strong>
                    </button>
                  ))}
                </div>

                <div className={availabilityStyles.focusStats}>
                  <span className={availabilityStyles.tableStat}>{selectedEmployeeStats.lavoro} lavoro</span>
                  <span className={availabilityStyles.tableStat}>{selectedEmployeeStats.riposo} riposi</span>
                  <span className={availabilityStyles.tableStat}>{selectedEmployeeStats.permesso} permessi</span>
                  <span className={availabilityStyles.tableStat}>{selectedEmployeeStats.malattia + selectedEmployeeStats.non_lavorato} assenze</span>
                </div>

                <label className={studioStyles.field}>
                  Nota / cosa fa
                  <textarea
                    className={studioStyles.textarea}
                    value={employeeNote}
                    onChange={(event) => setEmployeeNote(event.target.value)}
                    placeholder="Es. receptionist, colore, piega, supporto cassa, preferenze utili..."
                    rows={4}
                  />
                </label>

                <div className={studioStyles.actions}>
                  <button type="button" className={studioStyles.button} disabled={noteSaving || readOnly} onClick={() => void saveSelectedNote()}>
                    {noteSaving ? "Salvataggio..." : "Salva nota"}
                  </button>
                  <a
                    href={`/stampa/${monthKey}?employeeId=${selectedEmployee.id}&ref=${quickDateISO || dates[0] || ""}`}
                    target="_blank"
                    rel="noreferrer"
                    className={studioStyles.secondaryButton}
                  >
                    Stampa scheda
                  </a>
                </div>
              </div>
            ) : (
              <>
                <span className={availabilityStyles.helperTitle}>Scheda persona</span>
                <p className={availabilityStyles.helperText}>
                  Seleziona una persona dal filtro per vedere nota, ore del mese, azioni rapide come `Permesso` e la stampa dedicata.
                </p>
              </>
            )}
          </aside>
        </div>
      </section>

      {readOnly ? <div className={studioStyles.notice}>Accesso in sola lettura: puoi consultare le disponibilita ma non modificarle.</div> : null}

      <section className={gridStyles.gridSection}>
        <div className={gridStyles.gridMetaBar}>
          <div className={gridStyles.gridMetaGroup}>
            <span className={gridStyles.gridMetaEyebrow}>Vista disponibilita</span>
            <strong className={gridStyles.gridMetaTitle}>Griglia mensile · {formatMonthLabel(monthKey)}</strong>
          </div>
          <div className={availabilityStyles.tableHeaderMeta}>
            <span className={availabilityStyles.tableStat}>{filteredEmployees.length} persone visibili</span>
            <span className={availabilityStyles.tableStat}>{dates.length} giorni</span>
          </div>
        </div>

        <p className={availabilityStyles.sectionLead}>Un click per cambiare stato. Il ciclo segue questo ordine: lavoro, riposo, malattia, permesso, non lavorato.</p>

        <div className={gridStyles.tableShell}>
          <div className={gridStyles.tableWrap}>
            <div className={gridStyles.storeMatrix}>
              {groups.map((group) => (
                <section key={group.store} className={gridStyles.storeTableSection}>
                  <div className={gridStyles.storeTableHeader}>
                    <span className={gridStyles.storeTableTitle}>{group.title}</span>
                    <span className={gridStyles.storeTableCount}>{group.employees.length} persone</span>
                  </div>

                  <table className={gridStyles.gridTable}>
                    <thead>
                      <tr>
                        <th className={`${gridStyles.stickyCol} ${gridStyles.employeeHead}`}>Dipendente</th>
                        {dates.map((dateISO) => {
                          const date = parseISODate(dateISO);
                          return (
                            <th key={dateISO} className={`${gridStyles.dayHead} ${isWeekend(dateISO) ? gridStyles.weekendHead : ""}`}>
                              <div className={gridStyles.dayHeadInner}>
                                <span className={gridStyles.dayWeekday}>{date.toLocaleDateString("it-IT", { weekday: "short" })}</span>
                                <strong className={gridStyles.dayNumber}>{date.getDate()}</strong>
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {group.employees.map((employee) => (
                        <tr key={employee.id} className={gridStyles.bodyRow}>
                          <th className={`${gridStyles.stickyCol} ${gridStyles.employeeCell}`}>
                            <div className={gridStyles.employeeIdentity}>
                              <EmployeeAvatar fullName={employee.fullName} photoUrl={employee.photoUrl} size="print" />
                              <span className={gridStyles.employeeName}>{employee.fullName}</span>
                            </div>
                          </th>

                          {dates.map((dateISO) => {
                            const status = getAvailabilityStatusForDate(employee, dateISO, assignments[employee.id]?.[dateISO] ?? null, { defaultToWork: true }) || "lavoro";
                            const style = STATUS_STYLE[status];

                            return (
                              <td key={dateISO} className={`${gridStyles.shiftCell} ${isWeekend(dateISO) ? gridStyles.weekendCell : ""}`}>
                                <button
                                  type="button"
                                  disabled={readOnly}
                                  className={`${gridStyles.cellButton} ${readOnly ? gridStyles.cellButtonReadOnly : ""}`}
                                  style={{ background: style.background, borderColor: style.borderColor, color: style.color }}
                                  onClick={() => cycleStatus(employee, dateISO)}
                                  aria-label={`Disponibilita ${employee.fullName} ${dateISO}`}
                                >
                                  <span className={gridStyles.cellCode}>{style.code}</span>
                                  <span className={gridStyles.cellCaption}>{AVAILABILITY_LABELS[status]}</span>
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
