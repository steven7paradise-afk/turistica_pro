"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "@/app/turnistica/turnistica.module.css";
import { HistoryDrawer } from "@/app/turnistica/_components/HistoryDrawer";
import { SchedulingAssistantPanel } from "@/app/turnistica/_components/SchedulingAssistantPanel";
import { ShiftAssistantPanel } from "@/app/turnistica/_components/ShiftAssistantPanel";
import { ShiftEditorModal } from "@/app/turnistica/_components/ShiftEditorModal";
import { ShiftGrid } from "@/app/turnistica/_components/ShiftGrid";
import { ShiftOptionsPanel } from "@/app/turnistica/_components/ShiftOptionsPanel";
import { TurnisticaHeader } from "@/app/turnistica/_components/TurnisticaHeader";
import {
  getAudit,
  getSchedule,
  getVersions,
  publishSchedule,
  putSchedule,
  restoreVersion,
  updateEmployee
} from "@/app/turnistica/_lib/api";
import {
  AvailabilityStatus,
  AssignmentMatrix,
  AuditItem,
  Employee,
  EmployeeRule,
  SaveState,
  ScheduleData,
  ScheduleVersionItem,
  SessionUser,
  ShiftMutationResult,
  ShiftRecord,
  ShiftTemplate
} from "@/app/turnistica/_lib/types";
import {
  assignmentHours,
  availabilityStatusToAssignment,
  availabilityStatusFromAssignment,
  cloneMatrix,
  formatMonthLabel,
  formatPeriodLabel,
  getEffectiveAssignmentForDate,
  getStoreForDate,
  monthDates,
  parseISODate,
  toISODate
} from "@/app/turnistica/_lib/utils";
import { isManualShiftAssignment, shiftRecordFromAssignment } from "@/lib/shifts";

const HISTORY_LIMIT = 30;
const AUTOSAVE_MS = 800;

type Props = {
  user: SessionUser;
  initialSchedule: ScheduleData;
  initialVersions: ScheduleVersionItem[];
};

type ShiftEditorTarget = {
  employeeId: string;
  dateISO: string;
  store: "duomo" | "buenos_aires";
  shift?: ShiftRecord | null;
} | null;

export function TurnisticaApp({ user, initialSchedule, initialVersions }: Props) {
  const [monthKey, setMonthKey] = useState(initialSchedule.monthKey);
  const [loading, setLoading] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>(initialSchedule.employees);
  const [templates, setTemplates] = useState<ShiftTemplate[]>(initialSchedule.templates);
  const [rules, setRules] = useState<EmployeeRule[]>(initialSchedule.rules);
  const [assignments, setAssignments] = useState<AssignmentMatrix>(initialSchedule.assignments);

  const [version, setVersion] = useState(initialSchedule.version);
  const [scheduleStatus, setScheduleStatus] = useState<"DRAFT" | "PUBLISHED">(initialSchedule.status);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSavedAt, setLastSavedAt] = useState(new Date(initialSchedule.updatedAt).toLocaleTimeString("it-IT"));
  const [toast, setToast] = useState("");

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [versions, setVersions] = useState<ScheduleVersionItem[]>(initialVersions);
  const [auditEmployeeFilter, setAuditEmployeeFilter] = useState("");

  const [past, setPast] = useState<AssignmentMatrix[]>([]);
  const [future, setFuture] = useState<AssignmentMatrix[]>([]);
  const [shiftEditorTarget, setShiftEditorTarget] = useState<ShiftEditorTarget>(null);
  const initializedRef = useRef(false);

  const readOnly = user.role === "STAFF";
  const canRestore = user.role === "ADMIN";
  const hasEmployees = employees.length > 0;

  const dates = useMemo(() => monthDates(monthKey), [monthKey]);
  const allMonthDates = useMemo(() => monthDates(monthKey), [monthKey]);
  const storeReferenceDateISO = useMemo(() => {
    const todayISO = toISODate(new Date());
    if (dates.includes(todayISO)) {
      return todayISO;
    }
    return dates[0] ?? todayISO;
  }, [dates]);
  const periodLabel = useMemo(() => formatPeriodLabel(dates), [dates]);
  const printTitle = useMemo(() => formatMonthLabel(monthKey).toUpperCase(), [monthKey]);
  const totalMonthHours = useMemo(
    () => employees.reduce((total, employee) => total + getHours(employee.id), 0),
    [employees, assignments, allMonthDates]
  );
  const activeEmployees = useMemo(() => employees.filter((employee) => employee.active), [employees]);
  const duomoCount = useMemo(
    () => activeEmployees.filter((employee) => getStoreForDate(employee, storeReferenceDateISO) === "duomo").length,
    [activeEmployees, storeReferenceDateISO]
  );
  const buenosCount = useMemo(
    () => activeEmployees.filter((employee) => getStoreForDate(employee, storeReferenceDateISO) === "buenos_aires").length,
    [activeEmployees, storeReferenceDateISO]
  );

  const saveLabel = useMemo(() => {
    if (saveState === "dirty") return "Modifiche non salvate";
    if (saveState === "saving") return "Salvataggio in corso";
    if (saveState === "saved") return `Salvato ${lastSavedAt}`;
    if (saveState === "conflict") return "Conflitto versione";
    if (saveState === "error") return "Errore salvataggio";
    return "Pronto";
  }, [saveState, lastSavedAt]);

  function setToastTimed(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function loadSchedule(targetMonth: string) {
    setLoading(true);
    try {
      const data = await getSchedule(targetMonth);
      setEmployees(data.employees);
      setTemplates(data.templates);
      setRules(data.rules);
      setAssignments(data.assignments);
      setPast([]);
      setFuture([]);
      setVersion(data.version);
      setScheduleStatus(data.status);
      setSaveState("saved");
      setLastSavedAt(new Date(data.updatedAt).toLocaleTimeString("it-IT"));
    } catch (error) {
      setToastTimed(error instanceof Error ? error.message : "Errore caricamento");
    } finally {
      setLoading(false);
    }
  }

  async function flushDirtyAssignments() {
    if (readOnly || saveState !== "dirty") {
      return true;
    }

    setSaveState("saving");
    try {
      const response = await putSchedule(monthKey, version, assignments);
      setVersion(response.version);
      setScheduleStatus("DRAFT");
      setLastSavedAt(new Date(response.updatedAt).toLocaleTimeString("it-IT"));
      setSaveState("saved");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Errore salvataggio";
      setSaveState("error");
      setToastTimed(message);
      return false;
    }
  }

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

    void loadSchedule(monthKey);
  }, [monthKey]);

  useEffect(() => {
    if (readOnly || saveState !== "dirty") return;

    const timeout = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const response = await putSchedule(monthKey, version, assignments);
        setVersion(response.version);
        setScheduleStatus("DRAFT");
        setLastSavedAt(new Date(response.updatedAt).toLocaleTimeString("it-IT"));
        setSaveState("saved");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Errore salvataggio";
        if (message.toLowerCase().includes("conflitto")) {
          setSaveState("conflict");
          setToastTimed("Conflitto di modifica rilevato. Ricarica il mese per continuare.");
        } else {
          setSaveState("error");
          setToastTimed(message);
        }
      }
    }, AUTOSAVE_MS);

    return () => window.clearTimeout(timeout);
  }, [assignments, monthKey, readOnly, saveState, version]);

  function commitMatrix(next: AssignmentMatrix, withHistory = true) {
    if (withHistory) {
      setPast((current) => [cloneMatrix(assignments), ...current].slice(0, HISTORY_LIMIT));
      setFuture([]);
    }
    setAssignments(next);
    setSaveState("dirty");
  }

  function availabilityForSelection(value: string, previous?: AvailabilityStatus | null): AvailabilityStatus | null {
    if (!value) {
      return null;
    }

    if (value === "RIPOSO") return "riposo";
    if (value === "MALATTIA") return "malattia";
    if (value === "FERIE") return "non_lavorato";
    if (value === "SPECIAL:PERMESSO") return "permesso";
    if (value.startsWith("CUSTOM:")) {
      const templateId = value.slice(7);
      const template = templates.find((item) => item.id === templateId);
      if (template) {
        return template.availabilityStatus;
      }
    }
    return "lavoro";
  }

  async function syncEmployeeAvailability(employeeId: string, dateISO: string, nextStatus: AvailabilityStatus | null) {
    const currentEmployee = employees.find((employee) => employee.id === employeeId);
    if (!currentEmployee) return;

    const previousAvailability = currentEmployee.availability;
    const nextAvailability = { ...previousAvailability };
    if (nextStatus) {
      nextAvailability[dateISO] = nextStatus;
    } else {
      delete nextAvailability[dateISO];
    }

    setEmployees((current) =>
      current.map((employee) => (employee.id === employeeId ? { ...employee, availability: nextAvailability } : employee))
    );

    try {
      const updated = await updateEmployee({ id: employeeId, availability: nextAvailability });
      setEmployees((current) => current.map((employee) => (employee.id === employeeId ? updated : employee)));
    } catch (error) {
      setEmployees((current) =>
        current.map((employee) => (employee.id === employeeId ? { ...employee, availability: previousAvailability } : employee))
      );
      setToastTimed(error instanceof Error ? error.message : "Errore salvataggio disponibilita");
    }
  }

  function onChangeCell(employeeId: string, dateISO: string, value: string) {
    if (readOnly) return;
    const next = cloneMatrix(assignments);
    if (!next[employeeId]) next[employeeId] = {};

    if (!value) {
      next[employeeId][dateISO] = null;
    }
    if (value) {
      const standard = ["MATTINA", "POMERIGGIO", "FULL", "RIPOSO", "FERIE", "MALATTIA"].includes(value);
      const template = templates.find((item) => `CUSTOM:${item.id}` === value);

      if (standard) {
        next[employeeId][dateISO] = {
          kind: "STANDARD",
          type: value as "MATTINA" | "POMERIGGIO" | "FULL" | "RIPOSO" | "FERIE" | "MALATTIA"
        };
      } else if (template) {
        next[employeeId][dateISO] = {
          kind: "CUSTOM",
          templateId: template.id,
          name: template.name,
          shortCode: template.shortCode,
          availabilityStatus: template.availabilityStatus,
          startTime: template.startTime,
          endTime: template.endTime,
          unpaidBreakMinutes: template.unpaidBreakMinutes
        };
      } else if (value === "SPECIAL:PERMESSO") {
        next[employeeId][dateISO] = availabilityStatusToAssignment("permesso");
      }
    }

    commitMatrix(next, true);

    const employee = employees.find((item) => item.id === employeeId);
    const previous = employee ? availabilityStatusFromAssignment(getEffectiveAssignmentForDate(employee, dateISO, assignments[employeeId]?.[dateISO] ?? null)) : null;
    void syncEmployeeAvailability(employeeId, dateISO, availabilityForSelection(value, previous));
  }

  async function onToggleStore(employeeId: string, dateISO: string) {
    if (readOnly) return;

    const employee = employees.find((item) => item.id === employeeId);
    if (!employee) return;

    const currentStore = getStoreForDate(employee, dateISO);
    const nextStore = currentStore === "duomo" ? "buenos_aires" : "duomo";
    const previousOverrides = employee.overrideStoreByDate ?? {};
    const nextOverrides: Record<string, "duomo" | "buenos_aires"> = { ...previousOverrides, [dateISO]: nextStore };

    if (nextStore === employee.homeStore) {
      delete nextOverrides[dateISO];
    }

    setEmployees((current) =>
      current.map((item) =>
        item.id === employeeId
          ? {
              ...item,
              overrideStoreByDate: Object.keys(nextOverrides).length > 0 ? nextOverrides : undefined
            }
          : item
      )
    );

    try {
      const updated = await updateEmployee({
        id: employeeId,
        overrideStoreByDate: Object.keys(nextOverrides).length > 0 ? nextOverrides : {}
      });
      setEmployees((current) => current.map((item) => (item.id === employeeId ? updated : item)));
      setToastTimed(
        `${updated.fullName} lavora a ${
          getStoreForDate(updated, dateISO) === "duomo" ? "Duomo" : "Corso Buenos Aires"
        } il ${parseISODate(dateISO).toLocaleDateString("it-IT", { day: "numeric", month: "long" })}`
      );
    } catch (error) {
      setEmployees((current) => current.map((item) => (item.id === employeeId ? employee : item)));
      setToastTimed(error instanceof Error ? error.message : "Errore aggiornamento negozio");
    }
  }

  function undo() {
    if (readOnly || past.length === 0) return;
    const [last, ...rest] = past;
    setFuture((current) => [cloneMatrix(assignments), ...current].slice(0, HISTORY_LIMIT));
    setPast(rest);
    setAssignments(last);
    setSaveState("dirty");
  }

  function redo() {
    if (readOnly || future.length === 0) return;
    const [next, ...rest] = future;
    setPast((current) => [cloneMatrix(assignments), ...current].slice(0, HISTORY_LIMIT));
    setFuture(rest);
    setAssignments(next);
    setSaveState("dirty");
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (typing) return;

      const command = event.ctrlKey || event.metaKey;
      if (!command || event.key.toLowerCase() !== "z") return;

      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  function getHours(employeeId: string) {
    const employee = employees.find((item) => item.id === employeeId);
    if (!employee) return 0;

    const total = allMonthDates.reduce(
      (sum, dateISO) => sum + assignmentHours(getEffectiveAssignmentForDate(employee, dateISO, assignments[employeeId]?.[dateISO] ?? null)),
      0
    );
    return Number(total.toFixed(2));
  }

  async function refreshHistory() {
    setHistoryLoading(true);
    try {
      const [auditItems, versionItems] = await Promise.all([
        getAudit(monthKey, auditEmployeeFilter || undefined),
        getVersions(monthKey)
      ]);
      setAudit(auditItems);
      setVersions(versionItems);
    } catch (error) {
      setToastTimed(error instanceof Error ? error.message : "Errore caricamento cronologia");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (!historyOpen) return;
    void refreshHistory();
  }, [historyOpen, auditEmployeeFilter, monthKey]);

  async function onPublish() {
    if (readOnly) return;
    try {
      const response = await publishSchedule(monthKey);
      setVersion(response.version);
      setScheduleStatus("PUBLISHED");
      setSaveState("saved");
      setToastTimed("Mese pubblicato con snapshot");
      if (historyOpen) {
        await refreshHistory();
      }
    } catch (error) {
      setToastTimed(error instanceof Error ? error.message : "Errore pubblicazione");
    }
  }

  async function onRestore(versionId: string) {
    if (!canRestore) return;
    try {
      const response = await restoreVersion(versionId);
      setVersion(response.version);
      setScheduleStatus("DRAFT");
      await loadSchedule(monthKey);
      setToastTimed("Versione ripristinata");
      await refreshHistory();
    } catch (error) {
      setToastTimed(error instanceof Error ? error.message : "Errore ripristino");
    }
  }

  async function changeMonth(targetMonth: string) {
    if (!targetMonth || targetMonth === monthKey || loading) return;

    if (!(await flushDirtyAssignments())) {
      return;
    }

    setMonthKey(targetMonth);
  }

  function openShiftEditor(input?: { employeeId?: string; dateISO?: string; store?: "duomo" | "buenos_aires"; shift?: ShiftRecord | null }) {
    const fallbackEmployee = activeEmployees[0];
    const targetDateISO = input?.dateISO || storeReferenceDateISO;
    const targetEmployeeId = input?.employeeId || fallbackEmployee?.id || "";
    const employee = activeEmployees.find((item) => item.id === targetEmployeeId) || fallbackEmployee;
    const fallbackStore = employee ? getStoreForDate(employee, targetDateISO) : "duomo";

    setShiftEditorTarget({
      employeeId: targetEmployeeId,
      dateISO: targetDateISO,
      store: input?.store || fallbackStore,
      shift: input?.shift || null
    });
  }

  async function handleShiftSaved(result: ShiftMutationResult) {
    setToastTimed(result.warnings.length > 0 ? result.warnings[0] : result.items.length > 1 ? "Turno duplicato sul mese." : "Turno salvato.");
    await loadSchedule(monthKey);
  }

  async function handleShiftDeleted(payload: { version: number; updatedAt: string }) {
    setVersion(payload.version);
    setLastSavedAt(new Date(payload.updatedAt).toLocaleTimeString("it-IT"));
    setToastTimed("Turno eliminato.");
    await loadSchedule(monthKey);
  }

  if (loading) {
    return <main className={styles.skeleton}>Caricamento turnistica...</main>;
  }

  return (
    <main className={styles.page}>
      <TurnisticaHeader
        monthValue={monthKey}
        monthLabel={formatMonthLabel(monthKey)}
        periodLabel={periodLabel}
        readOnly={readOnly}
        monthDisabled={loading || saveState === "saving"}
        saveLabel={saveLabel}
        scheduleStatus={scheduleStatus}
        version={version}
        onMonthChange={changeMonth}
        onCreateShift={() => openShiftEditor()}
        onPublish={onPublish}
        onPrint={() => {
          const url = `/stampa/${monthKey}?ref=${storeReferenceDateISO}`;
          const popup = window.open(url, "_blank", "noopener,noreferrer");
          if (!popup) {
            window.location.assign(url);
          }
        }}
        onOpenAudit={() => setHistoryOpen(true)}
      />

      <section className={`${styles.overviewGrid} noPrint`}>
        <article className={styles.overviewCard}>
          <span className={styles.overviewLabel}>Duomo</span>
          <strong>{duomoCount}</strong>
        </article>
        <article className={styles.overviewCard}>
          <span className={styles.overviewLabel}>Corso Buenos Aires</span>
          <strong>{buenosCount}</strong>
        </article>
        <article className={styles.overviewCard}>
          <span className={styles.overviewLabel}>Ore del mese</span>
          <strong>{totalMonthHours.toFixed(1)}</strong>
        </article>
        <article className={styles.overviewCard}>
          <span className={styles.overviewLabel}>Riferimento negozi</span>
          <strong>{parseISODate(storeReferenceDateISO).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}</strong>
        </article>
      </section>

      <section className={`${styles.toolbar} noPrint`}>
        <button type="button" onClick={undo} disabled={readOnly || past.length === 0}>
          Undo
        </button>
        <button type="button" onClick={redo} disabled={readOnly || future.length === 0}>
          Redo
        </button>
      </section>

      <ShiftOptionsPanel
        readOnly={readOnly}
        templates={templates}
        beforePersist={flushDirtyAssignments}
        onRefresh={() => loadSchedule(monthKey)}
      />

      <ShiftAssistantPanel
        readOnly={readOnly}
        employees={activeEmployees}
        rules={rules}
        assignments={assignments}
        dates={dates}
        beforePersist={flushDirtyAssignments}
        onRulesChange={setRules}
      />

      <SchedulingAssistantPanel monthKey={monthKey} />

      {readOnly ? <p className={`${styles.readOnlyNotice} noPrint`}>Accesso in sola lettura: puoi visualizzare e stampare, ma non modificare il piano.</p> : null}

      {hasEmployees ? (
        <ShiftGrid
          dates={dates}
          employees={activeEmployees}
          templates={templates}
          rules={rules}
          assignments={assignments}
          readOnly={readOnly}
          monthValue={monthKey}
          monthDisabled={loading || saveState === "saving"}
          titleForPrint={printTitle}
          periodLabel={periodLabel}
          storeReferenceDateISO={storeReferenceDateISO}
          onChange={onChangeCell}
          onMonthChange={changeMonth}
          onToggleStore={onToggleStore}
          onOpenShiftEditor={({ employeeId, dateISO, store, assignment }) =>
            openShiftEditor({
              employeeId,
              dateISO,
              store,
              shift: isManualShiftAssignment(assignment) ? shiftRecordFromAssignment(employeeId, dateISO, assignment) : null
            })
          }
          getHours={getHours}
        />
      ) : (
        <section className={styles.emptySetupCard}>
          <h2>Prima inserisci il personale</h2>
          <p>La griglia mensile appare appena aggiungi almeno una persona. Da questa base la turnistica diventa subito stampabile e condivisibile nella rete del salone.</p>
          <Link href="/turnistica/personale" className={styles.linkButton}>
            Apri Personale
          </Link>
        </section>
      )}

      <HistoryDrawer
        open={historyOpen}
        canRestore={canRestore}
        loading={historyLoading}
        audit={audit}
        versions={versions}
        selectedEmployee={auditEmployeeFilter}
        employees={employees}
        onClose={() => setHistoryOpen(false)}
        onEmployeeFilter={setAuditEmployeeFilter}
        onRestore={onRestore}
      />

      <ShiftEditorModal
        open={Boolean(shiftEditorTarget)}
        monthKey={monthKey}
        employees={activeEmployees}
        target={shiftEditorTarget}
        beforePersist={flushDirtyAssignments}
        onClose={() => setShiftEditorTarget(null)}
        onSaved={(result) => {
          void handleShiftSaved(result);
        }}
        onDeleted={(payload) => {
          void handleShiftDeleted(payload);
        }}
      />

      {toast ? <div className={styles.toast}>{toast}</div> : null}
    </main>
  );
}
