import {
  AvailabilityStatus,
  AssignmentMatrix,
  Employee,
  EmployeeRule,
  ShiftAssignment,
  ShiftId,
  ShiftTemplate,
  Store,
  StandardShiftType,
  ViewMode
} from "@/app/turnistica/_lib/types";
import { isManualShiftAssignment } from "@/lib/shifts";

export const STANDARD_SHIFT_LABELS: Record<StandardShiftType, string> = {
  MATTINA: "Mattina",
  POMERIGGIO: "Pomeriggio",
  FULL: "Lavoro",
  RIPOSO: "Riposo",
  FERIE: "Non lavorato",
  MALATTIA: "Malattia"
};

export const STANDARD_SHIFT_COLORS: Record<StandardShiftType, string> = {
  MATTINA: "var(--shift-mattina)",
  POMERIGGIO: "var(--shift-pomeriggio)",
  FULL: "var(--shift-full)",
  RIPOSO: "var(--shift-riposo)",
  FERIE: "var(--shift-ferie)",
  MALATTIA: "var(--shift-malattia)"
};

export const STANDARD_SHIFT_PRINT_LABELS: Record<StandardShiftType, string> = {
  MATTINA: "M",
  POMERIGGIO: "P",
  FULL: "L",
  RIPOSO: "R",
  FERIE: "NL",
  MALATTIA: "MA"
};

export const STORE_LABELS: Record<Store, string> = {
  duomo: "Duomo",
  buenos_aires: "Corso Buenos Aires"
};

export const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  lavoro: "Lavoro",
  riposo: "Riposo",
  malattia: "Malattia",
  permesso: "Permesso",
  non_lavorato: "Non lavorato"
};

const IT_WEEKDAY = ["DOMENICA", "LUNEDÌ", "MARTEDÌ", "MERCOLEDÌ", "GIOVEDÌ", "VENERDÌ", "SABATO"];
const IT_MONTH = ["GENNAIO", "FEBBRAIO", "MARZO", "APRILE", "MAGGIO", "GIUGNO", "LUGLIO", "AGOSTO", "SETTEMBRE", "OTTOBRE", "NOVEMBRE", "DICEMBRE"];

export const IT_WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"] as const;
export const IT_WEEKDAY_LABELS = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"] as const;

export type RuleAssistantAlert = {
  id: string;
  employeeId: string;
  coworkerId?: string;
  dateISO: string;
  kind: "NO_REST_WEEKDAY" | "PAIR_REST";
  message: string;
};

export function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseISODate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function monthDates(monthKey: string): string[] {
  const [year, month] = monthKey.split("-").map(Number);
  const start = new Date(year, (month ?? 1) - 1, 1);
  const dates: string[] = [];
  while (start.getMonth() === (month ?? 1) - 1) {
    dates.push(toISODate(start));
    start.setDate(start.getDate() + 1);
  }
  return dates;
}

export function weekDates(anchorISO: string): string[] {
  const d = parseISODate(anchorISO);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return Array.from({ length: 7 }, (_, i) => {
    const copy = new Date(d);
    copy.setDate(d.getDate() + i);
    return toISODate(copy);
  });
}

export function displayedDates(viewMode: ViewMode, monthKey: string, weekAnchorISO: string): string[] {
  return viewMode === "MONTH" ? monthDates(monthKey) : weekDates(weekAnchorISO);
}

export function isWeekend(dateISO: string): boolean {
  const weekday = parseISODate(dateISO).getDay();
  return weekday === 0 || weekday === 6;
}

export function isToday(dateISO: string): boolean {
  return dateISO === toISODate(new Date());
}

export function monthStart(monthKey: string): string {
  return monthDates(monthKey)[0] ?? monthKey;
}

export function monthEnd(monthKey: string): string {
  const dates = monthDates(monthKey);
  return dates[dates.length - 1] ?? monthKey;
}

export function shiftIdFromAssignment(assignment: ShiftAssignment): ShiftId | "" {
  if (!assignment) return "";
  if (assignment.kind === "STANDARD") return assignment.type;
  return `CUSTOM:${assignment.templateId}`;
}

export function assignmentFromShiftId(shiftId: string, templates: ShiftTemplate[]): ShiftAssignment {
  if (!shiftId) return null;
  if (shiftId.startsWith("CUSTOM:")) {
    const templateId = shiftId.slice(7);
    const template = templates.find((item) => item.id === templateId);
    if (!template) return null;
    return {
      kind: "CUSTOM",
      templateId: template.id,
      name: template.name,
      shortCode: template.shortCode,
      availabilityStatus: template.availabilityStatus,
      startTime: template.startTime,
      endTime: template.endTime,
      unpaidBreakMinutes: template.unpaidBreakMinutes
    };
  }
  return {
    kind: "STANDARD",
    type: shiftId as StandardShiftType
  };
}

export function cloneMatrix(matrix: AssignmentMatrix): AssignmentMatrix {
  return JSON.parse(JSON.stringify(matrix)) as AssignmentMatrix;
}

export function assignmentEquals(a: ShiftAssignment, b: ShiftAssignment): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function toMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isPermessoAssignment(assignment: ShiftAssignment): boolean {
  if (!assignment || assignment.kind !== "CUSTOM") return false;
  if (assignment.availabilityStatus === "permesso") return true;
  const normalized = `${assignment.templateId} ${assignment.name}`.trim().toLowerCase();
  return normalized.includes("permesso");
}

export function customAssignmentAvailabilityStatus(assignment: Extract<ShiftAssignment, { kind: "CUSTOM" }>): AvailabilityStatus {
  if (assignment.availabilityStatus) {
    return assignment.availabilityStatus;
  }

  const normalized = `${assignment.templateId} ${assignment.name}`.trim().toLowerCase();
  if (normalized.includes("riposo")) return "riposo";
  if (normalized.includes("malattia")) return "malattia";
  if (normalized.includes("permesso")) return "permesso";
  if (normalized.includes("ferie") || normalized.includes("non lavorato") || normalized.includes("non_lavorato")) return "non_lavorato";
  return "lavoro";
}

export function getStoreForDate(person: Pick<Employee, "homeStore" | "overrideStoreByDate">, date: string): Store {
  return person.overrideStoreByDate?.[date] || person.homeStore;
}

export function hasStoreOverrideForDate(person: Pick<Employee, "homeStore" | "overrideStoreByDate">, date: string): boolean {
  return Boolean(person.overrideStoreByDate?.[date] && person.overrideStoreByDate?.[date] !== person.homeStore);
}

export function availabilityStatusFromAssignment(assignment: ShiftAssignment): AvailabilityStatus | null {
  if (!assignment) return null;

  if (assignment.kind === "CUSTOM") {
    return customAssignmentAvailabilityStatus(assignment);
  }

  if (assignment.type === "RIPOSO") return "riposo";
  if (assignment.type === "MALATTIA") return "malattia";
  if (assignment.type === "FERIE") return "non_lavorato";
  return "lavoro";
}

export function getAvailabilityStatusForDate(
  person: Pick<Employee, "availability">,
  dateISO: string,
  assignment: ShiftAssignment,
  options?: { defaultToWork?: boolean }
): AvailabilityStatus | null {
  const explicit = person.availability?.[dateISO];
  if (explicit && explicit !== "lavoro") {
    return explicit;
  }

  const derived = availabilityStatusFromAssignment(assignment);
  if (derived) {
    return derived;
  }

  if (explicit === "lavoro") {
    return "lavoro";
  }

  return options?.defaultToWork ? "lavoro" : null;
}

export function availabilityStatusToAssignment(status: AvailabilityStatus, assignment?: ShiftAssignment): ShiftAssignment {
  if (assignment && assignment.kind === "CUSTOM" && customAssignmentAvailabilityStatus(assignment) === status) {
    return assignment;
  }

  if (status === "riposo") {
    return { kind: "STANDARD", type: "RIPOSO" };
  }

  if (status === "malattia") {
    return { kind: "STANDARD", type: "MALATTIA" };
  }

  if (status === "non_lavorato") {
    return { kind: "STANDARD", type: "FERIE" };
  }

  if (status === "permesso") {
    if (assignment && assignment.kind === "CUSTOM" && isPermessoAssignment(assignment)) {
      return assignment;
    }

    return {
      kind: "CUSTOM",
      templateId: "permesso-availability",
      name: "Permesso",
      shortCode: "PE",
      availabilityStatus: "permesso",
      startTime: "09:00",
      endTime: "09:00",
      unpaidBreakMinutes: 0
    };
  }

  return assignment ?? null;
}

export function getEffectiveAssignmentForDate(
  person: Pick<Employee, "availability">,
  dateISO: string,
  assignment: ShiftAssignment
): ShiftAssignment {
  const status = getAvailabilityStatusForDate(person, dateISO, assignment);
  if (!status) {
    return assignment ?? null;
  }

  return availabilityStatusToAssignment(status, assignment);
}

export function shiftDurationHours(startTime: string, endTime: string, unpaidBreakMinutes = 0): number {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start === end) return 0;
  const rawDuration = end > start ? end - start : end + 1440 - start;
  const paidMinutes = Math.max(0, rawDuration - Math.max(0, unpaidBreakMinutes));
  return Number((paidMinutes / 60).toFixed(2));
}

export function formatHours(hours: number): string {
  const normalized = Number(hours.toFixed(2));
  return Number.isInteger(normalized) ? `${normalized}` : normalized.toString();
}

export function formatTemplateSummary(template: Pick<ShiftTemplate, "startTime" | "endTime" | "unpaidBreakMinutes">): string {
  if (template.startTime === "00:00" && template.endTime === "00:00") {
    return "Stato giornaliero · 0 h";
  }
  const paidHours = shiftDurationHours(template.startTime, template.endTime, template.unpaidBreakMinutes);
  const breakLabel = template.unpaidBreakMinutes > 0 ? ` · pausa ${template.unpaidBreakMinutes} min` : "";
  return `${template.startTime}-${template.endTime}${breakLabel} · ${formatHours(paidHours)} h pagate`;
}

export function assignmentHours(assignment: ShiftAssignment): number {
  if (!assignment) return 0;
  if (assignment.kind === "STANDARD") {
    if (assignment.type === "FULL") return 8;
    if (assignment.type === "MATTINA" || assignment.type === "POMERIGGIO") return 4;
    return 0;
  }
  if (customAssignmentAvailabilityStatus(assignment) !== "lavoro") return 0;
  return shiftDurationHours(assignment.startTime, assignment.endTime, assignment.unpaidBreakMinutes);
}

export function employeeMonthHours(employeeId: string, dates: string[], matrix: AssignmentMatrix): number {
  const total = dates.reduce((acc, dateISO) => acc + assignmentHours(matrix[employeeId]?.[dateISO] ?? null), 0);
  return Number(total.toFixed(2));
}

export function templateInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return "CU";
  return clean
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function employeeInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return "TP";
  return clean
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function printLabel(assignment: ShiftAssignment): string {
  if (!assignment) return "";
  if (assignment.kind === "STANDARD") return STANDARD_SHIFT_PRINT_LABELS[assignment.type];
  if (isManualShiftAssignment(assignment)) return "L";
  if (assignment.shortCode?.trim()) return assignment.shortCode.trim().toUpperCase().slice(0, 4);
  return templateInitials(assignment.name);
}

export function assignmentLabel(assignment: ShiftAssignment): string {
  if (!assignment) return "Non assegnato";
  if (assignment.kind === "STANDARD") return STANDARD_SHIFT_LABELS[assignment.type];
  if (isManualShiftAssignment(assignment)) return `${assignment.startTime}-${assignment.endTime} · ${formatHours(shiftDurationHours(assignment.startTime, assignment.endTime, assignment.unpaidBreakMinutes))} h`;
  if (customAssignmentAvailabilityStatus(assignment) !== "lavoro") return assignment.name;
  return `${assignment.name} ${formatTemplateSummary(assignment)}`;
}

export function fullItalianDateUpper(dateISO: string): string {
  const d = parseISODate(dateISO);
  return `${IT_WEEKDAY[d.getDay()]} ${d.getDate()} ${IT_MONTH[d.getMonth()]} ${d.getFullYear()}`;
}

const weekdayFallbacks: Record<number, ShiftId[]> = {
  0: ["RIPOSO", "FULL", "POMERIGGIO", "MATTINA"],
  1: ["MATTINA", "FULL", "POMERIGGIO", "RIPOSO"],
  2: ["POMERIGGIO", "MATTINA", "FULL", "RIPOSO"],
  3: ["FULL", "MATTINA", "POMERIGGIO", "RIPOSO"],
  4: ["MATTINA", "POMERIGGIO", "FULL", "RIPOSO"],
  5: ["POMERIGGIO", "FULL", "MATTINA", "RIPOSO"],
  6: ["FULL", "MATTINA", "RIPOSO", "POMERIGGIO"]
};

export function suggestionForCell(
  rule: EmployeeRule | undefined,
  dateISO: string,
  templates: ShiftTemplate[],
  employeeSeed = 0
): ShiftAssignment {
  const weekday = parseISODate(dateISO).getDay();
  const forbidden = new Set(rule?.forbiddenShiftIds ?? []);

  if (rule?.unavailableDates.includes(dateISO) || rule?.unavailableWeekdays.includes(weekday)) {
    if (!forbidden.has("RIPOSO")) {
      return { kind: "STANDARD", type: "RIPOSO" };
    }
    return null;
  }

  if (rule?.preferredShiftId && !forbidden.has(rule.preferredShiftId)) {
    return assignmentFromShiftId(rule.preferredShiftId, templates);
  }

  const baseOrder = weekdayFallbacks[weekday] ?? weekdayFallbacks[1];
  const rotation = (employeeSeed + parseISODate(dateISO).getDate()) % baseOrder.length;
  const rotated = baseOrder.slice(rotation).concat(baseOrder.slice(0, rotation));

  for (const id of rotated) {
    if (!forbidden.has(id)) {
      return assignmentFromShiftId(id, templates);
    }
  }

  return null;
}

export function cellWarning(rule: EmployeeRule | undefined, dateISO: string, assignment: ShiftAssignment): string | null {
  if (!rule || !assignment) return null;
  const weekday = parseISODate(dateISO).getDay();
  const shiftId = shiftIdFromAssignment(assignment);
  const status = availabilityStatusFromAssignment(assignment);

  if (rule.unavailableDates.includes(dateISO)) return "Indisponibile in questa data";
  if (rule.unavailableWeekdays.includes(weekday)) return "Giorno non disponibile";
  if (shiftId && rule.forbiddenShiftIds.includes(shiftId)) return "Turno vietato dalla regola";
  if (status === "riposo" && rule.mustWorkWeekdays.includes(weekday)) return "In questo giorno non deve andare in riposo";
  return null;
}

export function analyzeRuleAlerts(params: {
  employee: Employee;
  rule: EmployeeRule | undefined;
  employees: Employee[];
  assignments: AssignmentMatrix;
  dates: string[];
}): RuleAssistantAlert[] {
  const { employee, rule, employees, assignments, dates } = params;
  if (!rule) return [];

  const coworkersById = new Map(employees.map((item) => [item.id, item]));
  const alerts: RuleAssistantAlert[] = [];

  dates.forEach((dateISO) => {
    const weekday = parseISODate(dateISO).getDay();
    const assignment = getEffectiveAssignmentForDate(employee, dateISO, assignments[employee.id]?.[dateISO] ?? null);
    const status = getAvailabilityStatusForDate(employee, dateISO, assignment);

    if (status === "riposo" && rule.mustWorkWeekdays.includes(weekday)) {
      alerts.push({
        id: `${employee.id}:${dateISO}:no-rest`,
        employeeId: employee.id,
        dateISO,
        kind: "NO_REST_WEEKDAY",
        message: `${employee.fullName} non deve andare in riposo di ${IT_WEEKDAY_LABELS[weekday]}.`
      });
    }

    if (status !== "riposo" || rule.avoidRestWithEmployeeIds.length === 0) {
      return;
    }

    rule.avoidRestWithEmployeeIds.forEach((coworkerId) => {
      const coworker = coworkersById.get(coworkerId);
      if (!coworker || !coworker.active) {
        return;
      }

      const coworkerAssignment = getEffectiveAssignmentForDate(coworker, dateISO, assignments[coworker.id]?.[dateISO] ?? null);
      const coworkerStatus = getAvailabilityStatusForDate(coworker, dateISO, coworkerAssignment);

      if (coworkerStatus === "riposo") {
        alerts.push({
          id: `${employee.id}:${coworker.id}:${dateISO}:pair-rest`,
          employeeId: employee.id,
          coworkerId: coworker.id,
          dateISO,
          kind: "PAIR_REST",
          message: `${employee.fullName} e ${coworker.fullName} risultano entrambe in riposo.`
        });
      }
    });
  });

  return alerts;
}

export function monthNav(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const d = new Date(year, (month ?? 1) - 1 + delta, 1);
  return toMonthKey(d);
}

function escapeCsvValue(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function parseCsvCells(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (insideQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      insideQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((currentRow) => currentRow.some((cell) => cell.trim().length > 0));
}

export function parseCsv(text: string): Array<Record<string, string>> {
  const rows = parseCsvCells(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());

  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });
}

export function toCsvRows(matrix: AssignmentMatrix, employees: Array<{ id: string; fullName: string }>, dates: string[]): string {
  const lines = [
    ["employee", "date", "kind", "shiftCode", "name", "startTime", "endTime", "unpaidBreakMinutes"].map(escapeCsvValue).join(",")
  ];

  for (const employee of employees) {
    for (const dateISO of dates) {
      const assignment = matrix[employee.id]?.[dateISO] ?? null;
      const shiftCode = shiftIdFromAssignment(assignment);
      const row =
        assignment && assignment.kind === "CUSTOM"
          ? [employee.fullName, dateISO, "CUSTOM", shiftCode, assignment.name, assignment.startTime, assignment.endTime, String(assignment.unpaidBreakMinutes)]
          : [employee.fullName, dateISO, assignment ? "STANDARD" : "EMPTY", shiftCode, "", "", "", ""];
      lines.push(row.map((cell) => escapeCsvValue(cell)).join(","));
    }
  }

  return lines.join("\n");
}

export function isWorkingShift(assignment: ShiftAssignment): boolean {
  if (!assignment) return false;
  if (assignment.kind === "CUSTOM") return customAssignmentAvailabilityStatus(assignment) === "lavoro";
  return assignment.type !== "RIPOSO" && assignment.type !== "FERIE" && assignment.type !== "MALATTIA";
}

export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(new Date(year, (month ?? 1) - 1, 1));
}

export function formatPeriodLabel(dates: string[]): string {
  if (dates.length === 0) return "";
  const formatter = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long" });
  const start = parseISODate(dates[0]);
  const end = parseISODate(dates[dates.length - 1]);

  if (dates.length === 1) {
    return formatter.format(start);
  }

  return `${formatter.format(start)} - ${formatter.format(end)}`;
}

export function sortUniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

export function sortUniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, "it"));
}
