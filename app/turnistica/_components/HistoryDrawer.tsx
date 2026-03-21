"use client";

import styles from "@/app/turnistica/turnistica.module.css";
import { AuditItem, ScheduleVersionItem } from "@/app/turnistica/_lib/types";

type Props = {
  open: boolean;
  canRestore: boolean;
  loading: boolean;
  audit: AuditItem[];
  versions: ScheduleVersionItem[];
  selectedEmployee: string;
  employees: Array<{ id: string; fullName: string }>;
  onClose: () => void;
  onEmployeeFilter: (value: string) => void;
  onRestore: (versionId: string) => void;
};

export function HistoryDrawer(props: Props) {
  if (!props.open) return null;

  return (
    <aside className={`${styles.historyDrawer} noPrint`}>
      <header className={styles.historyHeader}>
        <h3>Cronologia</h3>
        <button type="button" onClick={props.onClose}>
          Chiudi
        </button>
      </header>

      <label className={styles.filterRow}>
        Dipendente
        <select value={props.selectedEmployee} onChange={(event) => props.onEmployeeFilter(event.target.value)}>
          <option value="">Tutti</option>
          {props.employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.fullName}
            </option>
          ))}
        </select>
      </label>

      <section>
        <h4>Versioni pubblicate</h4>
        <ul className={styles.entityList}>
          {props.versions.length === 0 ? <li>Nessuna pubblicazione ancora disponibile.</li> : null}
          {props.versions.map((version) => (
            <li key={version.id}>
              <span>
                v{version.versionNumber} • {new Date(version.createdAt).toLocaleString("it-IT")} • {version.createdByName}
              </span>
              {props.canRestore ? (
                <button type="button" onClick={() => props.onRestore(version.id)}>
                  Ripristina
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4>Log modifiche</h4>
        {props.loading ? <p>Caricamento...</p> : null}
        <ul className={styles.auditList}>
          {!props.loading && props.audit.length === 0 ? <li>Nessuna modifica registrata per il filtro selezionato.</li> : null}
          {props.audit.map((item) => (
            <li key={item.id}>
              <strong>{item.action}</strong>
              <p>
                {new Date(item.createdAt).toLocaleString("it-IT")} • {item.userName}
              </p>
              {item.payloadJson.employeeId && item.payloadJson.dateISO ? (
                <small>
                  {String(item.payloadJson.employeeId)} • {String(item.payloadJson.dateISO)}
                </small>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
