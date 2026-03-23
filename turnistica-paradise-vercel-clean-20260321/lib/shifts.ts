import type { AvailabilityStatus, CustomShiftAssignment, Employee, ShiftAssignment, ShiftConflictItem, ShiftRecord, ShiftWritePayload, Store } from "@/app/turnistica/_lib/types";

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const LONG_SHIFT_WARNING_MINUTES = 6 * 60;

function derivedAvailabilityStatus(assignment: Extract<ShiftAssignment, { kind: "CUSTOM" }>): AvailabilityStatus {
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

function createShiftId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `shift_${Math.random().toString(36).slice(2, 10)}`;
}

export function isValidShiftTime(value: string): boolean {
  return TIME_REGEX.test(value);
}

export function isValidShiftDate(value: string): boolean {
  return DATE_REGEX.test(value);
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function calculateWorkedMinutes(startTime: string, endTime: string, breakMinutes: number): number {
  return Math.max(0, timeToMinutes(endTime) - timeToMinutes(startTime) - Math.max(0, breakMinutes));
}

export function calculateWorkedHours(startTime: string, endTime: string, breakMinutes: number): number {
  return Number((calculateWorkedMinutes(startTime, endTime, breakMinutes) / 60).toFixed(2));
}

export function manualShiftLabel(startTime: string, endTime: string): string {
  return `${startTime}-${endTime}`;
}

export function isManualShiftAssignment(assignment: ShiftAssignment): assignment is CustomShiftAssignment & { shiftId: string; store: Store } {
  return Boolean(
    assignment &&
      assignment.kind === "CUSTOM" &&
      typeof assignment.shiftId === "string" &&
      assignment.shiftId.trim() &&
      (assignment.store === "duomo" || assignment.store === "buenos_aires")
  );
}

export function buildManualShiftAssignment(input: {
  shiftId?: string;
  store: Store;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  note?: string | null;
  createdAt?: string;
  updatedAt?: string;
}): CustomShiftAssignment {
  return {
    kind: "CUSTOM",
    templateId: input.shiftId ? `manual-shift:${input.shiftId}` : "manual-shift",
    name: manualShiftLabel(input.startTime, input.endTime),
    shortCode: "L",
    availabilityStatus: "lavoro",
    startTime: input.startTime,
    endTime: input.endTime,
    unpaidBreakMinutes: input.breakMinutes,
    shiftId: input.shiftId || createShiftId(),
    store: input.store,
    note: input.note?.trim() || null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
}

export function shiftRecordFromAssignment(employeeId: string, dateISO: string, assignment: ShiftAssignment): ShiftRecord | null {
  if (!isManualShiftAssignment(assignment)) return null;

  return {
    id: assignment.shiftId,
    employeeId,
    store: assignment.store,
    dateISO,
    startTime: assignment.startTime,
    endTime: assignment.endTime,
    breakMinutes: assignment.unpaidBreakMinutes,
    note: assignment.note ?? null,
    createdAt: assignment.createdAt || assignment.updatedAt || new Date().toISOString(),
    updatedAt: assignment.updatedAt || assignment.createdAt || new Date().toISOString(),
    workedHours: calculateWorkedHours(assignment.startTime, assignment.endTime, assignment.unpaidBreakMinutes)
  };
}

function assignmentDerivedAvailability(assignment: ShiftAssignment, currentShiftId?: string): AvailabilityStatus | null {
  if (!assignment) return null;

  if (isManualShiftAssignment(assignment) && assignment.shiftId === currentShiftId) {
    return null;
  }

  if (assignment.kind === "STANDARD") {
    if (assignment.type === "RIPOSO") return "riposo";
    if (assignment.type === "MALATTIA") return "malattia";
    if (assignment.type === "FERIE") return "non_lavorato";
    return "lavoro";
  }

  return derivedAvailabilityStatus(assignment);
}

export function getShiftBlockingAvailability(
  employee: Pick<Employee, "availability">,
  dateISO: string,
  currentAssignment: ShiftAssignment,
  currentShiftId?: string
): AvailabilityStatus | null {
  const explicit = employee.availability?.[dateISO];
  if (explicit && explicit !== "lavoro") {
    return explicit;
  }

  const derived = assignmentDerivedAvailability(currentAssignment, currentShiftId);
  if (derived && derived !== "lavoro") {
    return derived;
  }

  return null;
}

export function findShiftOverlap(
  candidate: { employeeId: string; dateISO: string; startTime: string; endTime: string; currentShiftId?: string },
  shifts: ShiftRecord[]
): ShiftRecord | null {
  const start = timeToMinutes(candidate.startTime);
  const end = timeToMinutes(candidate.endTime);

  for (const shift of shifts) {
    if (shift.employeeId !== candidate.employeeId) continue;
    if (shift.dateISO !== candidate.dateISO) continue;
    if (candidate.currentShiftId && shift.id === candidate.currentShiftId) continue;

    const otherStart = timeToMinutes(shift.startTime);
    const otherEnd = timeToMinutes(shift.endTime);
    if (start < otherEnd && otherStart < end) {
      return shift;
    }
  }

  return null;
}

export function normalizeDuplicateDates(primaryDateISO: string, duplicateDates?: string[]): string[] {
  const values = Array.isArray(duplicateDates) ? duplicateDates : [];
  return [...new Set(values.filter((value) => isValidShiftDate(value) && value !== primaryDateISO))].sort();
}

export function validateShiftPayload(
  payload: ShiftWritePayload,
  options: {
    currentShiftId?: string;
    blockingAvailability?: AvailabilityStatus | null;
    existingShifts?: ShiftRecord[];
    currentDateISO?: string;
  } = {}
): {
  ok: boolean;
  conflicts: ShiftConflictItem[];
  warnings: string[];
  breakMinutes: number;
  workedHours: number;
} {
  const conflicts: ShiftConflictItem[] = [];
  const warnings: string[] = [];
  const breakMinutes = payload.withStandardBreak ? 60 : 0;

  if (!payload.employeeId.trim()) {
    conflicts.push({ field: "employeeId", dateISO: payload.dateISO, message: "Seleziona un dipendente." });
  }

  if (!isValidShiftDate(payload.dateISO)) {
    conflicts.push({ field: "dateISO", dateISO: payload.dateISO, message: "La data del turno non è valida." });
  }

  if (!isValidShiftTime(payload.startTime)) {
    conflicts.push({ field: "startTime", dateISO: payload.dateISO, message: "Inserisci un orario di inizio valido." });
  }

  if (!isValidShiftTime(payload.endTime)) {
    conflicts.push({ field: "endTime", dateISO: payload.dateISO, message: "Inserisci un orario di fine valido." });
  }

  if (conflicts.length > 0) {
    return { ok: false, conflicts, warnings, breakMinutes, workedHours: 0 };
  }

  if (timeToMinutes(payload.endTime) <= timeToMinutes(payload.startTime)) {
    conflicts.push({
      field: "endTime",
      dateISO: payload.dateISO,
      message: "L'orario di fine deve essere successivo all'orario di inizio."
    });
  }

  if (options.blockingAvailability) {
    conflicts.push({
      field: "dateISO",
      dateISO: payload.dateISO,
      message: `La persona risulta ${options.blockingAvailability.replaceAll("_", " ")} in disponibilità per questa data.`
    });
  }

  const overlap = findShiftOverlap(
    {
      employeeId: payload.employeeId,
      dateISO: options.currentDateISO || payload.dateISO,
      startTime: payload.startTime,
      endTime: payload.endTime,
      currentShiftId: options.currentShiftId
    },
    options.existingShifts ?? []
  );

  if (overlap) {
    conflicts.push({
      field: "startTime",
      dateISO: overlap.dateISO,
      message: `Esiste già un turno sovrapposto (${overlap.startTime}-${overlap.endTime}) per questo dipendente.`
    });
  }

  const workedMinutes = calculateWorkedMinutes(payload.startTime, payload.endTime, breakMinutes);
  if (workedMinutes <= 0) {
    conflicts.push({
      field: "endTime",
      dateISO: payload.dateISO,
      message: "Il turno non è valido dopo la pausa standard."
    });
  }

  if (!payload.withStandardBreak && workedMinutes >= LONG_SHIFT_WARNING_MINUTES) {
    warnings.push("Turno lungo senza pausa standard attiva.");
  }

  return {
    ok: conflicts.length === 0,
    conflicts,
    warnings,
    breakMinutes,
    workedHours: Number((workedMinutes / 60).toFixed(2))
  };
}
