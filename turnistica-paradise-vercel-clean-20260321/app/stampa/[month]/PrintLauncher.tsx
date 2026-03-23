"use client";

import { useEffect } from "react";
import styles from "./page.module.css";

type Props = {
  monthLabel: string;
};

export function PrintLauncher({ monthLabel }: Props) {
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      window.print();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, []);

  function onClose() {
    if (window.opener && !window.opener.closed) {
      window.close();
      window.setTimeout(() => {
        window.location.replace("/turnistica/gestione");
      }, 180);
      return;
    }

    if (window.history.length > 1) {
      window.history.back();
      window.setTimeout(() => {
        window.location.replace("/turnistica/gestione");
      }, 180);
      return;
    }

    window.location.replace("/turnistica/gestione");
  }

  return (
    <div className={styles.toolbar}>
      <div>
        <strong>{monthLabel}</strong>
        <p className={styles.toolbarText}>Questa vista e dedicata solo al PDF mensile. Sidebar e controlli dell'app non vengono inclusi.</p>
      </div>
      <div className={styles.toolbarActions}>
        <button type="button" className={styles.toolbarButton} onClick={() => window.print()}>
          Genera PDF
        </button>
        <button type="button" className={styles.toolbarButtonSecondary} onClick={onClose}>
          Chiudi e torna
        </button>
      </div>
    </div>
  );
}
