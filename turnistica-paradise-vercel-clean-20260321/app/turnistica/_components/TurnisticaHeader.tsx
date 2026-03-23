import styles from "@/app/turnistica/turnistica.module.css";

type Props = {
  monthValue: string;
  monthLabel: string;
  periodLabel: string;
  readOnly: boolean;
  monthDisabled: boolean;
  saveLabel: string;
  scheduleStatus: "DRAFT" | "PUBLISHED";
  version: number;
  onMonthChange: (monthKey: string) => void;
  onCreateShift: () => void;
  onPublish: () => void;
  onPrint: () => void;
  onOpenAudit: () => void;
};

export function TurnisticaHeader(props: Props) {
  return (
    <header className={`${styles.headerBar} noPrint`}>
      <div className={styles.headerTop}>
        <div className={styles.headerIntro}>
          <span className={styles.headerEyebrow}>Pianificazione</span>
          <h1 className={styles.title}>{props.monthLabel}</h1>
          <p className={styles.subtitle}>
            {props.periodLabel} • Vista mensile completa • {props.scheduleStatus === "PUBLISHED" ? "Mese pubblicato" : "Bozza in modifica"}
          </p>
        </div>

        <div className={styles.headerMeta}>
          <label className={styles.monthPicker}>
            <span className={styles.monthPickerLabel}>Mese</span>
            <input
              type="month"
              value={props.monthValue}
              disabled={props.monthDisabled}
              aria-label="Seleziona mese"
              onChange={(event) => props.onMonthChange(event.target.value)}
            />
          </label>
          <span className={styles.saveBadge}>{props.saveLabel}</span>
          <span className={styles.saveBadge}>v{props.version}</span>
          {!props.readOnly ? (
            <button type="button" className={styles.primaryButton} onClick={props.onPublish}>
              Pubblica mese
            </button>
          ) : null}
          <button type="button" className={styles.secondaryButton} onClick={props.onPrint}>
            Genera PDF
          </button>
        </div>
      </div>

      <div className={styles.headerActions}>
        <div className={styles.actionGroup}>
          {!props.readOnly ? (
            <button type="button" onClick={props.onCreateShift}>
              Nuovo turno
            </button>
          ) : null}
          <button type="button" onClick={props.onOpenAudit}>
            Cronologia
          </button>
        </div>
      </div>
    </header>
  );
}
