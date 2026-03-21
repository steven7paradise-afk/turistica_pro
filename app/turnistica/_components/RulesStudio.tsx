"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { formatHours, formatTemplateSummary, shiftDurationHours, STANDARD_SHIFT_LABELS, sortUniqueNumbers, sortUniqueStrings } from "@/app/turnistica/_lib/utils";
import { createTemplate, deleteRule, deleteTemplate, getRules, getTemplates, upsertRule } from "@/app/turnistica/_lib/api";
import type { Employee, EmployeeRule, ShiftId, ShiftTemplate } from "@/app/turnistica/_lib/types";
import styles from "@/app/turnistica/_components/studio.module.css";

type Props = {
  initialEmployees: Employee[];
  initialTemplates: ShiftTemplate[];
  initialRules: EmployeeRule[];
};

const WEEKDAY_OPTIONS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Gio" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sab" },
  { value: 0, label: "Dom" }
] as const;

export function RulesStudio({ initialEmployees, initialTemplates, initialRules }: Props) {
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [templates, setTemplates] = useState<ShiftTemplate[]>(initialTemplates);
  const [rules, setRules] = useState<EmployeeRule[]>(initialRules);
  const [message, setMessage] = useState("");

  const [templateName, setTemplateName] = useState("");
  const [templateStart, setTemplateStart] = useState("09:00");
  const [templateEnd, setTemplateEnd] = useState("18:00");
  const [templateBreakMinutes, setTemplateBreakMinutes] = useState(60);

  const [employeeId, setEmployeeId] = useState(() => initialEmployees.find((employee) => employee.active)?.id ?? "");
  const [unavailableWeekdays, setUnavailableWeekdays] = useState<number[]>([]);
  const [unavailableDates, setUnavailableDates] = useState<string[]>([]);
  const [dateDraft, setDateDraft] = useState("");
  const [forbiddenShiftIds, setForbiddenShiftIds] = useState<string[]>([]);
  const [preferredShiftId, setPreferredShiftId] = useState<ShiftId | "">("");
  const [note, setNote] = useState("");

  const shiftOptions = useMemo(
    () => [
      ...Object.entries(STANDARD_SHIFT_LABELS).map(([id, label]) => ({ id, label, description: label })),
      ...templates.map((template) => ({
        id: `CUSTOM:${template.id}`,
        label: template.name,
        description: formatTemplateSummary(template)
      }))
    ],
    [templates]
  );

  const templatePaidHours = useMemo(
    () => shiftDurationHours(templateStart, templateEnd, templateBreakMinutes),
    [templateBreakMinutes, templateEnd, templateStart]
  );

  const selectedRule = useMemo(() => rules.find((rule) => rule.employeeId === employeeId), [employeeId, rules]);

  useEffect(() => {
    if (!selectedRule) {
      setUnavailableWeekdays([]);
      setUnavailableDates([]);
      setForbiddenShiftIds([]);
      setPreferredShiftId("");
      setNote("");
      return;
    }

    setUnavailableWeekdays(selectedRule.unavailableWeekdays);
    setUnavailableDates(selectedRule.unavailableDates);
    setForbiddenShiftIds(selectedRule.forbiddenShiftIds);
    setPreferredShiftId(selectedRule.preferredShiftId ?? "");
    setNote(selectedRule.note);
  }, [selectedRule]);

  function toggleWeekday(value: number) {
    setUnavailableWeekdays((current) =>
      current.includes(value) ? current.filter((day) => day !== value) : sortUniqueNumbers([...current, value])
    );
  }

  function toggleForbiddenShift(shiftId: string) {
    setForbiddenShiftIds((current) =>
      current.includes(shiftId) ? current.filter((item) => item !== shiftId) : sortUniqueStrings([...current, shiftId])
    );
  }

  function addUnavailableDate() {
    if (!dateDraft) return;
    setUnavailableDates((current) => sortUniqueStrings([...current, dateDraft]));
    setDateDraft("");
  }

  function removeUnavailableDate(targetDate: string) {
    setUnavailableDates((current) => current.filter((date) => date !== targetDate));
  }

  async function onTemplateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await createTemplate({
        name: templateName.trim(),
        shortCode: templateName
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? "")
          .join("")
          .slice(0, 4) || "TR",
        availabilityStatus: "lavoro",
        startTime: templateStart,
        endTime: templateEnd,
        unpaidBreakMinutes: templateBreakMinutes
      });
      setTemplateName("");
      setTemplateBreakMinutes(60);
      setMessage("Turno personalizzato salvato");
      setTemplates(await getTemplates());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Errore salvataggio turno");
    }
  }

  async function onRuleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employeeId) return;

    try {
      await upsertRule({
        id: selectedRule?.id,
        employeeId,
        unavailableWeekdays,
        unavailableDates,
        forbiddenShiftIds,
        preferredShiftId: preferredShiftId || null,
        note
      });
      setMessage("Regola dipendente salvata");
      setRules(await getRules());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Errore salvataggio regola");
    }
  }

  async function onDeleteTemplate(id: string) {
    try {
      await deleteTemplate(id);
      setMessage("Template rimosso");
      setTemplates(await getTemplates());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Errore rimozione template");
    }
  }

  async function onDeleteRule(id: string) {
    try {
      await deleteRule(id);
      setMessage("Regola eliminata");
      setRules(await getRules());
      setUnavailableWeekdays([]);
      setUnavailableDates([]);
      setForbiddenShiftIds([]);
      setPreferredShiftId("");
      setNote("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Errore rimozione regola");
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>Regole e Template</span>
        <h2 className={styles.title}>Configurazioni ordinate, leggibili e utili davvero quando compili il mese.</h2>
        <p className={styles.subtitle}>
          Qui imposti turni personalizzati, preferenze, indisponibilità ricorrenti e date specifiche. In pianificazione restano solo le azioni operative: tutto il resto vive qui, in un ambiente più pulito.
        </p>
      </section>

      <section className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Dipendenti</span>
          <strong className={styles.summaryValue}>{employees.filter((employee) => employee.active).length}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Template custom</span>
          <strong className={styles.summaryValue}>{templates.length}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Regole attive</span>
          <strong className={styles.summaryValue}>{rules.length}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Suggerimenti</span>
          <strong className={styles.summaryValue}>Attivi</strong>
        </article>
      </section>

      {message ? <div className={styles.notice}>{message}</div> : null}

      <section className={styles.panelGrid}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <h3 className={styles.panelTitle}>Opzioni rapide create da te</h3>
              <p className={styles.panelSubtitle}>Qui definisci i turni che vuoi usare nella griglia: nome opzione, ora inizio, ora fine e pausa non retribuita.</p>
            </div>
          </header>

          <form onSubmit={onTemplateSubmit} className={styles.formRow}>
            <label className={styles.fieldSpan}>
              Nome opzione
              <input className={styles.input} value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Es. Apertura salone" required />
            </label>
            <label className={styles.field}>
              Ora inizio
              <input className={styles.input} type="time" value={templateStart} onChange={(event) => setTemplateStart(event.target.value)} placeholder="09:00" required />
            </label>
            <label className={styles.field}>
              Ora fine
              <input className={styles.input} type="time" value={templateEnd} onChange={(event) => setTemplateEnd(event.target.value)} placeholder="18:00" required />
            </label>
            <label className={styles.field}>
              Pausa non retribuita
              <input
                className={styles.input}
                type="number"
                min="0"
                step="5"
                value={templateBreakMinutes}
                onChange={(event) => setTemplateBreakMinutes(Math.max(0, Number(event.target.value || 0)))}
                placeholder="60"
                required
              />
            </label>
            <label className={styles.field}>
              Ore pagate
              <input className={styles.input} value={`${formatHours(templatePaidHours)} h`} readOnly aria-label="Ore pagate del turno" />
            </label>
            <div className={styles.actions}>
              <button type="submit" className={styles.button} disabled={!templateName.trim() || templatePaidHours <= 0}>
                Salva opzione
              </button>
            </div>
          </form>

          <ul className={styles.list}>
            {templates.map((template) => (
              <li key={template.id} className={styles.listItem}>
                <div className={styles.itemMain}>
                  <span className={styles.itemTitle}>{template.name}</span>
                  <span className={styles.itemMeta}>{formatTemplateSummary(template)}</span>
                </div>
                <button type="button" className={styles.dangerButton} onClick={() => onDeleteTemplate(template.id)}>
                  Rimuovi
                </button>
              </li>
            ))}
          </ul>
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <h3 className={styles.panelTitle}>Regola dipendente</h3>
              <p className={styles.panelSubtitle}>Preferenze e indisponibilità vengono usate anche dai suggerimenti automatici della pianificazione.</p>
            </div>
          </header>

          <form onSubmit={onRuleSubmit} className={styles.ruleForm}>
            <label className={styles.fieldSpan}>
              Dipendente
              <select className={styles.select} value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} required>
                <option value="">Seleziona persona</option>
                {employees.filter((employee) => employee.active).map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.fullName}
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.ruleSection}>
              <span className={styles.ruleSectionTitle}>Giorni ricorrenti non disponibili</span>
              <div className={styles.chipWrap}>
                {WEEKDAY_OPTIONS.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    className={`${styles.toggleChip} ${unavailableWeekdays.includes(day.value) ? styles.toggleChipActive : ""}`}
                    onClick={() => toggleWeekday(day.value)}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.ruleSection}>
              <span className={styles.ruleSectionTitle}>Date specifiche non disponibili</span>
              <div className={styles.inlineComposer}>
                <input className={styles.input} type="date" value={dateDraft} onChange={(event) => setDateDraft(event.target.value)} />
                <button type="button" className={styles.secondaryButton} onClick={addUnavailableDate} disabled={!dateDraft}>
                  Aggiungi data
                </button>
              </div>
              <div className={styles.datePillList}>
                {unavailableDates.length === 0 ? <span className={styles.helperInline}>Nessuna data specifica inserita.</span> : null}
                {unavailableDates.map((date) => (
                  <span key={date} className={styles.datePill}>
                    <span>{new Date(date).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}</span>
                    <button type="button" onClick={() => removeUnavailableDate(date)} aria-label={`Rimuovi ${date}`}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.ruleSection}>
              <span className={styles.ruleSectionTitle}>Turni da evitare</span>
              <div className={styles.chipWrap}>
                {shiftOptions.map((shift) => (
                  <button
                    key={shift.id}
                    type="button"
                    className={`${styles.toggleChip} ${forbiddenShiftIds.includes(shift.id) ? styles.toggleChipActive : ""}`}
                    onClick={() => toggleForbiddenShift(shift.id)}
                  >
                    <strong>{shift.label}</strong>
                    <small>{shift.description}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.ruleSection}>
              <span className={styles.ruleSectionTitle}>Turno preferito</span>
              <div className={styles.chipWrap}>
                <button
                  type="button"
                  className={`${styles.toggleChip} ${preferredShiftId === "" ? styles.toggleChipActive : ""}`}
                  onClick={() => setPreferredShiftId("")}
                >
                  Nessuna preferenza
                </button>
                {shiftOptions.map((shift) => (
                  <button
                    key={shift.id}
                    type="button"
                    className={`${styles.toggleChip} ${preferredShiftId === shift.id ? styles.toggleChipActive : ""}`}
                    onClick={() => setPreferredShiftId(shift.id as ShiftId)}
                  >
                    <strong>{shift.label}</strong>
                    <small>{shift.description}</small>
                  </button>
                ))}
              </div>
            </div>

            <label className={styles.fieldSpan}>
              Nota interna
              <textarea className={styles.textarea} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Indicazioni utili per la pianificazione" />
            </label>

            <div className={styles.actions}>
              <button type="submit" className={styles.button} disabled={!employeeId}>
                Salva regola
              </button>
              {selectedRule ? (
                <button type="button" className={styles.dangerButton} onClick={() => onDeleteRule(selectedRule.id)}>
                  Elimina regola
                </button>
              ) : null}
            </div>
          </form>
        </article>

        <article className={`${styles.panel} ${styles.panelWide}`}>
          <header className={styles.panelHeader}>
            <div>
              <h3 className={styles.panelTitle}>Quadro regole salvate</h3>
              <p className={styles.panelSubtitle}>Riepilogo veloce delle preferenze e delle limitazioni attive sul team.</p>
            </div>
            <span className={styles.badge}>{rules.length} regole</span>
          </header>

          {rules.length === 0 ? (
            <div className={styles.empty}>Nessuna regola impostata. Seleziona una persona e salva la sua configurazione.</div>
          ) : (
            <div className={styles.ruleGrid}>
              {rules.map((rule) => {
                const employee = employees.find((item) => item.id === rule.employeeId);
                return (
                  <article key={rule.id} className={styles.ruleCard}>
                    <div className={styles.ruleCardHeader}>
                      <div>
                        <div className={styles.itemTitle}>{employee?.fullName ?? rule.employeeId}</div>
                        <div className={styles.itemMeta}>{rule.note || "Nessuna nota"}</div>
                      </div>
                      <button type="button" className={styles.secondaryButton} onClick={() => setEmployeeId(rule.employeeId)}>
                        Apri
                      </button>
                    </div>
                    <div className={styles.ruleChips}>
                      <span className={styles.ruleChip}>
                        Giorni: {rule.unavailableWeekdays.length > 0 ? rule.unavailableWeekdays.join(", ") : "-"}
                      </span>
                      <span className={styles.ruleChip}>
                        Date: {rule.unavailableDates.length > 0 ? rule.unavailableDates.length : 0}
                      </span>
                      <span className={styles.ruleChip}>
                        Vietati: {rule.forbiddenShiftIds.length > 0 ? rule.forbiddenShiftIds.length : 0}
                      </span>
                      <span className={styles.ruleChip}>Preferito: {rule.preferredShiftId || "-"}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
