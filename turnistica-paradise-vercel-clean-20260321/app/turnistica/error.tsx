"use client";

import Link from "next/link";
import styles from "@/app/error.module.css";

export default function TurnisticaError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <span className={styles.eyebrow}>Turnistica Paradise</span>
        <h1 className={styles.title}>Questa sezione non si e aperta correttamente.</h1>
        <p className={styles.text}>Puoi riprovare subito oppure entrare in un'altra pagina del gestionale.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => reset()}>
            Riprova
          </button>
          <Link href="/turnistica/gestione" className={styles.secondary}>
            Apri Pianificazione
          </Link>
          <Link href="/turnistica/personale" className={styles.secondary}>
            Apri Personale
          </Link>
        </div>
      </section>
    </main>
  );
}
