import {
  AuditItem,
  AvailabilityStatus,
  Employee,
  EmployeeRule,
  ImportSummary,
  ScheduleData,
  ScheduleVersionItem,
  ShiftConflictItem,
  ShiftId,
  ShiftMutationResult,
  ShiftRecord,
  ShiftTemplate,
  ShiftWritePayload,
  Store
} from "@/app/turnistica/_lib/types";

async function parse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let payload: { error?: string } | null = null;

  try {
    payload = raw ? (JSON.parse(raw) as { error?: string }) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Errore API (${response.status})`);
  }

  if (!raw) {
    throw new Error("Risposta API vuota");
  }

  return (payload as T) ?? (JSON.parse(raw) as T);
}

export class ShiftApiError extends Error {
  conflicts: ShiftConflictItem[];
  warnings: string[];

  constructor(message: string, payload?: { conflicts?: ShiftConflictItem[]; warnings?: string[] }) {
    super(message);
    this.name = "ShiftApiError";
    this.conflicts = payload?.conflicts ?? [];
    this.warnings = payload?.warnings ?? [];
  }
}

async function parseShiftMutation(response: Response): Promise<ShiftMutationResult> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Errore turno" }));
    throw new ShiftApiError(error.error || "Errore turno", {
      conflicts: error.conflicts,
      warnings: error.warnings
    });
  }

  return (await response.json()) as ShiftMutationResult;
}

export async function getSchedule(monthKey: string) {
  const response = await fetch(`/api/schedule?month=${monthKey}`, { cache: "no-store" });
  return parse<ScheduleData>(response);
}

export async function putSchedule(monthKey: string, expectedVersion: number, assignments: ScheduleData["assignments"]) {
  const response = await fetch(`/api/schedule?month=${monthKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedVersion, assignments })
  });

  if (response.status === 409) {
    const payload = await response.json().catch(() => ({ error: "Conflitto" }));
    throw new Error(payload.error || "CONFLICT");
  }

  return parse<{ version: number; updatedAt: string }>(response);
}

export async function publishSchedule(monthKey: string) {
  const response = await fetch(`/api/schedule/publish?month=${monthKey}`, { method: "POST" });
  return parse<{ status: string; version: number }>(response);
}

export async function getVersions(monthKey: string) {
  const response = await fetch(`/api/schedule/versions?month=${monthKey}`, { cache: "no-store" });
  return parse<ScheduleVersionItem[]>(response);
}

export async function restoreVersion(versionId: string) {
  const response = await fetch("/api/schedule/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ versionId })
  });
  return parse<{ version: number }>(response);
}

export async function getTemplates() {
  return parse<ShiftTemplate[]>(await fetch("/api/templates", { cache: "no-store" }));
}

export async function createTemplate(payload: {
  name: string;
  shortCode: string;
  availabilityStatus: AvailabilityStatus;
  startTime: string;
  endTime: string;
  unpaidBreakMinutes: number;
}) {
  return parse<ShiftTemplate>(
    await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function updateTemplate(id: string, payload: {
  name: string;
  shortCode: string;
  availabilityStatus: AvailabilityStatus;
  startTime: string;
  endTime: string;
  unpaidBreakMinutes: number;
}) {
  return parse<ShiftTemplate>(
    await fetch(`/api/templates?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function deleteTemplate(id: string) {
  return parse<{ ok: true }>(await fetch(`/api/templates?id=${id}`, { method: "DELETE" }));
}

export async function getRules() {
  return parse<EmployeeRule[]>(await fetch("/api/rules", { cache: "no-store" }));
}

type UpsertRulePayload = {
  id?: string;
  employeeId: string;
  unavailableWeekdays: number[];
  unavailableDates: string[];
  forbiddenShiftIds: string[];
  preferredShiftId: ShiftId | null;
  note: string;
};

export async function upsertRule(payload: UpsertRulePayload) {
  return parse<EmployeeRule>(
    await fetch("/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function deleteRule(id: string) {
  return parse<{ ok: true }>(await fetch(`/api/rules?id=${id}`, { method: "DELETE" }));
}

export async function getAudit(month: string, employeeId?: string) {
  const query = employeeId ? `month=${month}&employeeId=${employeeId}` : `month=${month}`;
  return parse<AuditItem[]>(await fetch(`/api/audit?${query}`, { cache: "no-store" }));
}

export async function getEmployees() {
  return parse<Employee[]>(await fetch("/api/employees?includeInactive=1", { cache: "no-store" }));
}

export async function createEmployee(payload: { fullName: string; homeStore?: Store }) {
  return parse<Employee>(
    await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function updateEmployee(payload: {
  id: string;
  fullName?: string;
  active?: boolean;
  homeStore?: Store;
  availability?: Record<string, AvailabilityStatus>;
  overrideStoreByDate?: Record<string, Store>;
}) {
  return parse<Employee>(
    await fetch("/api/employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function uploadEmployeePhoto(employeeId: string, file: File) {
  const formData = new FormData();
  formData.set("employeeId", employeeId);
  formData.set("file", file);

  return parse<Employee>(
    await fetch("/api/employees/photo", {
      method: "POST",
      body: formData
    })
  );
}

export async function removeEmployeePhoto(employeeId: string) {
  return parse<Employee>(await fetch(`/api/employees/photo?employeeId=${employeeId}`, { method: "DELETE" }));
}

export async function deleteEmployee(id: string) {
  return parse<Employee>(await fetch(`/api/employees?id=${id}`, { method: "DELETE" }));
}

export async function permanentlyDeleteEmployee(id: string) {
  return parse<{ ok: true; id: string; deletedAt: string }>(await fetch(`/api/employees?id=${id}&permanent=1`, { method: "DELETE" }));
}

export async function importFile(file: File) {
  const formData = new FormData();
  formData.set("file", file);

  return parse<ImportSummary>(
    await fetch("/api/import", {
      method: "POST",
      body: formData
    })
  );
}

export async function getShifts(monthKey: string, filters: { employeeId?: string; store?: Store; from?: string; to?: string } = {}) {
  const params = new URLSearchParams({ month: monthKey });
  if (filters.employeeId) params.set("employeeId", filters.employeeId);
  if (filters.store) params.set("store", filters.store);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);

  return parse<ShiftRecord[]>(await fetch(`/api/shifts?${params.toString()}`, { cache: "no-store" }));
}

export async function createShift(monthKey: string, payload: ShiftWritePayload) {
  return parseShiftMutation(
    await fetch(`/api/shifts?month=${monthKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function updateShift(monthKey: string, shiftId: string, payload: ShiftWritePayload) {
  return parseShiftMutation(
    await fetch(`/api/shifts/${shiftId}?month=${monthKey}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  );
}

export async function deleteShift(monthKey: string, shiftId: string) {
  return parse<{ ok: true; version: number; updatedAt: string }>(
    await fetch(`/api/shifts/${shiftId}?month=${monthKey}`, {
      method: "DELETE"
    })
  );
}
