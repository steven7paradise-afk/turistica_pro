"use client";

import Link from "next/link";
import styles from "@/app/error.module.css";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="it">
      <body>
        <main className={styles.page}>
          <section className={styles.card}>
            <span className={styles.eyebrow}>Turnistica Paradise</span>
            <h1 className={styles.title}>C'e stato un problema temporaneo.</h1>
            <p className={styles.text}>
              La pagina non si e caricata correttamente. Riprova ora oppure apri direttamente una sezione dell'app.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => reset()}>
                Riprova
              </button>
              <Link href="/turnistica" className={styles.secondary}>
                Apri Turnistica
              </Link>
            </div>
            <p className={styles.meta}>Se succede ancora, aggiorna il deployment e controlla i Runtime Logs di Vercel.</p>
          </section>
        </main>
      </body>
    </html>
  );
}
