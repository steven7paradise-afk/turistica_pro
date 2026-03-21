import test from "node:test";
import assert from "node:assert/strict";
import { calculateWorkedHours, findShiftOverlap, validateShiftPayload } from "@/lib/shifts";
import type { ShiftRecord, ShiftWritePayload } from "@/app/turnistica/_lib/types";

function payload(overrides: Partial<ShiftWritePayload> = {}): ShiftWritePayload {
  return {
    employeeId: "employee-1",
    store: "duomo",
    dateISO: "2026-03-20",
    startTime: "09:00",
    endTime: "18:00",
    withStandardBreak: true,
    note: null,
    duplicateDates: [],
    ...overrides
  };
}

function shift(overrides: Partial<ShiftRecord> = {}): ShiftRecord {
  return {
    id: "shift-1",
    employeeId: "employee-1",
    store: "duomo",
    dateISO: "2026-03-20",
    startTime: "09:00",
    endTime: "13:00",
    breakMinutes: 0,
    note: null,
    createdAt: "2026-03-20T08:00:00.000Z",
    updatedAt: "2026-03-20T08:00:00.000Z",
    workedHours: 4,
    ...overrides
  };
}

test("calculateWorkedHours sottrae la pausa standard", () => {
  assert.equal(calculateWorkedHours("09:00", "18:00", 60), 8);
});

test("validateShiftPayload blocca fine precedente all'inizio", () => {
  const result = validateShiftPayload(payload({ startTime: "18:00", endTime: "09:00" }));
  assert.equal(result.ok, false);
  assert.match(result.conflicts[0]?.message ?? "", /fine/i);
});

test("validateShiftPayload blocca disponibilita incompatibile", () => {
  const result = validateShiftPayload(payload(), {
    blockingAvailability: "riposo"
  });

  assert.equal(result.ok, false);
  assert.ok(result.conflicts.some((item) => item.field === "dateISO"));
});

test("validateShiftPayload avvisa sui turni lunghi senza pausa", () => {
  const result = validateShiftPayload(payload({ withStandardBreak: false }));
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((item) => item.includes("pausa")));
});

test("findShiftOverlap rileva turni sovrapposti", () => {
  const result = findShiftOverlap(
    {
      employeeId: "employee-1",
      dateISO: "2026-03-20",
      startTime: "12:00",
      endTime: "17:00"
    },
    [shift()]
  );

  assert.ok(result);
  assert.equal(result?.id, "shift-1");
});

test("findShiftOverlap ignora turni di altri giorni o dipendenti", () => {
  const result = findShiftOverlap(
    {
      employeeId: "employee-1",
      dateISO: "2026-03-21",
      startTime: "12:00",
      endTime: "17:00"
    },
    [
      shift(),
      shift({
        id: "shift-2",
        employeeId: "employee-2",
        dateISO: "2026-03-21"
      })
    ]
  );

  assert.equal(result, null);
});
