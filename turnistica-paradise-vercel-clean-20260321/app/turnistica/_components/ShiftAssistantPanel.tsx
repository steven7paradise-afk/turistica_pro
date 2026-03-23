"use client";

import { useEffect, useMemo, useState } from "react";
import { deleteRule, upsertRule } from "@/app/turnistica/_lib/api";
import type { AssignmentMatrix, Employee, EmployeeRule } from "@/app/turnistica/_lib/types";
import { analyzeRuleAlerts, IT_WEEKDAY_LABELS, parseISODate, sortUniqueNumbers, sortUniqueStrings } from "@/app/turnistica/_lib/utils";
import styles from "@/app/turnistica/_components/studio.module.css";

type Props = {
  readOnly: boolean;
  employees: Employee[];
  rules: EmployeeRule[];
  assignments: AssignmentMatrix;
  dates: string[];
  beforePersist?: () => Promise<boolean>;
  onRulesChange: (nextRules: EmployeeRule[]) => void;
};

export function ShiftAssistantPanel({ readOnly, employees, rules, assignments, dates, beforePersist, onRulesChange }: Props) {
  const activeEmployees = useMemo(() => employees.filter((employee) => employee.active), [employees]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(activeEmployees[0]?.id ?? "");
  const [mustWorkWeekdays, setMustWorkWeekdays] = useState<number[]>([]);
  const [avoidRestWithEmployeeIds, setAvoidRestWithEmployeeIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!activeEmployees.some((employee) => employee.id === selectedEmployeeId)) {
      setSelectedEmployeeId(activeEmployees[0]?.id ?? "");
    }
  }, [activeEmployees, selectedEmployeeId]);

  const selectedEmployee = useMemo(
    () => activeEmployees.find((employee) => employee.id === selectedEmployeeId) ?? null,
    [activeEmployees, selectedEmployeeId]
  );
  const selectedRule = useMemo(
    () => (selectedEmployee ? rules.find((rule) => rule.employeeId === selectedEmployee.id) ?? null : null),
    [rules, selectedEmployee]
  );
  const coworkerOptions = useMemo(
    () => activeEmployees.filter((employee) => employee.id !== selectedEmployee?.id),
    [activeEmployees, selectedEmployee]
  );

  useEffect(() => {
    setMustWorkWeekdays(selectedRule?.mustWorkWeekdays ?? []);
    setAvoidRestWithEmployeeIds(selectedRule?.avoidRestWithEmployeeIds ?? []);
  }, [selectedRule?.id, selectedEmployee?.id, selectedRule?.mustWorkWeekdays, selectedRule?.avoidRestWithEmployeeIds]);

  const alerts = useMemo(() => {
    if (!selectedEmployee) return [];
    return analyzeRuleAlerts({
      employee: selectedEmployee,
      rule: selectedRule ?? undefined,
      employees: activeEmployees,
      assignments,
      dates
    });
  }, [activeEmployees, assignments, dates, selectedEmployee, selectedRule]);

  async function ensureReady() {
    if (!beforePersist) return true;
    const ready = await beforePersist();
    if (!ready) {
      setMessage("Salva prima le modifiche del mese per aggiornare l'assistente turni.");
    }
    return ready;
  }

  async function saveAssistantRule(nextMustWorkWeekdays: number[], nextAvoidRestWithEmployeeIds: string[], clearOnly = false) {
    if (!selectedEmployee || readOnly) return;
    if (!(await ensureReady())) return;

    setSaving(true);
    setMessage("");
    try {
      const normalizedMustWorkWeekdays = sortUniqueNumbers(nextMustWorkWeekdays);
      const normalizedAvoidRest = sortUniqueStrings(nextAvoidRestWithEmployeeIds.filter((employeeId) => employeeId !== selectedEmployee.id));

      if (
        clearOnly &&
        !selectedRule?.unavailableWeekdays.length &&
        !selectedRule?.unavailableDates.length &&
        !selectedRule?.forbiddenShiftIds.length &&
        !selectedRule?.preferredShiftId &&
        !(selectedRule?.note ?? "").trim()
      ) {
        if (selectedRule?.id) {
          await deleteRule(selectedRule.id);
          onRulesChange(rules.filter((rule) => rule.id !== selectedRule.id));
        }
      } else {
        const savedRule = await upsertRule({
          id: selectedRule?.id,
          employeeId: selectedEmployee.id,
          unavailableWeekdays: selectedRule?.unavailableWeekdays ?? [],
          unavailableDates: selectedRule?.unavailableDates ?? [],
          forbiddenShiftIds: selectedRule?.forbiddenShiftIds ?? [],
          preferredShiftId: selectedRule?.preferredShiftId ?? null,
          mustWorkWeekdays: normalizedMustWorkWeekdays,
          avoidRestWithEmployeeIds: normalizedAvoidRest,
          note: selectedRule?.note ?? ""
        });

        onRulesChange([...rules.filter((rule) => rule.employeeId !== selectedEmployee.id), savedRule]);
      }

      setMustWorkWeekdays(normalizedMustWorkWeekdays);
      setAvoidRestWithEmployeeIds(normalizedAvoidRest);
      setMessage(clearOnly ? "Vincoli assistente rimossi." : "Assistente turni aggiornato.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Errore salvataggio assistente.");
    } finally {
      setSaving(false);
    }
  }

  function toggleWeekday(weekday: number) {
    setMustWorkWeekdays((current) =>
      current.includes(weekday) ? current.filter((item) => item !== weekday) : sortUniqueNumbers([...current, weekday])
    );
  }

  function toggleCoworker(employeeId: string) {
    setAvoidRestWithEmployeeIds((current) =>
      current.includes(employeeId)
        ? current.filter((item) => item !== employeeId)
        : sortUniqueStrings([...current, employeeId])
    );
  }

  return (
    <section className={`${styles.panel} noPrint`}>
      <div className={styles.panelHeader}>
        <div>
          <h3 className={styles.panelTitle}>Assistente IA turni</h3>
          <p className={styles.panelSubtitle}>
            Qui salvi le regole intelligenti del mese. Per esempio: una persona non deve andare in riposo in certi giorni, oppure non può riposare insieme a un'altra collega.
          </p>
        </div>
        <span className={styles.badge}>{alerts.length} alert</span>
      </div>

      {message ? <div className={styles.notice}>{message}</div> : null}

      <div className={styles.formRow}>
        <label className={styles.fieldSpan}>
          Dipendente da controllare
          <select className={styles.select} value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)} disabled={activeEmployees.length === 0}>
            {activeEmployees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedEmployee ? (
        <>
          <div className={styles.ruleSection}>
            <span className={styles.ruleSectionTitle}>Non può andare in riposo di</span>
            <div className={styles.chipWrap}>
              {IT_WEEKDAY_LABELS.map((weekdayLabel, weekday) => (
                <button
                  key={weekdayLabel}
                  type="button"
                  className={`${styles.toggleChip} ${mustWorkWeekdays.includes(weekday) ? styles.toggleChipActive : ""}`}
                  onClick={() => toggleWeekday(weekday)}
                  disabled={readOnly}
                >
                  <strong>{weekdayLabel}</strong>
                  <small>Evita riposo</small>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.ruleSection}>
            <span className={styles.ruleSectionTitle}>Non può riposare con</span>
            <div className={styles.chipWrap}>
              {coworkerOptions.length > 0 ? (
                coworkerOptions.map((employee) => (
                  <button
                    key={employee.id}
                    type="button"
                    className={`${styles.toggleChip} ${avoidRestWithEmployeeIds.includes(employee.id) ? styles.toggleChipActive : ""}`}
                    onClick={() => toggleCoworker(employee.id)}
                    disabled={readOnly}
                  >
                    <strong>{employee.fullName}</strong>
                    <small>Riposo separato</small>
                  </button>
                ))
              ) : (
                <span className={styles.helperInline}>Aggiungi almeno due persone attive per usare questa regola.</span>
              )}
            </div>
          </div>

          {!readOnly ? (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.button}
                disabled={saving}
                onClick={() => void saveAssistantRule(mustWorkWeekdays, avoidRestWithEmployeeIds)}
              >
                {saving ? "Salvataggio..." : "Salva assistente"}
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={saving || (mustWorkWeekdays.length === 0 && avoidRestWithEmployeeIds.length === 0)}
                onClick={() => void saveAssistantRule([], [], true)}
              >
                Pulisci vincoli
              </button>
            </div>
          ) : (
            <p className={styles.helperInline}>Accesso in sola lettura: puoi vedere i conflitti ma non modificare le regole.</p>
          )}

          <div className={styles.ruleSection}>
            <span className={styles.ruleSectionTitle}>Analisi mese</span>
            <ul className={styles.list}>
              {alerts.length === 0 ? (
                <li className={styles.emptyInline}>
                  Nessun conflitto trovato per {selectedEmployee.fullName}. Appena compare un riposo non compatibile, l'assistente lo segnala qui.
                </li>
              ) : (
                alerts.map((alert) => (
                  <li key={alert.id} className={styles.listItem}>
                    <div className={styles.itemMain}>
                      <span className={styles.itemTitle}>
                        {parseISODate(alert.dateISO).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}
                      </span>
                      <span className={styles.itemMeta}>{alert.message}</span>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      ) : (
        <p className={styles.helperInline}>Aggiungi personale attivo per usare l'assistente turni.</p>
      )}
    </section>
  );
}
