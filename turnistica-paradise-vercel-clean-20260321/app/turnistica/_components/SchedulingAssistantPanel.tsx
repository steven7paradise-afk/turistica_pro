"use client";

import { useState } from "react";
import { interpretAssistantRequest } from "@/app/turnistica/_lib/api";
import type { ScheduleAssistantResponse } from "@/app/turnistica/_lib/types";
import styles from "@/app/turnistica/_components/studio.module.css";

type Props = {
  monthKey: string;
};

const EXAMPLE = "Dal 24 al 26 marzo Gaia è in ferie. Metti Simona in apertura al Duomo il 24";

export function SchedulingAssistantPanel({ monthKey }: Props) {
  const [requestText, setRequestText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScheduleAssistantResponse | null>(null);
  const [error, setError] = useState("");

  async function onInterpret() {
    if (!requestText.trim()) return;

    setLoading(true);
    setError("");
    try {
      const payload = await interpretAssistantRequest(requestText, monthKey);
      setResult(payload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Errore assistente");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={`${styles.panel} noPrint`}>
      <div className={styles.panelHeader}>
        <div>
          <h3 className={styles.panelTitle}>Assistente testuale turni</h3>
          <p className={styles.panelSubtitle}>
            Scrivi una richiesta naturale in italiano o inglese. L'assistente restituisce il JSON strutturato con azioni, warning e preferenze memorizzabili.
          </p>
        </div>
        <span className={styles.badge}>JSON</span>
      </div>

      <label className={styles.fieldSpan}>
        Richiesta
        <textarea
          className={styles.textarea}
          rows={4}
          value={requestText}
          onChange={(event) => setRequestText(event.target.value)}
          placeholder={EXAMPLE}
        />
      </label>

      <p className={styles.helperInline}>Esempio: {EXAMPLE}</p>

      <div className={styles.actions}>
        <button type="button" className={styles.button} disabled={loading || !requestText.trim()} onClick={() => void onInterpret()}>
          {loading ? "Interpretazione..." : "Interpreta richiesta"}
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={loading}
          onClick={() => {
            setRequestText("");
            setResult(null);
            setError("");
          }}
        >
          Pulisci
        </button>
      </div>

      {error ? <div className={styles.notice}>{error}</div> : null}

      {result ? <pre className={styles.jsonPreview}>{JSON.stringify(result, null, 2)}</pre> : null}
    </section>
  );
}
