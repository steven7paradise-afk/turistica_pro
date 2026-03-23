import test from "node:test";
import assert from "node:assert/strict";
import type { Employee, ScheduleData, ShiftTemplate } from "@/app/turnistica/_lib/types";
import { interpretScheduleRequest } from "@/lib/scheduling-assistant";

function employee(fullName: string, id: string): Employee {
  return {
    id,
    fullName,
    active: true,
    photoUrl: null,
    homeStore: "duomo",
    availability: {},
    createdAt: "2026-03-20T08:00:00.000Z",
    updatedAt: "2026-03-20T08:00:00.000Z"
  };
}

function template(name: string, id: string): ShiftTemplate {
  return {
    id,
    name,
    shortCode: name.slice(0, 2).toUpperCase(),
    availabilityStatus: "lavoro",
    startTime: "09:00",
    endTime: "18:00",
    unpaidBreakMinutes: 60,
    createdAt: "2026-03-20T08:00:00.000Z",
    updatedAt: "2026-03-20T08:00:00.000Z"
  };
}

function schedule(overrides: Partial<ScheduleData> = {}): ScheduleData {
  const employees = overrides.employees ?? [employee("Gaia", "gaia"), employee("Simona", "simona"), employee("Laura", "laura")];
  return {
    monthKey: "2026-03",
    status: "DRAFT",
    version: 1,
    updatedAt: "2026-03-20T08:00:00.000Z",
    publishedAt: null,
    assignments: {},
    employees,
    templates: [template("Apertura", "apertura")],
    rules: [],
    ...overrides
  };
}

test("interpreta ferie + turno dall'esempio", () => {
  const currentSchedule = schedule();
  const result = interpretScheduleRequest({
    request: "Dal 24 al 26 marzo Gaia è in ferie. Metti Simona in Apertura al Duomo il 24",
    currentSchedule,
    employees: currentSchedule.employees,
    stores: ["Duomo", "Corso Buenos Aires"],
    shiftTypes: ["Apertura", "ferie", "permesso", "malattia", "riposo"],
    memory: [],
    rules: [],
    currentDateISO: "2026-03-23"
  });

  assert.equal(result.warnings.length, 0);
  assert.equal(result.actions.length, 2);
  assert.deepEqual(result.actions[0], {
    action: "assign_leave",
    employee: "Gaia",
    date_from: "2026-03-24",
    date_to: "2026-03-26",
    leave_type: "ferie"
  });
  assert.deepEqual(result.actions[1], {
    action: "assign_shift",
    employee: "Simona",
    store: "Duomo",
    date: "2026-03-24",
    shift: "Apertura"
  });
});

test("salva memoria quando la preferenza è chiara", () => {
  const currentSchedule = schedule();
  const result = interpretScheduleRequest({
    request: "Laura non lavora il sabato",
    currentSchedule,
    employees: currentSchedule.employees,
    stores: ["Duomo", "Corso Buenos Aires"],
    shiftTypes: ["Apertura"],
    memory: [],
    rules: [],
    currentDateISO: "2026-03-23"
  });

  assert.equal(result.actions.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.memory_updates, [
    {
      type: "preference",
      employee: "Laura",
      content: "Non lavora il sabato"
    }
  ]);
});

test("avvisa se manca il negozio", () => {
  const currentSchedule = schedule();
  const result = interpretScheduleRequest({
    request: "Metti Simona in Apertura il 24 marzo",
    currentSchedule,
    employees: currentSchedule.employees,
    stores: ["Duomo", "Corso Buenos Aires"],
    shiftTypes: ["Apertura"],
    memory: [],
    rules: [],
    currentDateISO: "2026-03-23"
  });

  assert.equal(result.actions.length, 0);
  assert.ok(result.warnings.some((warning) => warning.includes("manca il negozio")));
});

test("blocca un turno se esiste già un turno nello stesso giorno", () => {
  const currentSchedule = schedule({
    assignments: {
      simona: {
        "2026-03-24": {
          kind: "CUSTOM",
          templateId: "apertura",
          name: "Apertura",
          shortCode: "AP",
          availabilityStatus: "lavoro",
          startTime: "09:00",
          endTime: "18:00",
          unpaidBreakMinutes: 60
        }
      }
    }
  });

  const result = interpretScheduleRequest({
    request: "Metti Simona in Apertura al Duomo il 24 marzo",
    currentSchedule,
    employees: currentSchedule.employees,
    stores: ["Duomo", "Corso Buenos Aires"],
    shiftTypes: ["Apertura"],
    memory: [],
    rules: [],
    currentDateISO: "2026-03-23"
  });

  assert.equal(result.actions.length, 0);
  assert.ok(result.warnings.some((warning) => warning.includes("ha già un turno")));
});
