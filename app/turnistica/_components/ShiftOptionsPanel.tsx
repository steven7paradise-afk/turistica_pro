"use client";

import { FormEvent, useState } from "react";
import { createTemplate, deleteTemplate, updateTemplate } from "@/app/turnistica/_lib/api";
import type { AvailabilityStatus, ShiftTemplate } from "@/app/turnistica/_lib/types";
import { AVAILABILITY_LABELS } from "@/app/turnistica/_lib/utils";
import styles from "@/app/turnistica/_components/studio.module.css";

type Props = {
  readOnly: boolean;
  templates: ShiftTemplate[];
  beforePersist?: () => Promise<boolean>;
  onRefresh: () => Promise<void> | void;
};

const STATUS_OPTIONS: AvailabilityStatus[] = ["lavoro", "riposo", "malattia", "permesso", "non_lavorato"];

function suggestShortCode(name: string) {
  const normalized = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 4);

  return normalized || "TR";
}

function statusSummary(template: ShiftTemplate) {
  return AVAILABILITY_LABELS[template.availabilityStatus];
}

function defaultTiming(status: AvailabilityStatus) {
  if (status === "lavoro") {
    return {
      startTime: "09:00",
      endTime: "18:00",
      unpaidBreakMinutes: 60
    };
  }

  return {
    startTime: "00:00",
    endTime: "00:00",
    unpaidBreakMinutes: 0
  };
}

export function ShiftOptionsPanel({ readOnly, templates, beforePersist, onRefresh }: Props) {
  const [templateName, setTemplateName] = useState("");
  const [templateCode, setTemplateCode] = useState("TR");
  const [templateStatus, setTemplateStatus] = useState<AvailabilityStatus>("lavoro");
  const [editingId, setEditingId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function resetForm() {
    setEditingId("");
    setTemplateName("");
    setTemplateCode("TR");
    setTemplateStatus("lavoro");
  }

  function startEditing(template: ShiftTemplate) {
    setEditingId(template.id);
    setTemplateName(template.name);
    setTemplateCode(template.shortCode);
    setTemplateStatus(template.availabilityStatus);
    setMessage("");
  }

  async function ensureReady(messageText: string) {
    if (!beforePersist) return true;
    const ready = await beforePersist();
    if (!ready) {
      setMessage(messageText);
    }
    return ready;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!templateName.trim()) return;
    if (!(await ensureReady("Salva prima le modifiche del mese per aggiornare la legenda."))) return;

    setSaving(true);
    setMessage("");
    try {
      const timing = defaultTiming(templateStatus);
      const payload = {
        name: templateName.trim(),
        shortCode: (templateCode.trim() || suggestShortCode(templateName)).toUpperCase().slice(0, 4),
        availabilityStatus: templateStatus,
        startTime: timing.startTime,
        endTime: timing.endTime,
        unpaidBreakMinutes: timing.unpaidBreakMinutes
      };

      if (editingId) {
        await updateTemplate(editingId, payload);
        setMessage("Turno legenda aggiornato.");
      } else {
        await createTemplate(payload);
        setMessage("Turno legenda creato.");
      }

      resetForm();
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Errore salvataggio turno.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!(await ensureReady("Salva prima le modifiche del mese per eliminare il turno dalla legenda."))) return;

    setBusyId(id);
    setMessage("");
    try {
      await deleteTemplate(id);
      if (editingId === id) {
        resetForm();
      }
      setMessage("Turno legenda eliminato.");
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Errore rimozione turno.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className={`${styles.panel} noPrint`}>
      <div className={styles.panelHeader}>
        <div>
          <h3 className={styles.panelTitle}>Legenda turni</h3>
          <p className={styles.panelSubtitle}>
            Qui crei, modifichi ed elimini i turni che compaiono nella legenda e nel menu delle celle. Quando ne selezioni uno in pianificazione, la cella si aggiorna subito automaticamente.
          </p>
        </div>
        <span className={styles.badge}>{templates.length} turni</span>
      </div>

      {message ? <div className={styles.notice}>{message}</div> : null}

      {!readOnly ? (
        <form onSubmit={handleSubmit} className={styles.formRow}>
          <label className={styles.fieldSpan}>
            Nome turno
            <input
              className={styles.input}
              value={templateName}
              onChange={(event) => {
                const nextName = event.target.value;
                const nextSuggested = suggestShortCode(nextName);
                setTemplateCode((current) => (current === "TR" || current === suggestShortCode(templateName) ? nextSuggested : current));
                setTemplateName(nextName);
              }}
              placeholder="Es. Apertura"
              required
            />
          </label>

          <label className={styles.field}>
            Sigla
            <input
              className={styles.input}
              value={templateCode}
              onChange={(event) => setTemplateCode(event.target.value.toUpperCase().slice(0, 4))}
              placeholder="AP"
              maxLength={4}
              required
            />
          </label>

          <label className={styles.field}>
            Tipo turno
            <select className={styles.select} value={templateStatus} onChange={(event) => setTemplateStatus(event.target.value as AvailabilityStatus)}>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {AVAILABILITY_LABELS[status]}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.actions}>
            <button type="submit" className={styles.button} disabled={saving || !templateName.trim() || !templateCode.trim()}>
              {saving ? "Salvataggio..." : editingId ? "Salva modifiche" : "Crea turno"}
            </button>
            {editingId ? (
              <button type="button" className={styles.secondaryButton} onClick={resetForm} disabled={saving}>
                Annulla
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <p className={styles.helperInline}>Accesso in sola lettura: puoi vedere la legenda ma non modificarla.</p>
      )}

      <ul className={styles.list}>
        {templates.length === 0 ? (
          <li className={styles.emptyInline}>La legenda è vuota. Crea qui i turni che vuoi usare nella pianificazione.</li>
        ) : null}

        {templates.map((template) => (
          <li key={template.id} className={styles.listItem}>
            <div className={styles.itemMain}>
              <span className={styles.itemTitle}>
                {template.name} · {template.shortCode}
              </span>
              <span className={styles.itemMeta}>{statusSummary(template)}</span>
            </div>

            {!readOnly ? (
              <div className={styles.actions}>
                <button type="button" className={styles.secondaryButton} onClick={() => startEditing(template)} disabled={saving || busyId === template.id}>
                  Modifica
                </button>
                <button type="button" className={styles.dangerButton} onClick={() => void handleDelete(template.id)} disabled={saving || busyId === template.id}>
                  {busyId === template.id ? "Rimozione..." : "Elimina"}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
