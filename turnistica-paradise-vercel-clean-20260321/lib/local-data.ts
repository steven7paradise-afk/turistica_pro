import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import type {
  AvailabilityStatus,
  AssignmentMatrix,
  CustomShiftAssignment,
  Employee,
  EmployeeRule,
  ImportSummary,
  MonthExportPayload,
  ScheduleData,
  ScheduleVersionItem,
  ShiftAssignment,
  ShiftConflictItem,
  ShiftId,
  ShiftMutationResult,
  ShiftRecord,
  ShiftWritePayload,
  Store,
  ShiftTemplate
} from "@/app/turnistica/_lib/types";
import { cloneMatrix, monthDates, parseCsv, shiftIdFromAssignment, sortUniqueNumbers, sortUniqueStrings } from "@/app/turnistica/_lib/utils";
import {
  buildManualShiftAssignment,
  getShiftBlockingAvailability,
  isManualShiftAssignment,
  normalizeDuplicateDates,
  shiftRecordFromAssignment,
  validateShiftPayload
} from "@/lib/shifts";
import { prisma } from "@/lib/prisma";

type StoredEmployee = {
  id: string;
  fullName: string;
  active: boolean;
  homeStore: Store;
  availability: Record<string, AvailabilityStatus>;
  overrideStoreByDate?: Record<string, Store>;
  photoFileName: string | null;
  photoMimeType: string | null;
  photoVersion: number;
  createdAt: string;
  updatedAt: string;
};

type StoredTemplate = {
  id: string;
  name: string;
  shortCode: string;
  availabilityStatus: AvailabilityStatus;
  startTime: string;
  endTime: string;
  unpaidBreakMinutes: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type StoredRule = {
  id: string;
  employeeId: string;
  unavailableWeekdays: number[];
  unavailableDates: string[];
  forbiddenShiftIds: string[];
  preferredShiftId: ShiftId | null;
  mustWorkWeekdays: number[];
  avoidRestWithEmployeeIds: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
};

type StoredAuditLog = {
  id: string;
  action: string;
  createdAt: string;
  userName: string;
  payloadJson: Record<string, unknown>;
};

type StoredVersion = {
  id: string;
  versionNumber: number;
  createdAt: string;
  createdByName: string;
  snapshot: AssignmentMatrix;
};

type StoredMonth = {
  id: string;
  monthKey: string;
  status: "DRAFT" | "PUBLISHED";
  version: number;
  updatedAt: string;
  publishedAt: string | null;
  assignments: AssignmentMatrix;
  versions: StoredVersion[];
  auditLogs: StoredAuditLog[];
};

type StoredStore = {
  schemaVersion: 2;
  createdAt: string;
  updatedAt: string;
  employees: StoredEmployee[];
  templates: StoredTemplate[];
  rules: StoredRule[];
  months: Record<string, StoredMonth>;
};

type LegacyStore = {
  employees?: Array<{
    id?: string;
    fullName?: string;
    active?: boolean;
    homeStore?: Store;
    availability?: Record<string, AvailabilityStatus>;
    overrideStoreByDate?: Record<string, Store>;
    photoDataUrl?: string | null;
  }>;
  templates?: Array<{
    id?: string;
    name?: string;
    shortCode?: string;
    availabilityStatus?: AvailabilityStatus;
    startTime?: string;
    endTime?: string;
    unpaidBreakMinutes?: number;
    breakMinutes?: number;
    active?: boolean;
    createdAt?: string;
    updatedAt?: string;
  }>;
  rules?: Array<{
    id?: string;
    employeeId?: string;
    unavailableDays?: number[];
    unavailableWeekdays?: number[];
    unavailableDates?: string[];
    forbiddenShiftIds?: string[];
    preferredShiftId?: string | null;
    mustWorkWeekdays?: number[];
    avoidRestWithEmployeeIds?: string[];
    note?: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
  scheduleMonths?: Array<{
    id?: string;
    monthKey?: string;
    status?: "DRAFT" | "PUBLISHED";
    version?: number;
    updatedAt?: string;
  }>;
  assignments?: Array<{
    scheduleMonthId?: string;
    employeeId?: string;
    dateISO?: string;
    assignmentJson?: ShiftAssignment;
  }>;
  versions?: Array<{
    id?: string;
    scheduleMonthId?: string;
    versionNumber?: number;
    snapshotJson?: AssignmentMatrix;
    createdByName?: string;
    createdById?: string | null;
    createdAt?: string;
  }>;
  auditLogs?: Array<{
    id?: string;
    scheduleMonthId?: string;
    action?: string;
    createdAt?: string;
    userName?: string;
    userId?: string | null;
    payloadJson?: Record<string, unknown>;
  }>;
};

type BackupEmployee = Omit<StoredEmployee, "photoFileName" | "photoMimeType" | "photoVersion"> & {
  photoDataUrl: string | null;
};

type BackupFile = {
  kind: "TURNISTICA_PARADISE_BACKUP";
  version: 1;
  exportedAt: string;
  data: {
    employees: BackupEmployee[];
    templates: StoredTemplate[];
    rules: StoredRule[];
    months: Record<string, StoredMonth>;
  };
};

const STORE_DIR = path.join(process.cwd(), ".local-data");
const STORE_FILE = path.join(STORE_DIR, "turnistica.json");
const PHOTO_DIR = path.join(STORE_DIR, "employee-photos");
const APP_STATE_KEY = "primary";
const MONTH_KEY_REGEX = /^\d{4}-\d{2}$/;
const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const STORE_VALUES: Store[] = ["duomo", "buenos_aires"];
const AVAILABILITY_VALUES: AvailabilityStatus[] = ["lavoro", "riposo", "malattia", "permesso", "non_lavorato"];
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};
const PRINT_CODE_MAP: Record<string, ShiftId> = {
  M: "MATTINA",
  P: "POMERIGGIO",
  F: "FULL",
  R: "RIPOSO",
  FE: "FERIE",
  MA: "MALATTIA"
};

let writeQueue: Promise<void> = Promise.resolve();

function firstEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) {
      return value;
    }
  }

  return "";
}

function isReadonlyFsError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? String(error.code) : "";
  return code === "EROFS" || code === "EPERM";
}

function databaseEnabled() {
  const mode = process.env.PARADISE_STORAGE_MODE?.trim().toLowerCase();

  if (mode === "local") {
    return false;
  }

  if (mode === "database") {
    return true;
  }

  return Boolean(
    firstEnv(
      "DATABASE_URL",
      "DIRECT_URL",
      "POSTGRES_PRISMA_URL",
      "POSTGRES_URL",
      "POSTGRES_URL_NON_POOLING",
      "SUPABASE_DATABASE_URL",
      "SUPABASE_DIRECT_URL",
      "NETLIFY_DATABASE_URL",
      "NETLIFY_DATABASE_URL_UNPOOLED"
    )
  );
}

function toPrismaJson(value: StoredStore): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultStore(): StoredStore {
  const now = nowIso();
  return {
    schemaVersion: 2,
    createdAt: now,
    updatedAt: now,
    employees: [],
    templates: [],
    rules: [],
    months: {}
  };
}

function emptyScheduleData(monthKey: string): ScheduleData {
  const month = normalizeMonth(monthKey, {
    monthKey,
    assignments: {},
    versions: [],
    auditLogs: []
  });

  return {
    monthKey,
    status: month.status,
    version: month.version,
    updatedAt: month.updatedAt,
    publishedAt: month.publishedAt,
    assignments: {},
    employees: [],
    templates: [],
    rules: []
  };
}

function photoUrl(employee: StoredEmployee): string | null {
  if (!employee.photoFileName) return null;
  return `/api/employees/photo?employeeId=${encodeURIComponent(employee.id)}&v=${employee.photoVersion}`;
}

function toPublicEmployee(employee: StoredEmployee): Employee {
  return {
    id: employee.id,
    fullName: employee.fullName,
    active: employee.active,
    photoUrl: photoUrl(employee),
    homeStore: employee.homeStore,
    availability: { ...employee.availability },
    overrideStoreByDate: employee.overrideStoreByDate ? { ...employee.overrideStoreByDate } : undefined,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt
  };
}

function toPublicTemplate(template: StoredTemplate): ShiftTemplate {
  return {
    id: template.id,
    name: template.name,
    shortCode: template.shortCode,
    availabilityStatus: template.availabilityStatus,
    startTime: template.startTime,
    endTime: template.endTime,
    unpaidBreakMinutes: template.unpaidBreakMinutes,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

function toPublicRule(rule: StoredRule): EmployeeRule {
  return {
    id: rule.id,
    employeeId: rule.employeeId,
    unavailableWeekdays: rule.unavailableWeekdays,
    unavailableDates: rule.unavailableDates,
    forbiddenShiftIds: rule.forbiddenShiftIds,
    preferredShiftId: rule.preferredShiftId,
    mustWorkWeekdays: rule.mustWorkWeekdays,
    avoidRestWithEmployeeIds: rule.avoidRestWithEmployeeIds,
    note: rule.note,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt
  };
}

function isStandardShift(value: string): value is Exclude<ShiftId, `CUSTOM:${string}`> {
  return value === "MATTINA" || value === "POMERIGGIO" || value === "FULL" || value === "RIPOSO" || value === "FERIE" || value === "MALATTIA";
}

function isStoreValue(value: unknown): value is Store {
  return typeof value === "string" && STORE_VALUES.includes(value as Store);
}

function isAvailabilityValue(value: unknown): value is AvailabilityStatus {
  return typeof value === "string" && AVAILABILITY_VALUES.includes(value as AvailabilityStatus);
}

function normalizeAvailabilityRecord(value: unknown): Record<string, AvailabilityStatus> {
  if (!value || typeof value !== "object") return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([dateISO, status]) => DATE_ISO_REGEX.test(dateISO) && isAvailabilityValue(status))
  ) as Record<string, AvailabilityStatus>;
}

function normalizeOverrideStoreRecord(value: unknown): Record<string, Store> | undefined {
  if (!value || typeof value !== "object") return undefined;

  const entries = Object.entries(value as Record<string, unknown>).filter(([dateISO, store]) => DATE_ISO_REGEX.test(dateISO) && isStoreValue(store));
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as Record<string, Store>;
}

function normalizeBreakMinutes(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function templateStatusFromName(value: string): AvailabilityStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("riposo")) return "riposo";
  if (normalized.includes("malattia")) return "malattia";
  if (normalized.includes("permesso")) return "permesso";
  if (normalized.includes("ferie") || normalized.includes("non lavorato") || normalized.includes("non_lavorato")) return "non_lavorato";
  return "lavoro";
}

function normalizeShortCode(value: unknown, fallbackName: string) {
  const explicit = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (explicit) {
    return explicit.slice(0, 4);
  }

  return fallbackName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 4) || "TR";
}

function normalizeAssignment(value: unknown): ShiftAssignment {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  if (record.kind === "STANDARD" && typeof record.type === "string" && isStandardShift(record.type)) {
    return { kind: "STANDARD", type: record.type };
  }

  if (
    record.kind === "CUSTOM" &&
    typeof record.templateId === "string" &&
    typeof record.name === "string" &&
    typeof record.startTime === "string" &&
    typeof record.endTime === "string"
  ) {
    return {
      kind: "CUSTOM",
      templateId: record.templateId,
      name: record.name,
      shortCode: typeof record.shortCode === "string" && record.shortCode.trim() ? record.shortCode.trim().toUpperCase().slice(0, 4) : undefined,
      availabilityStatus: isAvailabilityValue(record.availabilityStatus) ? record.availabilityStatus : undefined,
      startTime: record.startTime,
      endTime: record.endTime,
      unpaidBreakMinutes: normalizeBreakMinutes(record.unpaidBreakMinutes),
      shiftId: typeof record.shiftId === "string" && record.shiftId.trim() ? record.shiftId : undefined,
      store: isStoreValue(record.store) ? record.store : undefined,
      note:
        typeof record.note === "string"
          ? record.note.trim() || null
          : record.note === null
            ? null
            : undefined,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined
    };
  }

  return null;
}

function normalizeMatrix(value: unknown): AssignmentMatrix {
  if (!value || typeof value !== "object") return {};
  const matrix: AssignmentMatrix = {};

  Object.entries(value as Record<string, unknown>).forEach(([employeeId, byDate]) => {
    if (!byDate || typeof byDate !== "object") return;
    matrix[employeeId] = {};

    Object.entries(byDate as Record<string, unknown>).forEach(([dateISO, assignment]) => {
      if (!DATE_ISO_REGEX.test(dateISO)) return;
      matrix[employeeId][dateISO] = normalizeAssignment(assignment);
    });
  });

  return matrix;
}

function normalizeEmployee(value: Partial<StoredEmployee>): StoredEmployee {
  const now = nowIso();
  return {
    id: String(value.id || randomUUID()),
    fullName: String(value.fullName || "").trim() || "Nuova persona",
    active: value.active !== false,
    homeStore: isStoreValue(value.homeStore) ? value.homeStore : "duomo",
    availability: normalizeAvailabilityRecord(value.availability),
    overrideStoreByDate: normalizeOverrideStoreRecord(value.overrideStoreByDate),
    photoFileName: typeof value.photoFileName === "string" ? value.photoFileName : null,
    photoMimeType: typeof value.photoMimeType === "string" ? value.photoMimeType : null,
    photoVersion: Number.isFinite(value.photoVersion) ? Number(value.photoVersion) : Date.now(),
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now
  };
}

function normalizeTemplate(value: Partial<StoredTemplate>): StoredTemplate {
  const now = nowIso();
  const name = String(value.name || "").trim() || "Turno personalizzato";
  return {
    id: String(value.id || randomUUID()),
    name,
    shortCode: normalizeShortCode((value as Partial<StoredTemplate> & { code?: string }).code ?? value.shortCode, name),
    availabilityStatus: isAvailabilityValue(value.availabilityStatus) ? value.availabilityStatus : templateStatusFromName(name),
    startTime: TIME_REGEX.test(String(value.startTime || "")) ? String(value.startTime) : "09:00",
    endTime: TIME_REGEX.test(String(value.endTime || "")) ? String(value.endTime) : "18:00",
    unpaidBreakMinutes: normalizeBreakMinutes((value as Partial<StoredTemplate> & { breakMinutes?: number }).breakMinutes ?? value.unpaidBreakMinutes),
    active: value.active !== false,
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now
  };
}

function normalizeRule(value: Partial<StoredRule>): StoredRule {
  const now = nowIso();
  return {
    id: String(value.id || randomUUID()),
    employeeId: String(value.employeeId || ""),
    unavailableWeekdays: sortUniqueNumbers(
      Array.isArray(value.unavailableWeekdays)
        ? value.unavailableWeekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
        : []
    ),
    unavailableDates: sortUniqueStrings(
      Array.isArray(value.unavailableDates)
        ? value.unavailableDates.filter((date): date is string => typeof date === "string" && DATE_ISO_REGEX.test(date))
        : []
    ),
    forbiddenShiftIds: sortUniqueStrings(
      Array.isArray(value.forbiddenShiftIds)
        ? value.forbiddenShiftIds.filter((shiftId): shiftId is string => typeof shiftId === "string")
        : []
    ),
    preferredShiftId: typeof value.preferredShiftId === "string" && value.preferredShiftId.trim() ? value.preferredShiftId : null,
    mustWorkWeekdays: sortUniqueNumbers(
      Array.isArray(value.mustWorkWeekdays)
        ? value.mustWorkWeekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
        : []
    ),
    avoidRestWithEmployeeIds: sortUniqueStrings(
      Array.isArray(value.avoidRestWithEmployeeIds)
        ? value.avoidRestWithEmployeeIds.filter((employeeId): employeeId is string => typeof employeeId === "string" && employeeId.trim().length > 0)
        : []
    ),
    note: typeof value.note === "string" ? value.note.trim() : "",
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now
  };
}

function normalizeVersion(value: Partial<StoredVersion>): StoredVersion {
  return {
    id: String(value.id || randomUUID()),
    versionNumber: Number.isFinite(value.versionNumber) ? Number(value.versionNumber) : 1,
    createdAt: value.createdAt || nowIso(),
    createdByName: typeof value.createdByName === "string" && value.createdByName.trim() ? value.createdByName : "Paradise",
    snapshot: normalizeMatrix(value.snapshot)
  };
}

function normalizeAudit(value: Partial<StoredAuditLog>): StoredAuditLog {
  return {
    id: String(value.id || randomUUID()),
    action: typeof value.action === "string" && value.action.trim() ? value.action : "SCHEDULE_UPDATED",
    createdAt: value.createdAt || nowIso(),
    userName: typeof value.userName === "string" && value.userName.trim() ? value.userName : "Paradise",
    payloadJson: value.payloadJson && typeof value.payloadJson === "object" ? value.payloadJson : {}
  };
}

function normalizeMonth(monthKey: string, value: Partial<StoredMonth>): StoredMonth {
  return {
    id: String(value.id || randomUUID()),
    monthKey,
    status: value.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
    version: Number.isFinite(value.version) ? Math.max(1, Number(value.version)) : 1,
    updatedAt: value.updatedAt || nowIso(),
    publishedAt: typeof value.publishedAt === "string" ? value.publishedAt : null,
    assignments: normalizeMatrix(value.assignments),
    versions: Array.isArray(value.versions) ? value.versions.map((version) => normalizeVersion(version)) : [],
    auditLogs: Array.isArray(value.auditLogs) ? value.auditLogs.map((audit) => normalizeAudit(audit)) : []
  };
}

function normalizeStore(value: Partial<StoredStore>): StoredStore {
  const store = defaultStore();
  const months = value.months && typeof value.months === "object" ? value.months : {};

  return {
    schemaVersion: 2,
    createdAt: value.createdAt || store.createdAt,
    updatedAt: value.updatedAt || nowIso(),
    employees: Array.isArray(value.employees) ? value.employees.map((employee) => normalizeEmployee(employee)) : [],
    templates: Array.isArray(value.templates) ? value.templates.map((template) => normalizeTemplate(template)) : [],
    rules: Array.isArray(value.rules) ? value.rules.map((rule) => normalizeRule(rule)) : [],
    months: Object.fromEntries(
      Object.entries(months).filter(([monthKey]) => MONTH_KEY_REGEX.test(monthKey)).map(([monthKey, month]) => [monthKey, normalizeMonth(monthKey, month as Partial<StoredMonth>)])
    )
  };
}

async function ensureStorage() {
  if (databaseEnabled()) {
    return;
  }

  try {
    await fs.access(STORE_FILE);
    return;
  } catch {
    // Continue and try to initialize local storage.
  }

  try {
    await fs.mkdir(STORE_DIR, { recursive: true });
    await fs.mkdir(PHOTO_DIR, { recursive: true });
    await fs.writeFile(STORE_FILE, JSON.stringify(defaultStore(), null, 2), "utf8");
  } catch (error) {
    if (isReadonlyFsError(error)) {
      return;
    }

    throw error;
  }
}

async function writeStore(store: StoredStore) {
  await ensureStorage();
  const normalized = normalizeStore(store);
  normalized.updatedAt = nowIso();

  const task = writeQueue.catch(() => undefined).then(async () => {
    if (databaseEnabled()) {
      await prisma.appState.upsert({
        where: { key: APP_STATE_KEY },
        update: { stateJson: toPrismaJson(normalized) },
        create: {
          key: APP_STATE_KEY,
          stateJson: toPrismaJson(normalized)
        }
      });
      return;
    }

    const tempPath = `${STORE_FILE}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(normalized, null, 2), "utf8");
    await fs.rename(tempPath, STORE_FILE);
  });

  writeQueue = task;
  await task;
}

async function backupRawContent(raw: string, reason: string) {
  if (databaseEnabled()) return;
  if (!raw.trim()) return;
  const backupPath = STORE_FILE.replace(/\.json$/, `.${reason}.${Date.now()}.backup.json`);
  try {
    await fs.writeFile(backupPath, raw, "utf8");
  } catch (error) {
    if (!isReadonlyFsError(error)) {
      throw error;
    }
  }
}

function extFromMime(mimeType: string): string {
  return MIME_TO_EXT[mimeType] || "bin";
}

function mimeFromFileName(fileName: string): string {
  const ext = path.extname(fileName).replace(".", "").toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

async function removePhotoVariants(employeeId: string, preserveFileName?: string) {
  if (databaseEnabled()) {
    if (!preserveFileName) {
      await prisma.employeePhoto.deleteMany({ where: { employeeId } });
    }
    return;
  }

  const files = await fs.readdir(PHOTO_DIR).catch(() => []);
  await Promise.all(
    files
      .filter((fileName) => fileName.startsWith(`${employeeId}.`) && fileName !== preserveFileName)
      .map((fileName) => fs.unlink(path.join(PHOTO_DIR, fileName)).catch(() => undefined))
  );
}

async function writePhotoFile(employeeId: string, buffer: Buffer, mimeType: string) {
  await ensureStorage();
  const fileName = `${employeeId}.${extFromMime(mimeType)}`;

  if (databaseEnabled()) {
    await prisma.employeePhoto.upsert({
      where: { employeeId },
      update: {
        mimeType,
        dataBase64: buffer.toString("base64")
      },
      create: {
        employeeId,
        mimeType,
        dataBase64: buffer.toString("base64")
      }
    });
    return { fileName, mimeType };
  }

  const filePath = path.join(PHOTO_DIR, fileName);
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, buffer);
  await fs.rename(tempPath, filePath);
  await removePhotoVariants(employeeId, fileName);
  return { fileName, mimeType };
}

function parseDataUrl(value: string): { mimeType: string; buffer: Buffer } | null {
  const match = /^data:(.+?);base64,(.+)$/.exec(value);
  if (!match) return null;
  try {
    return {
      mimeType: match[1],
      buffer: Buffer.from(match[2], "base64")
    };
  } catch {
    return null;
  }
}

async function readEmployeePhotoDataUrl(employee: StoredEmployee): Promise<string | null> {
  if (!employee.photoFileName) return null;

  if (databaseEnabled()) {
    const photo = await prisma.employeePhoto.findUnique({ where: { employeeId: employee.id } });
    if (!photo) return null;
    return `data:${photo.mimeType};base64,${photo.dataBase64}`;
  }

  try {
    const filePath = path.join(PHOTO_DIR, employee.photoFileName);
    const buffer = await fs.readFile(filePath);
    const mimeType = employee.photoMimeType || mimeFromFileName(employee.photoFileName);
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

function ensureMonth(store: StoredStore, monthKey: string): StoredMonth {
  if (!store.months[monthKey]) {
    store.months[monthKey] = normalizeMonth(monthKey, {
      id: randomUUID(),
      monthKey,
      status: "DRAFT",
      version: 1,
      updatedAt: nowIso(),
      publishedAt: null,
      assignments: {},
      versions: [],
      auditLogs: []
    });
  }

  return store.months[monthKey];
}

function mapLegacyStore(legacy: LegacyStore): Partial<StoredStore> {
  const monthsById = new Map<string, string>();
  const months: Record<string, StoredMonth> = {};

  legacy.scheduleMonths?.forEach((month) => {
    const monthKey = typeof month.monthKey === "string" && MONTH_KEY_REGEX.test(month.monthKey) ? month.monthKey : null;
    if (!monthKey) return;

    const normalized = normalizeMonth(monthKey, {
      id: month.id || randomUUID(),
      monthKey,
      status: month.status,
      version: month.version,
      updatedAt: month.updatedAt,
      publishedAt: null,
      assignments: {},
      versions: [],
      auditLogs: []
    });

    months[monthKey] = normalized;
    monthsById.set(normalized.id, monthKey);
    if (month.id) {
      monthsById.set(month.id, monthKey);
    }
  });

  legacy.assignments?.forEach((assignment) => {
    const monthKey = assignment.scheduleMonthId ? monthsById.get(assignment.scheduleMonthId) : undefined;
    if (!monthKey || !assignment.employeeId || !assignment.dateISO) return;
    const month = months[monthKey] ?? normalizeMonth(monthKey, {});
    if (!month.assignments[assignment.employeeId]) {
      month.assignments[assignment.employeeId] = {};
    }
    month.assignments[assignment.employeeId][assignment.dateISO] = normalizeAssignment(assignment.assignmentJson);
    months[monthKey] = month;
  });

  legacy.versions?.forEach((version) => {
    const monthKey = version.scheduleMonthId ? monthsById.get(version.scheduleMonthId) : undefined;
    if (!monthKey || !months[monthKey]) return;
    months[monthKey].versions.push(
      normalizeVersion({
        id: version.id,
        versionNumber: version.versionNumber,
        createdAt: version.createdAt,
        createdByName: version.createdByName || "Paradise",
        snapshot: version.snapshotJson
      })
    );
  });

  legacy.auditLogs?.forEach((audit) => {
    const monthKey = audit.scheduleMonthId ? monthsById.get(audit.scheduleMonthId) : undefined;
    if (!monthKey || !months[monthKey]) return;
    months[monthKey].auditLogs.push(
      normalizeAudit({
        id: audit.id,
        action: audit.action,
        createdAt: audit.createdAt,
        userName: audit.userName || "Paradise",
        payloadJson: audit.payloadJson
      })
    );
  });

  return {
    employees: legacy.employees?.map((employee) =>
      normalizeEmployee({
        id: employee.id,
        fullName: employee.fullName,
        active: employee.active,
        homeStore: employee.homeStore,
        availability: employee.availability,
        overrideStoreByDate: employee.overrideStoreByDate,
        photoFileName: null,
        photoMimeType: null,
        photoVersion: Date.now()
      })
    ),
    templates: legacy.templates?.map((template) =>
      normalizeTemplate({
        id: template.id,
        name: template.name,
        startTime: template.startTime,
        endTime: template.endTime,
        unpaidBreakMinutes: template.unpaidBreakMinutes ?? template.breakMinutes,
        active: template.active,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt
      })
    ),
    rules: legacy.rules?.map((rule) =>
      normalizeRule({
        id: rule.id,
        employeeId: rule.employeeId,
        unavailableWeekdays: Array.isArray(rule.unavailableWeekdays)
          ? rule.unavailableWeekdays
          : Array.isArray(rule.unavailableDays)
            ? rule.unavailableDays
            : [],
        unavailableDates: rule.unavailableDates,
        forbiddenShiftIds: rule.forbiddenShiftIds,
        preferredShiftId: rule.preferredShiftId as ShiftId | null | undefined,
        mustWorkWeekdays: rule.mustWorkWeekdays,
        avoidRestWithEmployeeIds: rule.avoidRestWithEmployeeIds,
        note: rule.note,
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt
      })
    ),
    months
  };
}

async function migrateLegacyStore(raw: string, legacy: LegacyStore): Promise<StoredStore> {
  const migrated = normalizeStore(mapLegacyStore(legacy));
  const photos = legacy.employees ?? [];

  for (const legacyEmployee of photos) {
    const employee = migrated.employees.find((item) => item.id === legacyEmployee.id);
    const parsedPhoto = typeof legacyEmployee.photoDataUrl === "string" ? parseDataUrl(legacyEmployee.photoDataUrl) : null;
    if (!employee || !parsedPhoto) continue;

    const saved = await writePhotoFile(employee.id, parsedPhoto.buffer, parsedPhoto.mimeType);
    employee.photoFileName = saved.fileName;
    employee.photoMimeType = saved.mimeType;
    employee.photoVersion = Date.now();
  }

  await backupRawContent(raw, "legacy");
  await writeStore(migrated);
  return migrated;
}

async function bootstrapDatabaseFromBundledLocalFiles(): Promise<StoredStore | null> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    if (!raw.trim()) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StoredStore> | LegacyStore;
    if (parsed && typeof parsed === "object" && "schemaVersion" in parsed && parsed.schemaVersion === 2) {
      const normalized = normalizeStore(parsed);

      for (const employee of normalized.employees) {
        if (!employee.photoFileName) continue;

        try {
          const buffer = await fs.readFile(path.join(PHOTO_DIR, employee.photoFileName));
          await writePhotoFile(employee.id, buffer, employee.photoMimeType || mimeFromFileName(employee.photoFileName));
        } catch {
          employee.photoFileName = null;
          employee.photoMimeType = null;
        }
      }

      await writeStore(normalized);
      return normalized;
    }

    return migrateLegacyStore(raw, parsed as LegacyStore);
  } catch {
    return null;
  }
}

async function resetStore(raw: string, reason: "empty" | "invalid") {
  await backupRawContent(raw, reason);
  const fallback = defaultStore();
  try {
    await writeStore(fallback);
  } catch (error) {
    if (!isReadonlyFsError(error)) {
      throw error;
    }
  }
  return fallback;
}

async function readStore(): Promise<StoredStore> {
  try {
    if (databaseEnabled()) {
      const row = await prisma.appState.findUnique({ where: { key: APP_STATE_KEY } });

      if (!row) {
        const bootstrapped = await bootstrapDatabaseFromBundledLocalFiles();
        if (bootstrapped) {
          return bootstrapped;
        }

        const fallback = defaultStore();
        await writeStore(fallback);
        return fallback;
      }

      const parsed = row.stateJson as Partial<StoredStore> | LegacyStore;
      if (parsed && typeof parsed === "object" && "schemaVersion" in parsed && parsed.schemaVersion === 2) {
        return normalizeStore(parsed);
      }

      return migrateLegacyStore(JSON.stringify(row.stateJson), parsed as LegacyStore);
    }

    await ensureStorage();
    const raw = await fs.readFile(STORE_FILE, "utf8").catch((error) => {
      if (isReadonlyFsError(error) || (error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        return JSON.stringify(defaultStore());
      }

      throw error;
    });

    if (!raw.trim()) {
      return resetStore(raw, "empty");
    }

    const parsed = JSON.parse(raw) as Partial<StoredStore> | LegacyStore;
    if (parsed && typeof parsed === "object" && "schemaVersion" in parsed && parsed.schemaVersion === 2) {
      return normalizeStore(parsed);
    }

    return migrateLegacyStore(raw, parsed as LegacyStore);
  } catch (error) {
    console.error("readStore: fallback su archivio vuoto", error);
    return defaultStore();
  }
}

function sanitizeAssignments(assignments: AssignmentMatrix): AssignmentMatrix {
  const next: AssignmentMatrix = {};

  Object.entries(assignments).forEach(([employeeId, byDate]) => {
    if (!byDate || typeof byDate !== "object") return;
    next[employeeId] = {};

    Object.entries(byDate).forEach(([dateISO, assignment]) => {
      if (!DATE_ISO_REGEX.test(dateISO)) return;
      next[employeeId][dateISO] = normalizeAssignment(assignment);
    });
  });

  return next;
}

function pushAudit(month: StoredMonth, action: string, userName: string, payloadJson: Record<string, unknown>) {
  month.auditLogs.unshift({
    id: randomUUID(),
    action,
    createdAt: nowIso(),
    userName,
    payloadJson
  });
}

function applyMonthMatrix(store: StoredStore, monthKey: string, assignments: AssignmentMatrix, userName: string, action: string) {
  const month = ensureMonth(store, monthKey);
  const current = month.assignments;
  const next = sanitizeAssignments(assignments);
  const changes: Array<{ employeeId: string; dateISO: string; oldShift: ShiftAssignment; newShift: ShiftAssignment }> = [];

  const employeeIds = new Set([...Object.keys(current), ...Object.keys(next)]);
  employeeIds.forEach((employeeId) => {
    const currentDates = current[employeeId] ?? {};
    const nextDates = next[employeeId] ?? {};
    const dateKeys = new Set([...Object.keys(currentDates), ...Object.keys(nextDates)]);

    dateKeys.forEach((dateISO) => {
      const oldShift = currentDates[dateISO] ?? null;
      const newShift = nextDates[dateISO] ?? null;
      if (JSON.stringify(oldShift) !== JSON.stringify(newShift)) {
        changes.push({ employeeId, dateISO, oldShift, newShift });
      }
    });
  });

  month.assignments = next;
  month.status = "DRAFT";
  month.version += 1;
  month.updatedAt = nowIso();

  if (changes.length === 0) {
    pushAudit(month, action, userName, { monthKey, changedCells: 0 });
    return month;
  }

  changes.forEach((change) => {
    pushAudit(month, action, userName, {
      monthKey,
      employeeId: change.employeeId,
      dateISO: change.dateISO,
      oldShift: change.oldShift,
      newShift: change.newShift
    });
  });

  return month;
}

function activeTemplates(store: StoredStore): ShiftTemplate[] {
  return store.templates.filter((template) => template.active).sort((left, right) => left.name.localeCompare(right.name, "it")).map((template) => toPublicTemplate(template));
}

function allEmployees(store: StoredStore, includeInactive: boolean): Employee[] {
  return store.employees
    .filter((employee) => includeInactive || employee.active)
    .sort((left, right) => {
      if (left.active !== right.active) {
        return left.active ? -1 : 1;
      }
      if (left.homeStore !== right.homeStore) {
        return left.homeStore.localeCompare(right.homeStore);
      }
      return left.fullName.localeCompare(right.fullName, "it");
    })
    .map((employee) => toPublicEmployee(employee));
}

function allRules(store: StoredStore): EmployeeRule[] {
  return store.rules
    .slice()
    .sort((left, right) => left.employeeId.localeCompare(right.employeeId))
    .map((rule) => toPublicRule(rule));
}

function allShiftsForMonth(store: StoredStore, monthKey: string): ShiftRecord[] {
  const month = ensureMonth(store, monthKey);
  const shifts: ShiftRecord[] = [];

  Object.entries(month.assignments).forEach(([employeeId, byDate]) => {
    Object.entries(byDate ?? {}).forEach(([dateISO, assignment]) => {
      const shift = shiftRecordFromAssignment(employeeId, dateISO, assignment ?? null);
      if (shift) {
        shifts.push(shift);
      }
    });
  });

  return shifts.sort((left, right) => {
    if (left.dateISO !== right.dateISO) {
      return left.dateISO.localeCompare(right.dateISO);
    }
    if (left.store !== right.store) {
      return left.store.localeCompare(right.store);
    }
    return left.startTime.localeCompare(right.startTime);
  });
}

function normalizeImportedStandardShift(raw: string): ShiftId | null {
  const normalized = raw.trim().toUpperCase();
  if (isStandardShift(normalized)) return normalized;
  return PRINT_CODE_MAP[normalized] || null;
}

function findOrCreateTemplate(
  store: StoredStore,
  name: string,
  shortCode: string,
  availabilityStatus: AvailabilityStatus,
  startTime: string,
  endTime: string,
  unpaidBreakMinutes = 0
) {
  const trimmedName = name.trim();
  const existing = store.templates.find(
    (template) =>
      template.name.toLowerCase() === trimmedName.toLowerCase() &&
      template.shortCode === shortCode &&
      template.availabilityStatus === availabilityStatus &&
      template.startTime === startTime &&
      template.endTime === endTime &&
      template.unpaidBreakMinutes === unpaidBreakMinutes
  );

  if (existing) {
    existing.active = true;
    existing.updatedAt = nowIso();
    return { template: existing, created: false };
  }

  const createdAt = nowIso();
  const created: StoredTemplate = {
    id: randomUUID(),
    name: trimmedName,
    shortCode: normalizeShortCode(shortCode, trimmedName),
    availabilityStatus,
    startTime,
    endTime,
    unpaidBreakMinutes,
    active: true,
    createdAt,
    updatedAt: createdAt
  };

  store.templates.push(created);
  return { template: created, created: true };
}

function resolveImportedAssignment(
  store: StoredStore,
  row: Record<string, string>
): { assignment: ShiftAssignment; createdTemplate: boolean } | null {
  const kind = (row.kind || "").trim().toUpperCase();
  const shiftCode = (row.shiftCode || row.shift || "").trim();
  const name = (row.name || "").trim();
  const startTime = (row.startTime || "").trim();
  const endTime = (row.endTime || "").trim();
  const unpaidBreakMinutes = normalizeBreakMinutes(row.unpaidBreakMinutes || row.breakMinutes || row.break || 0);

  if (!kind || kind === "EMPTY") {
    return { assignment: null, createdTemplate: false };
  }

  const standardShift = normalizeImportedStandardShift(shiftCode || kind);
  if (kind === "STANDARD" && standardShift) {
    return {
      assignment: { kind: "STANDARD", type: standardShift as Exclude<ShiftId, `CUSTOM:${string}`> },
      createdTemplate: false
    };
  }

  if ((!kind || kind === "CUSTOM" || shiftCode.startsWith("CUSTOM:")) && name && TIME_REGEX.test(startTime) && TIME_REGEX.test(endTime)) {
    const inferredStatus = templateStatusFromName(name);
    const { template, created } = findOrCreateTemplate(
      store,
      name,
      normalizeShortCode(undefined, name),
      inferredStatus,
      startTime,
      endTime,
      unpaidBreakMinutes
    );
    return {
      assignment: {
        kind: "CUSTOM",
        templateId: template.id,
        name: template.name,
        shortCode: template.shortCode,
        availabilityStatus: template.availabilityStatus,
        startTime: template.startTime,
        endTime: template.endTime,
        unpaidBreakMinutes: template.unpaidBreakMinutes
      },
      createdTemplate: created
    };
  }

  if (standardShift) {
    return {
      assignment: { kind: "STANDARD", type: standardShift as Exclude<ShiftId, `CUSTOM:${string}`> },
      createdTemplate: false
    };
  }

  return null;
}

export function shouldUseLocalData() {
  return !databaseEnabled();
}

export async function getLocalSchedule(monthKey: string): Promise<ScheduleData> {
  try {
    const store = await readStore();
    const month = ensureMonth(store, monthKey);
    await writeStore(store).catch((error) => {
      console.error("getLocalSchedule: impossibile salvare il mese iniziale", error);
    });

    return {
      monthKey,
      status: month.status,
      version: month.version,
      updatedAt: month.updatedAt,
      publishedAt: month.publishedAt,
      assignments: cloneMatrix(month.assignments),
      employees: allEmployees(store, false),
      templates: activeTemplates(store),
      rules: allRules(store).filter((rule) => store.employees.some((employee) => employee.id === rule.employeeId && employee.active))
    };
  } catch (error) {
    console.error("getLocalSchedule: fallback su mese vuoto", error);
    return emptyScheduleData(monthKey);
  }
}

export async function listLocalShifts(
  monthKey: string,
  filters: { employeeId?: string; store?: Store; from?: string; to?: string } = {}
): Promise<ShiftRecord[]> {
  const store = await readStore();
  return allShiftsForMonth(store, monthKey).filter((shift) => {
    if (filters.employeeId && shift.employeeId !== filters.employeeId) return false;
    if (filters.store && shift.store !== filters.store) return false;
    if (filters.from && shift.dateISO < filters.from) return false;
    if (filters.to && shift.dateISO > filters.to) return false;
    return true;
  });
}

export async function upsertLocalShift(
  monthKey: string,
  payload: ShiftWritePayload,
  userName: string,
  shiftId?: string
): Promise<
  | { ok: true; result: ShiftMutationResult }
  | { ok: false; conflicts: ShiftConflictItem[]; warnings: string[] }
> {
  const store = await readStore();
  const month = ensureMonth(store, monthKey);
  const monthDateSet = new Set(monthDates(monthKey));
  const employee = store.employees.find((item) => item.id === payload.employeeId && item.active);
  const employeePublic = employee ? toPublicEmployee(employee) : null;
  const currentShift = shiftId ? allShiftsForMonth(store, monthKey).find((item) => item.id === shiftId) ?? null : null;
  const targetDates = [payload.dateISO, ...normalizeDuplicateDates(payload.dateISO, payload.duplicateDates)];
  const conflicts: ShiftConflictItem[] = [];
  const warnings = new Set<string>();

  if (!employee || !employeePublic) {
    return {
      ok: false,
      conflicts: [{ field: "employeeId", dateISO: payload.dateISO, message: "Il dipendente selezionato non è disponibile." }],
      warnings: []
    };
  }

  const existingShifts = allShiftsForMonth(store, monthKey);
  const nextMatrix = cloneMatrix(month.assignments);

  if (currentShift) {
    if (nextMatrix[currentShift.employeeId]) {
      nextMatrix[currentShift.employeeId][currentShift.dateISO] = null;
    }
  }

  targetDates.forEach((dateISO) => {
    if (!monthDateSet.has(dateISO)) {
      conflicts.push({
        field: "duplicateDates",
        dateISO,
        message: "La duplicazione può usare solo giorni dello stesso mese attivo."
      });
      return;
    }

    const currentAssignment = nextMatrix[payload.employeeId]?.[dateISO] ?? null;
    const blockingAvailability = getShiftBlockingAvailability(
      employeePublic,
      dateISO,
      currentAssignment,
      currentShift && currentShift.dateISO === dateISO ? currentShift.id : undefined
    );

    const hasExistingWorkingAssignment =
      currentAssignment &&
      (!isManualShiftAssignment(currentAssignment) || currentAssignment.shiftId !== currentShift?.id) &&
      (currentAssignment.kind === "STANDARD"
        ? currentAssignment.type === "MATTINA" || currentAssignment.type === "POMERIGGIO" || currentAssignment.type === "FULL"
        : blockingAvailability === null);

    if (hasExistingWorkingAssignment) {
      conflicts.push({
        field: "dateISO",
        dateISO,
        message: "Esiste già un turno pianificato per questa giornata."
      });
      return;
    }

    const validation = validateShiftPayload(
      { ...payload, dateISO, duplicateDates: [] },
      {
        currentShiftId: currentShift && currentShift.dateISO === dateISO ? currentShift.id : undefined,
        blockingAvailability,
        existingShifts
      }
    );

    validation.conflicts.forEach((conflict) => conflicts.push(conflict));
    validation.warnings.forEach((warning) => warnings.add(warning));
  });

  if (conflicts.length > 0) {
    return {
      ok: false,
      conflicts,
      warnings: [...warnings]
    };
  }

  const touchedShiftIds: string[] = [];
  const now = nowIso();

  targetDates.forEach((dateISO, index) => {
    const targetShiftId = currentShift && index === 0 ? currentShift.id : randomUUID();
    const createdAt = currentShift && index === 0 ? currentShift.createdAt : now;

    if (!nextMatrix[payload.employeeId]) {
      nextMatrix[payload.employeeId] = {};
    }

    nextMatrix[payload.employeeId][dateISO] = buildManualShiftAssignment({
      shiftId: targetShiftId,
      store: payload.store,
      startTime: payload.startTime,
      endTime: payload.endTime,
      breakMinutes: payload.withStandardBreak ? 60 : 0,
      note: payload.note,
      createdAt,
      updatedAt: now
    });

    touchedShiftIds.push(targetShiftId);
  });

  const updatedMonth = applyMonthMatrix(store, monthKey, nextMatrix, userName, currentShift ? "SHIFT_UPDATED" : "SHIFT_CREATED");
  await writeStore(store);

  return {
    ok: true,
    result: {
      items: allShiftsForMonth(store, monthKey).filter((shift) => touchedShiftIds.includes(shift.id)),
      version: updatedMonth.version,
      updatedAt: updatedMonth.updatedAt,
      warnings: [...warnings]
    }
  };
}

export async function deleteLocalShift(monthKey: string, shiftId: string, userName: string) {
  const store = await readStore();
  const month = ensureMonth(store, monthKey);
  const nextMatrix = cloneMatrix(month.assignments);
  let found = false;

  Object.entries(nextMatrix).forEach(([employeeId, byDate]) => {
    Object.entries(byDate ?? {}).forEach(([dateISO, assignment]) => {
      if (assignment && isManualShiftAssignment(assignment) && assignment.shiftId === shiftId) {
        nextMatrix[employeeId][dateISO] = null;
        found = true;
      }
    });
  });

  if (!found) {
    return null;
  }

  const updatedMonth = applyMonthMatrix(store, monthKey, nextMatrix, userName, "SHIFT_DELETED");
  await writeStore(store);

  return {
    ok: true as const,
    version: updatedMonth.version,
    updatedAt: updatedMonth.updatedAt
  };
}

export async function saveLocalSchedule(monthKey: string, expectedVersion: number, assignments: AssignmentMatrix, userName: string) {
  const store = await readStore();
  const month = ensureMonth(store, monthKey);

  if (month.version !== expectedVersion) {
    return {
      ok: false as const,
      currentVersion: month.version,
      currentUpdatedAt: month.updatedAt
    };
  }

  const next = sanitizeAssignments(assignments);
  applyMonthMatrix(store, monthKey, next, userName, "ASSIGNMENT_CHANGED");
  await writeStore(store);

  return {
    ok: true as const,
    version: ensureMonth(store, monthKey).version,
    updatedAt: ensureMonth(store, monthKey).updatedAt
  };
}

export async function publishLocalSchedule(monthKey: string, userName: string) {
  const store = await readStore();
  const month = ensureMonth(store, monthKey);
  const publishedAt = nowIso();

  month.versions.unshift({
    id: randomUUID(),
    versionNumber: month.version,
    createdAt: publishedAt,
    createdByName: userName,
    snapshot: cloneMatrix(month.assignments)
  });
  month.status = "PUBLISHED";
  month.publishedAt = publishedAt;
  month.version += 1;
  month.updatedAt = publishedAt;
  pushAudit(month, "SCHEDULE_PUBLISHED", userName, { monthKey, publishedVersion: month.version - 1 });

  await writeStore(store);
  return {
    status: month.status,
    version: month.version,
    publishedAt: month.publishedAt
  };
}

export async function listLocalVersions(monthKey: string): Promise<ScheduleVersionItem[]> {
  try {
    const store = await readStore();
    const month = ensureMonth(store, monthKey);

    return month.versions
      .slice()
      .sort((left, right) => right.versionNumber - left.versionNumber)
      .map((version) => ({
        id: version.id,
        versionNumber: version.versionNumber,
        createdAt: version.createdAt,
        createdByName: version.createdByName
      }));
  } catch (error) {
    console.error("listLocalVersions: fallback su cronologia vuota", error);
    return [];
  }
}

export async function restoreLocalVersion(versionId: string, userName: string) {
  const store = await readStore();
  const month = Object.values(store.months).find((currentMonth) => currentMonth.versions.some((version) => version.id === versionId));
  if (!month) return null;

  const version = month.versions.find((candidate) => candidate.id === versionId);
  if (!version) return null;

  applyMonthMatrix(store, month.monthKey, version.snapshot, userName, "SCHEDULE_RESTORED");
  await writeStore(store);
  return { version: ensureMonth(store, month.monthKey).version };
}

export async function listLocalAudit(monthKey: string, employeeId?: string) {
  const store = await readStore();
  const month = ensureMonth(store, monthKey);

  return month.auditLogs
    .filter((item) => !employeeId || item.payloadJson.employeeId === employeeId)
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((item) => ({
      id: item.id,
      action: item.action,
      createdAt: item.createdAt,
      userName: item.userName,
      payloadJson: item.payloadJson
    }));
}

export async function listLocalEmployees(includeInactive = true): Promise<Employee[]> {
  try {
    const store = await readStore();
    return allEmployees(store, includeInactive);
  } catch (error) {
    console.error("listLocalEmployees: fallback su personale vuoto", error);
    return [];
  }
}

export async function createLocalEmployee(fullName: string, homeStore: Store = "duomo") {
  const store = await readStore();
  const trimmed = fullName.trim();
  const now = nowIso();

  const existing = store.employees.find((employee) => employee.fullName.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    existing.fullName = trimmed;
    existing.active = true;
    existing.homeStore = homeStore;
    existing.updatedAt = now;
    await writeStore(store);
    return toPublicEmployee(existing);
  }

  const employee: StoredEmployee = {
    id: randomUUID(),
    fullName: trimmed,
    active: true,
    homeStore,
    availability: {},
    overrideStoreByDate: undefined,
    photoFileName: null,
    photoMimeType: null,
    photoVersion: Date.now(),
    createdAt: now,
    updatedAt: now
  };

  store.employees.push(employee);
  await writeStore(store);
  return toPublicEmployee(employee);
}

export async function updateLocalEmployee(
  id: string,
  data: {
    fullName?: string;
    active?: boolean;
    homeStore?: Store;
    availability?: Record<string, AvailabilityStatus>;
    overrideStoreByDate?: Record<string, Store>;
  }
) {
  const store = await readStore();
  const employee = store.employees.find((item) => item.id === id);
  if (!employee) {
    throw new Error("Dipendente non trovato");
  }

  if (typeof data.fullName === "string") {
    employee.fullName = data.fullName.trim() || employee.fullName;
  }

  if (typeof data.active === "boolean") {
    employee.active = data.active;
  }

  if (isStoreValue(data.homeStore)) {
    employee.homeStore = data.homeStore;
  }

  if (data.availability && typeof data.availability === "object") {
    employee.availability = normalizeAvailabilityRecord(data.availability);
  }

  if (data.overrideStoreByDate && typeof data.overrideStoreByDate === "object") {
    employee.overrideStoreByDate = normalizeOverrideStoreRecord(data.overrideStoreByDate);
  }

  if (data.overrideStoreByDate && Object.keys(data.overrideStoreByDate).length === 0) {
    employee.overrideStoreByDate = undefined;
  }

  employee.updatedAt = nowIso();
  await writeStore(store);
  return toPublicEmployee(employee);
}

export async function deleteLocalEmployee(id: string) {
  return updateLocalEmployee(id, { active: false });
}

export async function permanentlyDeleteLocalEmployee(id: string, userName = "Paradise") {
  const store = await readStore();
  const employee = store.employees.find((item) => item.id === id);
  if (!employee) {
    throw new Error("Dipendente non trovato");
  }

  const deletedAt = nowIso();

  await removePhotoVariants(id);

  store.employees = store.employees.filter((item) => item.id !== id);
  store.rules = store.rules.filter((rule) => rule.employeeId !== id);

  Object.values(store.months).forEach((month) => {
    let touched = false;

    if (month.assignments[id]) {
      delete month.assignments[id];
      touched = true;
    }

    month.versions = month.versions.map((version) => {
      if (!version.snapshot[id]) {
        return version;
      }

      touched = true;
      const nextSnapshot = cloneMatrix(version.snapshot);
      delete nextSnapshot[id];

      return {
        ...version,
        snapshot: nextSnapshot
      };
    });

    const nextAuditLogs = month.auditLogs.filter((item) => item.payloadJson.employeeId !== id);
    if (nextAuditLogs.length !== month.auditLogs.length) {
      touched = true;
      month.auditLogs = nextAuditLogs;
    }

    if (touched) {
      month.version += 1;
      month.updatedAt = deletedAt;
      pushAudit(month, "EMPLOYEE_DELETED", userName, {
        employeeId: id,
        employeeName: employee.fullName,
        deletedAt
      });
    }
  });

  store.updatedAt = deletedAt;
  await writeStore(store);

  return { ok: true as const, id, deletedAt };
}

export async function setLocalEmployeePhoto(id: string, buffer: Buffer, mimeType: string) {
  const store = await readStore();
  const employee = store.employees.find((item) => item.id === id);
  if (!employee) {
    throw new Error("Dipendente non trovato");
  }

  const saved = await writePhotoFile(id, buffer, mimeType);
  employee.photoFileName = saved.fileName;
  employee.photoMimeType = saved.mimeType;
  employee.photoVersion = Date.now();
  employee.updatedAt = nowIso();
  await writeStore(store);
  return toPublicEmployee(employee);
}

export async function removeLocalEmployeePhoto(id: string) {
  const store = await readStore();
  const employee = store.employees.find((item) => item.id === id);
  if (!employee) {
    throw new Error("Dipendente non trovato");
  }

  await removePhotoVariants(id);
  employee.photoFileName = null;
  employee.photoMimeType = null;
  employee.photoVersion = Date.now();
  employee.updatedAt = nowIso();
  await writeStore(store);
  return toPublicEmployee(employee);
}

export async function readLocalEmployeePhoto(id: string) {
  if (databaseEnabled()) {
    const photo = await prisma.employeePhoto.findUnique({ where: { employeeId: id } });
    if (!photo) {
      return null;
    }

    return {
      buffer: Buffer.from(photo.dataBase64, "base64"),
      mimeType: photo.mimeType
    };
  }

  const store = await readStore();
  const employee = store.employees.find((item) => item.id === id);
  if (!employee?.photoFileName) {
    return null;
  }

  try {
    const filePath = path.join(PHOTO_DIR, employee.photoFileName);
    const buffer = await fs.readFile(filePath);
    return {
      buffer,
      mimeType: employee.photoMimeType || mimeFromFileName(employee.photoFileName)
    };
  } catch {
    return null;
  }
}

export async function listLocalTemplates() {
  const store = await readStore();
  return activeTemplates(store);
}

export async function createLocalTemplate(data: {
  name: string;
  shortCode: string;
  availabilityStatus: AvailabilityStatus;
  startTime: string;
  endTime: string;
  unpaidBreakMinutes: number;
}) {
  const store = await readStore();
  const { template } = findOrCreateTemplate(
    store,
    data.name,
    data.shortCode,
    data.availabilityStatus,
    data.startTime,
    data.endTime,
    data.unpaidBreakMinutes
  );
  await writeStore(store);
  return toPublicTemplate(template);
}

export async function updateLocalTemplate(
  id: string,
  data: { name: string; shortCode: string; availabilityStatus: AvailabilityStatus; startTime: string; endTime: string; unpaidBreakMinutes: number },
  userName: string
) {
  const store = await readStore();
  const template = store.templates.find((item) => item.id === id && item.active);
  if (!template) {
    return null;
  }

  template.name = data.name.trim();
  template.shortCode = normalizeShortCode(data.shortCode, data.name);
  template.availabilityStatus = data.availabilityStatus;
  template.startTime = data.startTime;
  template.endTime = data.endTime;
  template.unpaidBreakMinutes = data.unpaidBreakMinutes;
  template.updatedAt = nowIso();

  Object.entries(store.months).forEach(([monthKey, month]) => {
    const nextMatrix = cloneMatrix(month.assignments);
    let changed = false;

    Object.values(nextMatrix).forEach((byDate) => {
      Object.keys(byDate ?? {}).forEach((dateISO) => {
        const assignment = byDate?.[dateISO] ?? null;
        if (!assignment || assignment.kind !== "CUSTOM" || isManualShiftAssignment(assignment)) {
          return;
        }

        if (assignment.templateId !== id) {
          return;
        }

        byDate[dateISO] = {
          ...assignment,
          name: template.name,
          shortCode: template.shortCode,
          availabilityStatus: template.availabilityStatus,
          startTime: template.startTime,
          endTime: template.endTime,
          unpaidBreakMinutes: template.unpaidBreakMinutes
        };
        changed = true;
      });
    });

    if (changed) {
      applyMonthMatrix(store, monthKey, nextMatrix, userName, "TEMPLATE_UPDATED");
    }
  });

  await writeStore(store);
  return toPublicTemplate(template);
}

export async function deleteLocalTemplate(id: string) {
  const store = await readStore();
  const template = store.templates.find((item) => item.id === id);
  if (template) {
    template.active = false;
    template.updatedAt = nowIso();
    await writeStore(store);
  }

  return { ok: true as const };
}

export async function listLocalRules() {
  const store = await readStore();
  return allRules(store);
}

export async function upsertLocalRule(data: {
  id?: string;
  employeeId: string;
  unavailableWeekdays: number[];
  unavailableDates: string[];
  forbiddenShiftIds: string[];
  preferredShiftId: ShiftId | null;
  mustWorkWeekdays: number[];
  avoidRestWithEmployeeIds: string[];
  note: string;
}) {
  const store = await readStore();
  const now = nowIso();
  const existing = store.rules.find((rule) => rule.employeeId === data.employeeId || rule.id === data.id);

  const payload = normalizeRule({
    id: existing?.id || data.id || randomUUID(),
    employeeId: data.employeeId,
    unavailableWeekdays: data.unavailableWeekdays,
    unavailableDates: data.unavailableDates,
    forbiddenShiftIds: data.forbiddenShiftIds,
    preferredShiftId: data.preferredShiftId,
    mustWorkWeekdays: data.mustWorkWeekdays,
    avoidRestWithEmployeeIds: data.avoidRestWithEmployeeIds,
    note: data.note,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  });

  if (existing) {
    Object.assign(existing, payload);
  } else {
    store.rules.push(payload);
  }

  await writeStore(store);
  return toPublicRule(payload);
}

export async function deleteLocalRule(id: string) {
  const store = await readStore();
  store.rules = store.rules.filter((rule) => rule.id !== id);
  await writeStore(store);
  return { ok: true as const };
}

export async function exportLocalMonth(monthKey: string): Promise<MonthExportPayload> {
  const schedule = await getLocalSchedule(monthKey);
  return {
    kind: "TURNISTICA_PARADISE_MONTH",
    exportedAt: nowIso(),
    monthKey,
    version: schedule.version,
    assignments: schedule.assignments
  };
}

export async function exportLocalBackup(): Promise<BackupFile> {
  const store = await readStore();
  const employees = await Promise.all(
    store.employees.map(async (employee) => ({
      id: employee.id,
      fullName: employee.fullName,
      active: employee.active,
      homeStore: employee.homeStore,
      availability: employee.availability,
      overrideStoreByDate: employee.overrideStoreByDate,
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
      photoDataUrl: await readEmployeePhotoDataUrl(employee)
    }))
  );

  return {
    kind: "TURNISTICA_PARADISE_BACKUP",
    version: 1,
    exportedAt: nowIso(),
    data: {
      employees,
      templates: store.templates,
      rules: store.rules,
      months: store.months
    }
  };
}

export async function importLocalMonth(payload: MonthExportPayload, userName: string): Promise<ImportSummary> {
  const store = await readStore();
  applyMonthMatrix(store, payload.monthKey, payload.assignments, userName, "SCHEDULE_IMPORTED");
  await writeStore(store);

  return {
    message: `Mese ${payload.monthKey} importato`,
    touchedMonths: [payload.monthKey],
    importedRows: monthDates(payload.monthKey).length,
    skippedRows: 0,
    createdTemplates: 0,
    replacedBackup: false
  };
}

export async function importLocalBackup(payload: BackupFile): Promise<ImportSummary> {
  const base = normalizeStore({
    employees: payload.data.employees.map((employee) =>
      normalizeEmployee({
        id: employee.id,
        fullName: employee.fullName,
        active: employee.active,
        homeStore: employee.homeStore,
        availability: employee.availability,
        overrideStoreByDate: employee.overrideStoreByDate,
        photoFileName: null,
        photoMimeType: null,
        photoVersion: Date.now(),
        createdAt: employee.createdAt,
        updatedAt: employee.updatedAt
      })
    ),
    templates: payload.data.templates,
    rules: payload.data.rules,
    months: payload.data.months
  });

  await ensureStorage();
  if (databaseEnabled()) {
    await prisma.employeePhoto.deleteMany();
  } else {
    await Promise.all((await fs.readdir(PHOTO_DIR).catch(() => [])).map((fileName) => fs.unlink(path.join(PHOTO_DIR, fileName)).catch(() => undefined)));
  }

  for (const backupEmployee of payload.data.employees) {
    const current = base.employees.find((employee) => employee.id === backupEmployee.id);
    const parsedPhoto = typeof backupEmployee.photoDataUrl === "string" ? parseDataUrl(backupEmployee.photoDataUrl) : null;
    if (!current || !parsedPhoto) continue;

    const saved = await writePhotoFile(current.id, parsedPhoto.buffer, parsedPhoto.mimeType);
    current.photoFileName = saved.fileName;
    current.photoMimeType = saved.mimeType;
    current.photoVersion = Date.now();
  }

  await writeStore(base);

  return {
    message: "Backup completo ripristinato",
    touchedMonths: Object.keys(base.months).sort(),
    importedRows: 0,
    skippedRows: 0,
    createdTemplates: 0,
    replacedBackup: true
  };
}

export async function importLocalCsv(text: string, userName: string): Promise<ImportSummary> {
  const rows = parseCsv(text);
  const store = await readStore();
  const employeeByName = new Map(store.employees.map((employee) => [employee.fullName.trim().toLowerCase(), employee.id]));
  const monthMatrices = new Map<string, AssignmentMatrix>();
  let importedRows = 0;
  let skippedRows = 0;
  let createdTemplates = 0;

  rows.forEach((row) => {
    const employeeName = (row.employee || row.fullName || "").trim().toLowerCase();
    const dateISO = (row.date || "").trim();
    const employeeId = employeeByName.get(employeeName);

    if (!employeeId || !DATE_ISO_REGEX.test(dateISO)) {
      skippedRows += 1;
      return;
    }

    const resolved = resolveImportedAssignment(store, row);
    if (!resolved) {
      skippedRows += 1;
      return;
    }

    if (resolved.createdTemplate) {
      createdTemplates += 1;
    }

    const monthKey = dateISO.slice(0, 7);
    const month = ensureMonth(store, monthKey);
    const currentMatrix = monthMatrices.get(monthKey) || cloneMatrix(month.assignments);
    if (!currentMatrix[employeeId]) {
      currentMatrix[employeeId] = {};
    }
    currentMatrix[employeeId][dateISO] = resolved.assignment;
    monthMatrices.set(monthKey, currentMatrix);
    importedRows += 1;
  });

  const touchedMonths = [...monthMatrices.keys()].sort();
  touchedMonths.forEach((monthKey) => {
    const matrix = monthMatrices.get(monthKey);
    if (!matrix) return;
    applyMonthMatrix(store, monthKey, matrix, userName, "SCHEDULE_IMPORTED");
  });

  await writeStore(store);

  return {
    message: touchedMonths.length > 0 ? `Import CSV completato su ${touchedMonths.length} mese/i` : "Nessuna riga valida trovata nel CSV",
    touchedMonths,
    importedRows,
    skippedRows,
    createdTemplates,
    replacedBackup: false
  };
}

export function isBackupFile(value: unknown): value is BackupFile {
  return Boolean(value && typeof value === "object" && (value as { kind?: string }).kind === "TURNISTICA_PARADISE_BACKUP");
}

export function isMonthExport(value: unknown): value is MonthExportPayload {
  return Boolean(value && typeof value === "object" && (value as { kind?: string }).kind === "TURNISTICA_PARADISE_MONTH");
}
