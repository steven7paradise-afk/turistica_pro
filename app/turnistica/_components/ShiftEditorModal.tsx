"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "@/app/turnistica/_components/shift-editor.module.css";
import { createShift, deleteShift, ShiftApiError, updateShift } from "@/app/turnistica/_lib/api";
import type { Employee, ShiftConflictItem, ShiftMutationResult, ShiftRecord, ShiftWritePayload, Store } from "@/app/turnistica/_lib/types";
import { formatMonthLabel, monthDates, parseISODate, STORE_LABELS } from "@/app/turnistica/_lib/utils";
import { calculateWorkedHours, normalizeDuplicateDates, validateShiftPayload } from "@/lib/shifts";

type ShiftEditorTarget = {
  employeeId: string;
  dateISO: string;
  store: Store;
  shift?: ShiftRecord | null;
};

type Props = {
  open: boolean;
  monthKey: string;
  employees: Employee[];
  target: ShiftEditorTarget | null;
  beforePersist?: () => Promise<boolean>;
  onClose: () => void;
  onSaved: (result: ShiftMutationResult) => void;
  onDeleted: (payload: { version: number; updatedAt: string }) => void;
};

type FormState = Omit<ShiftWritePayload, "duplicateDates" | "note"> & {
  duplicateDates: string[];
  note: string;
};

const EMPTY_ERRORS: Partial<Record<"employeeId" | "store" | "dateISO" | "startTime" | "endTime" | "note" | "duplicateDates", string>> = {};

function buildInitialForm(target: ShiftEditorTarget | null, employees: Employee[], monthKey: string): FormState {
  const fallbackEmployee = employees[0];
  const fallbackDate = monthDates(monthKey)[0] || "";
  const fallbackStore = fallbackEmployee?.homeStore || "duomo";

  if (target?.shift) {
    return {
      employeeId: target.shift.employeeId,
      store: target.shift.store,
      dateISO: target.shift.dateISO,
      startTime: target.shift.startTime,
      endTime: target.shift.endTime,
      withStandardBreak: target.shift.breakMinutes === 60,
      note: target.shift.note || "",
      duplicateDates: []
    };
  }

  return {
    employeeId: target?.employeeId || fallbackEmployee?.id || "",
    store: target?.store || fallbackStore,
    dateISO: target?.dateISO || fallbackDate,
    startTime: "09:00",
    endTime: "18:00",
    withStandardBreak: true,
    note: "",
    duplicateDates: []
  };
}

function mapConflicts(conflicts: ShiftConflictItem[]) {
  const next: Partial<Record<"employeeId" | "store" | "dateISO" | "startTime" | "endTime" | "note" | "duplicateDates", string>> = {};

  conflicts.forEach((conflict) => {
    if (conflict.field && !next[conflict.field]) {
      next[conflict.field] = conflict.message;
    }
  });

  return next;
}

export function ShiftEditorModal({ open, monthKey, employees, target, beforePersist, onClose, onSaved, onDeleted }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<FormState>(() => buildInitialForm(target, employees, monthKey));
  const [fieldErrors, setFieldErrors] = useState(EMPTY_ERRORS);
  const [serverConflicts, setServerConflicts] = useState<ShiftConflictItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const editing = Boolean(target?.shift);
  const targetShift = target?.shift ?? null;
  const title = editing ? "Modifica turno" : "Nuovo turno";

  useEffect(() => {
    if (!open) return;
    setForm(buildInitialForm(target, employees, monthKey));
    setFieldErrors(EMPTY_ERRORS);
    setServerConflicts([]);
    setWarnings([]);
  }, [open, target, employees, monthKey]);

  useEffect(() => {
    if (!open || !dialogRef.current) return;

    const previousActive = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    const selector = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])"
    ].join(",");
    const focusables = Array.from(root.querySelectorAll<HTMLElement>(selector));
    focusables[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!submitting && !deleting) {
          onClose();
        }
        return;
      }

      if (event.key !== "Tab" || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousActive?.focus();
    };
  }, [open, onClose, submitting, deleting]);

  const duplicateOptions = useMemo(
    () =>
      monthDates(monthKey)
        .filter((dateISO) => dateISO !== form.dateISO)
        .map((dateISO) => ({
          dateISO,
          weekday: parseISODate(dateISO).toLocaleDateString("it-IT", { weekday: "short" }),
          day: parseISODate(dateISO).toLocaleDateString("it-IT", { day: "2-digit" })
        })),
    [form.dateISO, monthKey]
  );

  const workedHours = useMemo(
    () => calculateWorkedHours(form.startTime, form.endTime, form.withStandardBreak ? 60 : 0),
    [form.endTime, form.startTime, form.withStandardBreak]
  );

  const localWarnings = useMemo(() => {
    const validation = validateShiftPayload(form);
    return validation.warnings;
  }, [form]);

  if (!open || !target) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors(EMPTY_ERRORS);
    setServerConflicts([]);

    const payload: ShiftWritePayload = {
      ...form,
      note: form.note.trim() || null,
      duplicateDates: normalizeDuplicateDates(form.dateISO, form.duplicateDates)
    };

    const validation = validateShiftPayload(payload);
    if (!validation.ok) {
      setFieldErrors(mapConflicts(validation.conflicts));
      setServerConflicts(validation.conflicts);
      setWarnings(validation.warnings);
      return;
    }

    setSubmitting(true);
    try {
      if (beforePersist) {
        const ready = await beforePersist();
        if (!ready) {
          setWarnings((current) => [...new Set([...current, "Salva prima le modifiche del mese per continuare con il turno."])]);
          return;
        }
      }

      const result = editing && targetShift ? await updateShift(monthKey, targetShift.id, payload) : await createShift(monthKey, payload);
      onSaved(result);
      onClose();
    } catch (error) {
      if (error instanceof ShiftApiError) {
        setFieldErrors(mapConflicts(error.conflicts));
        setServerConflicts(error.conflicts);
        setWarnings(error.warnings);
      } else {
        setServerConflicts([{ dateISO: form.dateISO, message: error instanceof Error ? error.message : "Errore salvataggio turno." }]);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editing || !targetShift) return;
    setDeleting(true);
    try {
      if (beforePersist) {
        const ready = await beforePersist();
        if (!ready) {
          setWarnings((current) => [...new Set([...current, "Salva prima le modifiche del mese per eliminare il turno."])]);
          return;
        }
      }

      const result = await deleteShift(monthKey, targetShift.id);
      onDeleted(result);
      onClose();
    } catch (error) {
      setServerConflicts([{ dateISO: form.dateISO, message: error instanceof Error ? error.message : "Errore eliminazione turno." }]);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={() => {
        if (!submitting && !deleting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shift-editor-title"
        aria-describedby="shift-editor-subtitle"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.headerMeta}>
            <span className={styles.eyebrow}>{formatMonthLabel(monthKey)}</span>
            <h2 id="shift-editor-title" className={styles.title}>
              {title}
            </h2>
            <p id="shift-editor-subtitle" className={styles.subtitle}>
              Imposta negozio, persona, orari, pausa standard e duplicazione su più giorni dello stesso mese.
            </p>
          </div>

          <button type="button" className={styles.closeButton} onClick={onClose} disabled={submitting || deleting}>
            Chiudi
          </button>
        </div>

        <form className={styles.body} onSubmit={handleSubmit}>
          {serverConflicts.length > 0 ? (
            <div className={styles.alert} role="alert">
              {serverConflicts.map((conflict) => (
                <div key={`${conflict.dateISO}-${conflict.message}`}>{conflict.message}</div>
              ))}
            </div>
          ) : null}

          {warnings.length > 0 || localWarnings.length > 0 ? (
            <div className={styles.warningBox} role="status" aria-live="polite">
              {[...new Set([...warnings, ...localWarnings])].map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          ) : null}

          <div className={styles.summaryGrid}>
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Ore lavorate</span>
              <strong className={styles.summaryValue}>{workedHours.toFixed(2)} h</strong>
            </div>
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Negozio</span>
              <strong className={styles.summaryValue}>{STORE_LABELS[form.store]}</strong>
            </div>
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Duplicazioni</span>
              <strong className={styles.summaryValue}>{form.duplicateDates.length}</strong>
            </div>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.label}>Negozio</span>
              <select
                className={styles.select}
                value={form.store}
                onChange={(event) => setForm((current) => ({ ...current, store: event.target.value as Store }))}
                aria-invalid={Boolean(fieldErrors.store)}
              >
                <option value="duomo">Duomo</option>
                <option value="buenos_aires">Corso Buenos Aires</option>
              </select>
              {fieldErrors.store ? <span className={styles.errorText}>{fieldErrors.store}</span> : null}
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Dipendente</span>
              <select
                className={styles.select}
                value={form.employeeId}
                onChange={(event) => {
                  const employeeId = event.target.value;
                  const employee = employees.find((item) => item.id === employeeId);
                  setForm((current) => ({
                    ...current,
                    employeeId,
                    store: employee?.homeStore || current.store
                  }));
                }}
                aria-invalid={Boolean(fieldErrors.employeeId)}
              >
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.fullName}
                  </option>
                ))}
              </select>
              {fieldErrors.employeeId ? <span className={styles.errorText}>{fieldErrors.employeeId}</span> : null}
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Data</span>
              <input
                className={styles.input}
                type="date"
                value={form.dateISO}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    dateISO: event.target.value,
                    duplicateDates: current.duplicateDates.filter((dateISO) => dateISO !== event.target.value)
                  }))
                }
                aria-invalid={Boolean(fieldErrors.dateISO)}
              />
              {fieldErrors.dateISO ? <span className={styles.errorText}>{fieldErrors.dateISO}</span> : null}
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Ora inizio</span>
              <input
                className={styles.input}
                type="time"
                value={form.startTime}
                onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))}
                aria-invalid={Boolean(fieldErrors.startTime)}
              />
              {fieldErrors.startTime ? <span className={styles.errorText}>{fieldErrors.startTime}</span> : null}
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Ora fine</span>
              <input
                className={styles.input}
                type="time"
                value={form.endTime}
                onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))}
                aria-invalid={Boolean(fieldErrors.endTime)}
              />
              {fieldErrors.endTime ? <span className={styles.errorText}>{fieldErrors.endTime}</span> : null}
            </label>

            <label className={styles.checkboxField}>
              <span className={styles.label}>Pausa</span>
              <span className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form.withStandardBreak}
                  onChange={(event) => setForm((current) => ({ ...current, withStandardBreak: event.target.checked }))}
                />
                Pausa standard 1h
              </span>
              <span className={styles.hintText}>Quando attiva, il totale ore sottrae automaticamente 60 minuti.</span>
            </label>

            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.label}>Motivazione o nota</span>
              <textarea
                className={styles.textarea}
                value={form.note}
                onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="Apertura, cambio negozio, supporto, chiusura..."
                aria-invalid={Boolean(fieldErrors.note)}
              />
              {fieldErrors.note ? <span className={styles.errorText}>{fieldErrors.note}</span> : null}
            </label>
          </div>

          <section className={styles.duplicateCard} aria-labelledby="duplicate-days-title">
            <div className={styles.duplicateHeader}>
              <div>
                <h3 id="duplicate-days-title" className={styles.duplicateTitle}>
                  Duplica turno su altri giorni
                </h3>
                <p className={styles.hintText}>Seleziona i giorni aggiuntivi del mese su cui copiare lo stesso turno.</p>
              </div>
            </div>

            <div className={styles.duplicateGrid}>
              {duplicateOptions.map((option) => {
                const checked = form.duplicateDates.includes(option.dateISO);
                return (
                  <label key={option.dateISO} className={styles.duplicateOption}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setForm((current) => ({
                          ...current,
                          duplicateDates: checked
                            ? current.duplicateDates.filter((dateISO) => dateISO !== option.dateISO)
                            : [...current.duplicateDates, option.dateISO].sort()
                        }))
                      }
                    />
                    <span className={styles.duplicateChip}>
                      <span className={styles.duplicateDay}>{option.weekday}</span>
                      <span className={styles.duplicateDate}>{option.day}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <div className={styles.footer}>
            <div className={styles.footerActions}>
              {editing ? (
                <button type="button" className={styles.dangerButton} onClick={handleDelete} disabled={submitting || deleting}>
                  {deleting ? "Eliminazione..." : "Elimina turno"}
                </button>
              ) : null}
            </div>

            <div className={styles.footerMain}>
              <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={submitting || deleting}>
                Annulla
              </button>
              <button type="submit" className={styles.submitButton} disabled={submitting || deleting}>
                {submitting ? "Salvataggio..." : editing ? "Salva turno" : "Crea turno"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
