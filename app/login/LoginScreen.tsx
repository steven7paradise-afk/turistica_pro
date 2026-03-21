"use client";

import { FormEvent, useState } from "react";
import styles from "@/app/login/login.module.css";

export function LoginScreen() {
  const [secretCode, setSecretCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ pin: secretCode })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Codice non valido" }));
        setError(payload.error || "Codice non valido");
        setLoading(false);
        return;
      }

      window.location.replace("/turnistica");
    } catch {
      setError("Impossibile effettuare l'accesso in questo momento");
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.backdrop}>
        <section className={styles.showcase}>
          <div className={styles.showcaseGlow} />

          <div className={styles.showcaseHeader}>
            <div className={styles.mark}>Tp</div>
            <div className={styles.brandMeta}>
              <span className={styles.eyebrow}>Paradise Studio</span>
              <h1 className={styles.brandTitle}>Turnistica</h1>
            </div>
          </div>

          <p className={styles.brandText}>
            L'accesso è pensato per il lavoro quotidiano in salone: rapido, pulito e senza schermate inutili. Una volta entrata, trovi subito chi è operativo oggi e chi lo sarà domani.
          </p>

          <div className={styles.previewWrap} aria-hidden="true">
            <div className={styles.previewBoard}>
              <div className={styles.previewTop}>
                <span className={styles.previewPill}>Server locale</span>
                <span className={styles.previewAvatar} />
              </div>
              <div className={styles.previewGrid}>
                <div className={styles.previewSidebar}>
                  <div className={styles.previewSidebarBlock} />
                  <div className={styles.previewSidebarBlock} />
                  <div className={styles.previewSidebarBlock} />
                </div>
                <div className={styles.previewCalendar}>
                  <div className={styles.previewCalendarRow}>
                    <div className={styles.previewCalendarBlock} />
                    <div className={styles.previewCalendarBlock} />
                    <div className={styles.previewCalendarBlock} />
                    <div className={styles.previewCalendarBlock} />
                    <div className={styles.previewCalendarBlock} />
                  </div>
                  <div className={styles.previewCalendarRow}>
                    <div className={styles.previewCalendarBlock} />
                    <div className={styles.previewCalendarBlock} />
                    <div className={styles.previewCalendarBlock} />
                    <div className={styles.previewCalendarBlock} />
                    <div className={styles.previewCalendarBlock} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.eyebrow}>Accesso locale</span>
            <h2 className={styles.cardTitle}>Accesso riservato</h2>
            <p className={styles.cardSubtitle}>Archivio e foto restano salvati su questo computer. Il codice non viene mostrato a schermo e l'app può essere aperta anche da tablet e telefoni della stessa rete.</p>
          </div>

          <form onSubmit={onSubmit} autoComplete="off" className={styles.form}>
            <label className={styles.field}>
              Codice di accesso
              <input
                className={styles.input}
                type="password"
                inputMode="numeric"
                value={secretCode}
                onChange={(event) => setSecretCode(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                autoComplete="one-time-code"
                aria-label="Codice di accesso"
                required
              />
            </label>

            {error ? <p className={styles.error}>{error}</p> : null}

            <button type="submit" disabled={loading || secretCode.trim().length !== 6} className={styles.button}>
              {loading ? "Accesso..." : "Apri Turnistica"}
            </button>
          </form>

          <p className={styles.meta}>Apri il server su questo Mac e poi usa l'indirizzo locale mostrato nell'app sugli altri dispositivi della stessa Wi‑Fi/LAN.</p>
        </section>
      </div>
    </main>
  );
}
