import type { AppRole } from "@/lib/roles";

export const STANDARD_SHIFT_TYPES = ["MATTINA", "POMERIGGIO", "FULL", "RIPOSO", "FERIE", "MALATTIA"] as const;
export const VIEW_MODES = ["MONTH", "WEEK"] as const;
export const STORES = ["duomo", "buenos_aires"] as const;
export const AVAILABILITY_STATUSES = ["lavoro", "riposo", "malattia", "permesso", "non_lavorato"] as const;

export type StandardShiftType = (typeof STANDARD_SHIFT_TYPES)[number];
export type ViewMode = (typeof VIEW_MODES)[number];
export type Store = (typeof STORES)[number];
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];
export type ScheduleStatus = "DRAFT" | "PUBLISHED";
export type UserRole = AppRole;
export type SaveState = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

export type CustomShiftAssignment = {
  kind: "CUSTOM";
  templateId: string;
  name: string;
  shortCode?: string;
  availabilityStatus?: AvailabilityStatus;
  startTime: string;
  endTime: string;
  unpaidBreakMinutes: number;
  shiftId?: string;
  store?: Store;
  note?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ShiftAssignment =
  | null
  | { kind: "STANDARD"; type: StandardShiftType }
  | CustomShiftAssignment;

export type ShiftId = StandardShiftType | `CUSTOM:${string}`;
export type AssignmentMatrix = Record<string, Record<string, ShiftAssignment>>;

export type ShiftRecord = {
  id: string;
  employeeId: string;
  store: Store;
  dateISO: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  workedHours: number;
};

export type ShiftWritePayload = {
  employeeId: string;
  store: Store;
  dateISO: string;
  startTime: string;
  endTime: string;
  withStandardBreak: boolean;
  note?: string | null;
  duplicateDates?: string[];
};

export type ShiftConflictItem = {
  dateISO: string;
  message: string;
  field?: "employeeId" | "store" | "dateISO" | "startTime" | "endTime" | "note" | "duplicateDates";
};

export type ShiftMutationResult = {
  items: ShiftRecord[];
  version: number;
  updatedAt: string;
  warnings: string[];
};

export type SessionUser = {
  id: string;
  name: string;
  role: UserRole;
};

export type Person = {
  id: string;
  fullName: string;
  active: boolean;
  photoUrl: string | null;
  homeStore: Store;
  availability: Record<string, AvailabilityStatus>;
  overrideStoreByDate?: Record<string, Store>;
  createdAt: string;
  updatedAt: string;
};

export type Employee = Person;

export type ShiftTemplate = {
  id: string;
  name: string;
  shortCode: string;
  availabilityStatus: AvailabilityStatus;
  startTime: string;
  endTime: string;
  unpaidBreakMinutes: number;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeRule = {
  id: string;
  employeeId: string;
  unavailableWeekdays: number[];
  unavailableDates: string[];
  forbiddenShiftIds: string[];
  preferredShiftId: ShiftId | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleData = {
  monthKey: string;
  status: ScheduleStatus;
  version: number;
  updatedAt: string;
  publishedAt: string | null;
  assignments: AssignmentMatrix;
  employees: Employee[];
  templates: ShiftTemplate[];
  rules: EmployeeRule[];
};

export type ScheduleVersionItem = {
  id: string;
  versionNumber: number;
  createdAt: string;
  createdByName: string;
};

export type AuditItem = {
  id: string;
  action: string;
  createdAt: string;
  userName: string;
  payloadJson: Record<string, unknown> & {
    employeeId?: string;
    dateISO?: string;
    oldShift?: ShiftAssignment;
    newShift?: ShiftAssignment;
  };
};

export type NetworkAddress = {
  label: string;
  url: string;
};

export type ImportSummary = {
  message: string;
  touchedMonths: string[];
  importedRows: number;
  skippedRows: number;
  createdTemplates: number;
  replacedBackup: boolean;
};

export type MonthExportPayload = {
  kind: "TURNISTICA_PARADISE_MONTH";
  exportedAt: string;
  monthKey: string;
  version: number;
  assignments: AssignmentMatrix;
};
