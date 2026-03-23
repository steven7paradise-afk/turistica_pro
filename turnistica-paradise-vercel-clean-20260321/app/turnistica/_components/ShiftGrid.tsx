import { Dispatch, MouseEvent, RefObject, SetStateAction, WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "@/app/turnistica/turnistica.module.css";
import { EmployeeAvatar } from "@/app/turnistica/_components/EmployeeAvatar";
import { Employee, EmployeeRule, ShiftAssignment, ShiftTemplate, Store } from "@/app/turnistica/_lib/types";
import {
  AVAILABILITY_LABELS,
  STANDARD_SHIFT_LABELS,
  availabilityStatusToAssignment,
  assignmentFromShiftId,
  cellWarning,
  customAssignmentAvailabilityStatus,
  getEffectiveAssignmentForDate,
  getStoreForDate,
  isWeekend,
  parseISODate,
  printLabel,
  shiftIdFromAssignment,
  STORE_LABELS
} from "@/app/turnistica/_lib/utils";
import { isManualShiftAssignment, manualShiftLabel } from "@/lib/shifts";

type Props = {
  dates: string[];
  employees: Employee[];
  templates: ShiftTemplate[];
  rules: EmployeeRule[];
  assignments: Record<string, Record<string, ShiftAssignment>>;
  readOnly: boolean;
  monthValue: string;
  monthDisabled: boolean;
  titleForPrint: string;
  periodLabel: string;
  storeReferenceDateISO: string;
  onChange: (employeeId: string, dateISO: string, value: string) => void;
  onMonthChange: (monthKey: string) => void;
  onToggleStore: (employeeId: string, dateISO: string) => void;
  onOpenShiftEditor: (payload: { employeeId: string; dateISO: string; store: Store; assignment: ShiftAssignment }) => void;
  getHours: (employeeId: string) => number;
};

type MenuState = {
  employeeId: string;
  dateISO: string;
  employeeName: string;
  top: number;
  left: number;
  currentValue: string;
};

type StoreGroup = {
  key: Store;
  title: string;
  employees: Employee[];
};

const MENU_WIDTH = 292;
function legendItems(templates: ShiftTemplate[], assignments: Record<string, Record<string, ShiftAssignment>>) {
  const workItems = new Map<string, { label: string; background: string }>();

  templates.forEach((template) => {
    workItems.set(template.id, {
      label: template.name,
      background: backgroundForStatus(template.availabilityStatus)
    });
  });

  Object.values(assignments).forEach((byDate) => {
    Object.values(byDate ?? {}).forEach((assignment) => {
      if (!assignment || assignment.kind !== "CUSTOM" || isManualShiftAssignment(assignment)) {
        return;
      }

      const key = `${assignment.templateId}:${assignment.name}:${assignment.startTime}:${assignment.endTime}:${assignment.unpaidBreakMinutes}`;
      if (!workItems.has(key)) {
        const status = customAssignmentAvailabilityStatus(assignment);
        workItems.set(key, {
          label: assignment.name,
          background: backgroundForStatus(status)
        });
      }
    });
  });

  return [...workItems.values()];
}

function backgroundForStatus(status: "lavoro" | "riposo" | "malattia" | "permesso" | "non_lavorato") {
  if (status === "riposo") return "var(--shift-riposo)";
  if (status === "malattia") return "var(--shift-malattia)";
  if (status === "permesso") return "var(--shift-permesso)";
  if (status === "non_lavorato") return "var(--shift-ferie)";
  return "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(250,244,247,0.96))";
}

function cellStyle(assignment: ShiftAssignment) {
  if (!assignment) {
    return {
      background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(250,244,247,0.96))",
      borderColor: "rgba(225, 208, 218, 0.98)",
      color: "#8a707d"
    };
  }

  if (assignment.kind === "STANDARD") {
    return {
      background: backgroundForStatus(
        assignment.type === "RIPOSO" ? "riposo" : assignment.type === "MALATTIA" ? "malattia" : assignment.type === "FERIE" ? "non_lavorato" : "lavoro"
      ),
      borderColor: "rgba(205, 174, 191, 0.92)",
      color: "#3e2831"
    };
  }

  const status = customAssignmentAvailabilityStatus(assignment);
  if (status === "permesso") {
    return {
      background: "var(--shift-permesso)",
      borderColor: "rgba(176, 197, 225, 0.96)",
      color: "#24354f"
    };
  }

  if (status === "riposo") {
    return {
      background: "var(--shift-riposo)",
      borderColor: "rgba(191, 215, 183, 0.96)",
      color: "#2d4629"
    };
  }

  if (status === "malattia") {
    return {
      background: "var(--shift-malattia)",
      borderColor: "rgba(223, 206, 123, 0.92)",
      color: "#63511f"
    };
  }

  if (status === "non_lavorato") {
    return {
      background: "var(--shift-ferie)",
      borderColor: "rgba(228, 170, 170, 0.96)",
      color: "#6b2e2e"
    };
  }

  return {
    background: "linear-gradient(180deg, #f7ecf3, #f3e1eb)",
    borderColor: "rgba(213, 185, 199, 0.94)",
    color: "#442a34"
  };
}

function cellCaption(assignment: ShiftAssignment) {
  if (assignment) {
    if (assignment.kind === "STANDARD") {
      return STANDARD_SHIFT_LABELS[assignment.type];
    }

    if (isManualShiftAssignment(assignment)) {
      return manualShiftLabel(assignment.startTime, assignment.endTime);
    }

    if (customAssignmentAvailabilityStatus(assignment) !== "lavoro") {
      return assignment.name;
    }

    return assignment.name;
  }

  return "";
}

function groupEmployeesByStore(employees: Employee[], dateISO: string): StoreGroup[] {
  return [
    {
      key: "duomo",
      title: STORE_LABELS.duomo.toUpperCase(),
      employees: employees.filter((employee) => getStoreForDate(employee, dateISO) === "duomo")
    },
    {
      key: "buenos_aires",
      title: STORE_LABELS.buenos_aires.toUpperCase(),
      employees: employees.filter((employee) => getStoreForDate(employee, dateISO) === "buenos_aires")
    }
  ];
}

function ScreenTable(
  props: Props & {
    menu: MenuState | null;
    setMenu: Dispatch<SetStateAction<MenuState | null>>;
    menuRef: RefObject<HTMLDivElement>;
  }
) {
  const ruleByEmployee = new Map(props.rules.map((rule) => [rule.employeeId, rule]));
  const groups = useMemo(() => groupEmployeesByStore(props.employees, props.storeReferenceDateISO), [props.employees, props.storeReferenceDateISO]);
  const clickTimerRef = useRef<number | null>(null);
  const legends = useMemo(() => legendItems(props.templates, props.assignments), [props.assignments, props.templates]);

  const optionValues = useMemo(
    () => {
      const statusesFromTemplates = new Set(props.templates.map((item) => item.availabilityStatus));
      const quickOptions = [
        statusesFromTemplates.has("riposo") ? null : { value: "RIPOSO", label: "Riposo", detail: "Stato rapido" },
        statusesFromTemplates.has("malattia") ? null : { value: "MALATTIA", label: "Malattia", detail: "Stato rapido" },
        statusesFromTemplates.has("non_lavorato") ? null : { value: "FERIE", label: "Non lavorato", detail: "Stato rapido" },
        statusesFromTemplates.has("permesso") ? null : { value: "SPECIAL:PERMESSO", label: "Permesso", detail: "Stato rapido" }
      ].filter(Boolean) as Array<{ value: string; label: string; detail: string }>;

      return [
        { value: "", label: "Nessun turno", detail: "Cella vuota" },
        ...props.templates.map((item) => ({
          value: `CUSTOM:${item.id}`,
          label: item.name,
          detail: item.availabilityStatus === "lavoro" ? "Turno legenda" : AVAILABILITY_LABELS[item.availabilityStatus]
        })),
        ...quickOptions
      ];
    },
    [props.templates]
  );

  function openMenuFromButton(button: HTMLButtonElement, employeeId: string, employeeName: string, dateISO: string, currentValue: string) {
    if (props.readOnly) return;

    const rect = button.getBoundingClientRect();
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - MENU_WIDTH / 2), window.innerWidth - MENU_WIDTH - 12);
    const top = Math.min(rect.bottom + 10, window.innerHeight - 360);

    props.setMenu({ employeeId, employeeName, dateISO, currentValue, top, left });
  }

  function chooseOption(value: string) {
    if (!props.menu) return;
    props.onChange(props.menu.employeeId, props.menu.dateISO, value);
    props.setMenu(null);
  }

  function queueMenuOpen(event: MouseEvent<HTMLButtonElement>, employeeId: string, employeeName: string, dateISO: string, currentValue: string) {
    const button = event.currentTarget;
    event.stopPropagation();

    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
    }

    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      openMenuFromButton(button, employeeId, employeeName, dateISO, currentValue);
    }, 180);
  }

  function openShiftEditor(event: MouseEvent<HTMLButtonElement>, employee: Employee, dateISO: string, assignment: ShiftAssignment) {
    if (props.readOnly) return;

    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    event.preventDefault();
    event.stopPropagation();
    props.setMenu(null);
    props.onOpenShiftEditor({
      employeeId: employee.id,
      dateISO,
      store: getStoreForDate(employee, dateISO),
      assignment
    });
  }

  function handleHorizontalWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.altKey) {
      return;
    }

    const wrapper = event.currentTarget;
    const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY;

    if (delta === 0) {
      return;
    }

    event.preventDefault();
    wrapper.scrollLeft += delta * 1.35;
  }

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        window.clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  const menuEmployee = props.menu ? props.employees.find((employee) => employee.id === props.menu?.employeeId) : undefined;
  const menuStore = menuEmployee && props.menu ? getStoreForDate(menuEmployee, props.menu.dateISO) : null;
  const nextStoreLabel = menuStore === "duomo" ? STORE_LABELS.buenos_aires : STORE_LABELS.duomo;

  return (
    <div className="screen-table-only">
      <div className={`${styles.gridMetaBar} noPrint`}>
        <div className={styles.gridMetaGroup}>
          <span className={styles.gridMetaEyebrow}>Vista attiva</span>
          <strong className={styles.gridMetaTitle}>Mese completo · {props.periodLabel}</strong>
        </div>
        <label className={styles.gridMetaControl}>
          <span className={styles.gridMetaControlLabel}>Mese visibile</span>
          <input
            type="month"
            className={styles.gridMetaMonthInput}
            value={props.monthValue}
            disabled={props.monthDisabled}
            aria-label="Seleziona il mese da visualizzare"
            onChange={(event) => props.onMonthChange(event.target.value)}
          />
        </label>
        <div className={styles.gridMetaStats}>
          <span className={styles.gridMetaChip}>{props.dates.length} giorni del mese</span>
          <span className={styles.gridMetaChip}>{props.employees.length} persone</span>
          <span className={styles.gridMetaChip}>
            Negozi su {parseISODate(props.storeReferenceDateISO).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
          </span>
        </div>
      </div>

      <div className={`${styles.legendRow} noPrint`}>
        <span>Legenda:</span>
        {legends.length > 0 ? (
          legends.map((item) => (
            <span key={item.label} className={styles.legendChip} style={{ background: item.background }}>
              {item.label}
            </span>
          ))
        ) : (
          <span className={styles.legendChip}>Crea i turni dalla dashboard per popolare la legenda</span>
        )}
      </div>

      <div className={`${styles.tableShell} tp-table-shell`}>
        <div
          className={`${styles.tableWrap} tp-table-wrap`}
          onWheel={handleHorizontalWheel}
          aria-label="Griglia mensile turni. Usa Alt più rotella del mouse per scorrere orizzontalmente fino a fine calendario."
        >
          <div className={styles.storeMatrix}>
            {groups.map((group) => (
              <section key={group.key} className={styles.storeTableSection}>
                <div className={styles.storeTableHeader}>
                  <span className={styles.storeTableTitle}>{group.title}</span>
                  <span className={styles.storeTableCount}>{group.employees.length} persone</span>
                </div>

                <table className={`${styles.gridTable} tp-grid-table`}>
                  <thead>
                    <tr>
                      <th className={`${styles.stickyCol} ${styles.employeeHead} tp-sticky-col tp-employee-head`}>Dipendente</th>
                      {props.dates.map((dateISO) => {
                        const d = parseISODate(dateISO);
                        const weekend = isWeekend(dateISO);

                        return (
                          <th key={dateISO} className={`${styles.dayHead} ${weekend ? styles.weekendHead : ""} tp-day-head`}>
                            <div className={styles.dayHeadInner}>
                              <span className={styles.dayWeekday}>{d.toLocaleDateString("it-IT", { weekday: "short" })}</span>
                              <strong className={styles.dayNumber}>{d.getDate()}</strong>
                            </div>
                          </th>
                        );
                      })}
                      <th className={`${styles.hoursHead} tp-hours-head`}>Ore</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.employees.map((employee) => {
                      const rule = ruleByEmployee.get(employee.id);

                      return (
                        <tr key={employee.id} className={styles.bodyRow}>
                          <th className={`${styles.stickyCol} ${styles.employeeCell} tp-sticky-col tp-employee-cell`}>
                            <div className={`${styles.employeeIdentity} tp-employee-identity`}>
                              <EmployeeAvatar fullName={employee.fullName} photoUrl={employee.photoUrl} size="print" />
                              <span className={`${styles.employeeName} tp-employee-name`}>
                                {employee.fullName}
                              </span>
                            </div>
                          </th>

                          {props.dates.map((dateISO) => {
                            const rawAssignment = props.assignments[employee.id]?.[dateISO] ?? null;
                            const assignment = getEffectiveAssignmentForDate(employee, dateISO, rawAssignment);
                            const weekend = isWeekend(dateISO);
                            const warning = cellWarning(rule, dateISO, assignment);
                            const value = shiftIdFromAssignment(assignment);
                            const active = props.menu?.employeeId === employee.id && props.menu?.dateISO === dateISO;

                            return (
                              <td key={dateISO} className={`${styles.shiftCell} ${weekend ? styles.weekendCell : ""}`}>
                                <div className={styles.cellInner}>
                                  <button
                                    type="button"
                                    aria-label={`Turno ${employee.fullName} ${dateISO}`}
                                    aria-haspopup={props.readOnly ? undefined : "dialog"}
                                    aria-expanded={active}
                                    disabled={props.readOnly}
                                    onClick={(event) => queueMenuOpen(event, employee.id, employee.fullName, dateISO, value)}
                                    onDoubleClick={(event) => openShiftEditor(event, employee, dateISO, assignment)}
                                    className={`${styles.cellButton} tp-cell-button ${active ? styles.cellButtonActive : ""} ${props.readOnly ? styles.cellButtonReadOnly : ""} ${warning ? styles.warningCell : ""}`}
                                    style={cellStyle(assignment)}
                                  >
                                    <span className={styles.cellCode}>{assignment ? printLabel(assignment) : ""}</span>
                                    <span className={styles.cellCaption}>{cellCaption(assignment)}</span>
                                  </button>
                                </div>
                              </td>
                            );
                          })}

                          <td className={`${styles.hoursCell} tp-hours-cell`}>{props.getHours(employee.id)} h</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        </div>
      </div>

      {!props.readOnly && props.menu ? (
        <div ref={props.menuRef} className={styles.cellMenu} style={{ top: props.menu.top, left: props.menu.left }} role="dialog" aria-label={`Scegli turno per ${props.menu.employeeName}`}>
          <div className={styles.cellMenuHeader}>
            <div>
              <strong className={styles.cellMenuTitle}>{props.menu.employeeName}</strong>
              <span className={styles.cellMenuMeta}>{parseISODate(props.menu.dateISO).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}</span>
            </div>
            <button type="button" className={styles.cellMenuClose} onClick={() => props.setMenu(null)}>
              Chiudi
            </button>
          </div>

          {menuEmployee && menuStore ? (
            <button
              type="button"
              className={styles.storeToggleButton}
              onClick={() => {
                props.onToggleStore(props.menu!.employeeId, props.menu!.dateISO);
                props.setMenu(null);
              }}
            >
              <span className={styles.storeToggleLabel}>Lavora in questo giorno: {STORE_LABELS[menuStore]}</span>
              <span className={styles.storeToggleHint}>Cambia negozio per questo giorno in {nextStoreLabel}</span>
            </button>
          ) : null}

          <div className={styles.cellMenuGrid}>
            {optionValues.map((option) => {
              const optionAssignment = assignmentFromShiftId(option.value, props.templates);
              const previewAssignment = option.value === "SPECIAL:PERMESSO" ? availabilityStatusToAssignment("permesso") : optionAssignment;
              const selected = props.menu?.currentValue === option.value;

              return (
                <button
                  key={option.value || "empty"}
                  type="button"
                  onClick={() => chooseOption(option.value)}
                  className={`${styles.cellMenuOption} ${selected ? styles.cellMenuOptionSelected : ""}`}
                  style={cellStyle(previewAssignment)}
                >
                  <span className={styles.cellMenuCode}>{previewAssignment ? printLabel(previewAssignment) : "—"}</span>
                  <span>
                    <span className={styles.cellMenuLabel}>{option.label}</span>
                    <span className={styles.cellMenuDetail}>{option.detail}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PrintMonthTable(props: Props) {
  const ruleByEmployee = new Map(props.rules.map((rule) => [rule.employeeId, rule]));
  const groups = useMemo(() => groupEmployeesByStore(props.employees, props.storeReferenceDateISO), [props.employees, props.storeReferenceDateISO]);

  return (
    <div className="print-month-only">
      <div className={`${styles.printHeader} tp-print-header`}>
        <div className={`${styles.printBrandBlock} tp-print-brand-block`}>
          <span className={`${styles.printBrandMark} tp-print-brand-mark`}>Tp</span>
          <div>
            <span className={`${styles.printKicker} tp-print-kicker`}>Paradise Studio</span>
            <h2 className={`${styles.printTitle} tp-print-title`}>TABELLA TURNISTICA ({props.titleForPrint})</h2>
          </div>
        </div>
      </div>

      <div className={`${styles.legendRow} tp-print-legend-row`}>
        <span>Legenda:</span>
        {legendItems(props.templates, props.assignments).length > 0 ? (
          legendItems(props.templates, props.assignments).map((item) => (
            <span key={item.label} className={`${styles.legendChip} tp-print-legend-chip`} style={{ background: item.background }}>
              {item.label}
            </span>
          ))
        ) : (
          <span className={`${styles.legendChip} tp-print-legend-chip`}>Legenda da configurare</span>
        )}
      </div>

      <div className={styles.printStoreMeta}>
        Suddivisione negozi sulla data {parseISODate(props.storeReferenceDateISO).toLocaleDateString("it-IT", { day: "2-digit", month: "long" })}
      </div>

      <div className={styles.printStoreStack}>
        {groups.map((group) => (
          <section key={group.key} className={styles.printStoreSection}>
            <div className={styles.storeTableHeader}>
              <span className={styles.storeTableTitle}>{group.title}</span>
              <span className={styles.storeTableCount}>{group.employees.length} persone</span>
            </div>

            <div className={`${styles.tableShell} tp-table-shell`}>
              <div className={`${styles.tableWrap} tp-table-wrap`}>
                <table className={`${styles.gridTable} tp-grid-table`}>
                  <thead>
                    <tr>
                      <th className={`${styles.employeeHead} tp-employee-head`}>Dipendente</th>
                      {props.dates.map((dateISO) => {
                        const d = parseISODate(dateISO);
                        const weekend = isWeekend(dateISO);

                        return (
                          <th key={dateISO} className={`${styles.dayHead} ${weekend ? styles.weekendHead : ""} tp-day-head`}>
                            <div className={styles.dayHeadInner}>
                              <span className={styles.dayWeekday}>{d.toLocaleDateString("it-IT", { weekday: "short" })}</span>
                              <strong className={styles.dayNumber}>{d.getDate()}</strong>
                            </div>
                          </th>
                        );
                      })}
                      <th className={`${styles.hoursHead} tp-hours-head`}>Ore</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.employees.map((employee) => {
                      const rule = ruleByEmployee.get(employee.id);

                      return (
                        <tr key={employee.id} className={styles.bodyRow}>
                          <th className={`${styles.employeeCell} tp-employee-cell`}>
                            <span className={`${styles.employeeName} tp-employee-name`}>{employee.fullName}</span>
                          </th>

                          {props.dates.map((dateISO) => {
                            const assignment = getEffectiveAssignmentForDate(employee, dateISO, props.assignments[employee.id]?.[dateISO] ?? null);
                            const weekend = isWeekend(dateISO);
                            const warning = cellWarning(rule, dateISO, assignment);

                            return (
                              <td key={dateISO} className={`${styles.shiftCell} ${weekend ? styles.weekendCell : ""}`}>
                                <div className={styles.cellInner}>
                                  <span className={`${styles.printOnlyLabel} tp-print-only-label`} style={cellStyle(assignment)}>
                                    {printLabel(assignment)}
                                    {warning ? "*" : ""}
                                  </span>
                                </div>
                              </td>
                            );
                          })}

                          <td className={`${styles.hoursCell} tp-hours-cell`}>{props.getHours(employee.id)} h</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ))}
      </div>

      <p className={`${styles.printLegend} tp-print-legend-note`}>PDF mensile ottimizzato per A4 landscape. I controlli dell'app non vengono inclusi nella stampa.</p>
    </div>
  );
}

export function ShiftGrid(props: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    if (!menu) return;

    const close = () => setMenu(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target)) return;
      close();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  return (
    <section className={`${styles.gridSection} tp-print-grid-section`}>
      <ScreenTable {...props} menu={menu} setMenu={setMenu} menuRef={menuRef} />
      <PrintMonthTable {...props} />
    </section>
  );
}
