import type {
  AvailabilityStatus,
  Employee,
  EmployeeRule,
  ScheduleAssistantAction,
  ScheduleAssistantMemoryUpdate,
  ScheduleAssistantResponse,
  ScheduleData,
  ShiftAssignment,
  ShiftTemplate
} from "@/app/turnistica/_lib/types";
import { assignmentLabel, getAvailabilityStatusForDate, getEffectiveAssignmentForDate, parseISODate, shiftIdFromAssignment, toISODate } from "@/app/turnistica/_lib/utils";

type DateContext = {
  month: number;
  year: number;
};

type AssistantContext = {
  request: string;
  currentSchedule: ScheduleData;
  employees: Employee[];
  stores: string[];
  shiftTypes: string[];
  memory: ScheduleAssistantMemoryUpdate[];
  rules?: EmployeeRule[];
  currentDateISO?: string;
};

type EmployeeAlias = {
  alias: string;
  employee: Employee;
};

type DerivedMemoryRule = {
  blockedWeekdays: number[];
  preferredShiftNames: string[];
};

const MONTHS: Record<string, number> = {
  gennaio: 1,
  january: 1,
  febbrario: 2,
  febbraio: 2,
  february: 2,
  marzo: 3,
  march: 3,
  aprile: 4,
  april: 4,
  maggio: 5,
  may: 5,
  giugno: 6,
  june: 6,
  luglio: 7,
  july: 7,
  agosto: 8,
  august: 8,
  settembre: 9,
  september: 9,
  ottobre: 10,
  october: 10,
  novembre: 11,
  november: 11,
  dicembre: 12,
  december: 12
};

const WEEKDAYS: Record<string, number> = {
  domenica: 0,
  sunday: 0,
  lunedi: 1,
  lunedì: 1,
  monday: 1,
  martedi: 2,
  martedì: 2,
  tuesday: 2,
  mercoledi: 3,
  mercoledì: 3,
  wednesday: 3,
  giovedi: 4,
  giovedì: 4,
  thursday: 4,
  venerdi: 5,
  venerdì: 5,
  friday: 5,
  sabato: 6,
  saturday: 6
};

const LEAVE_KEYWORDS = ["ferie", "permesso", "malattia", "riposo", "vacation", "permit", "sick", "rest"] as const;

function stripAccents(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "");
}

function normalize(value: string) {
  return stripAccents(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPattern(value: string) {
  return escapeRegex(value.trim()).replace(/\s+/g, "\\s+");
}

function formatISO(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(dateISO: string, amount: number) {
  const date = parseISODate(dateISO);
  date.setDate(date.getDate() + amount);
  return toISODate(date);
}

function eachDate(fromISO: string, toISO: string) {
  const dates: string[] = [];
  let cursor = fromISO;

  while (cursor <= toISO) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function availabilityBlocksWork(status: AvailabilityStatus | null) {
  return status === "riposo" || status === "malattia" || status === "permesso" || status === "non_lavorato";
}

function canonicalLeaveType(raw: string) {
  const normalized = normalize(raw);
  if (normalized.includes("vacation") || normalized.includes("ferie")) return "ferie";
  if (normalized.includes("permit") || normalized.includes("permesso")) return "permesso";
  if (normalized.includes("sick") || normalized.includes("malattia")) return "malattia";
  return "riposo";
}

function isLeaveShift(value: string) {
  const normalized = normalize(value);
  return LEAVE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function buildEmployeeAliases(employees: Employee[]): EmployeeAlias[] {
  const firstNameCounts = new Map<string, number>();

  employees.forEach((employee) => {
    const firstName = normalize(employee.fullName.split(/\s+/)[0] ?? "");
    if (firstName) {
      firstNameCounts.set(firstName, (firstNameCounts.get(firstName) ?? 0) + 1);
    }
  });

  const aliases: EmployeeAlias[] = [];
  employees.forEach((employee) => {
    aliases.push({ alias: employee.fullName, employee });
    const firstName = employee.fullName.split(/\s+/)[0] ?? "";
    if ((firstNameCounts.get(normalize(firstName)) ?? 0) === 1) {
      aliases.push({ alias: firstName, employee });
    }
  });

  return aliases.sort((left, right) => right.alias.length - left.alias.length);
}

function findEmployeeByText(value: string, aliases: EmployeeAlias[]) {
  const normalizedValue = normalize(value);
  return aliases.find((alias) => normalize(alias.alias) === normalizedValue)?.employee ?? null;
}

function buildStoreAliases(stores: string[]) {
  return stores.flatMap((store) => {
    const normalized = normalize(store);
    if (normalized.includes("duomo")) {
      return [
        { alias: "duomo", store },
        { alias: store, store }
      ];
    }

    if (normalized.includes("buenos")) {
      return [
        { alias: "corso buenos aires", store },
        { alias: "buenos aires", store },
        { alias: "corso", store },
        { alias: store, store }
      ];
    }

    return [{ alias: store, store }];
  });
}

function buildShiftAliases(shiftTypes: string[]) {
  return shiftTypes
    .filter((shift) => !isLeaveShift(shift))
    .map((shift) => ({ alias: shift, shift }))
    .sort((left, right) => right.alias.length - left.alias.length);
}

function parseDateToken(token: string, fallback: DateContext | null, currentYear: number): string | null {
  const clean = token.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean;
  }

  const slashMatch = clean.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const year = slashMatch[3] ? Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3]) : currentYear;
    return formatISO(year, month, day);
  }

  const dayMonthMatch = clean.match(/^(\d{1,2})(?:\s+([a-zA-ZÀ-ÿ]+))(?:\s+(\d{4}))?$/);
  if (dayMonthMatch) {
    const day = Number(dayMonthMatch[1]);
    const month = MONTHS[normalize(dayMonthMatch[2] ?? "")];
    const year = dayMonthMatch[3] ? Number(dayMonthMatch[3]) : currentYear;
    if (month) {
      return formatISO(year, month, day);
    }
  }

  const onlyDayMatch = clean.match(/^(\d{1,2})$/);
  if (onlyDayMatch && fallback) {
    return formatISO(fallback.year, fallback.month, Number(onlyDayMatch[1]));
  }

  return null;
}

function parseRangeText(value: string, currentYear: number) {
  const match = normalize(value).match(/(?:dal|from)\s+(\d{1,2})(?:\s+([a-z]+))?(?:\s+(\d{4}))?\s+(?:al|to)\s+(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/i);
  if (!match) return null;

  const fromDay = Number(match[1]);
  const fromMonth = MONTHS[match[2] ?? match[5]];
  const fromYear = match[3] ? Number(match[3]) : match[6] ? Number(match[6]) : currentYear;
  const toDay = Number(match[4]);
  const toMonth = MONTHS[match[5]];
  const toYear = match[6] ? Number(match[6]) : fromYear;

  if (!fromMonth || !toMonth) return null;

  return {
    fromISO: formatISO(fromYear, fromMonth, fromDay),
    toISO: formatISO(toYear, toMonth, toDay),
    context: { month: toMonth, year: toYear }
  };
}

function deriveMemoryRules(employee: Employee, memory: ScheduleAssistantMemoryUpdate[]) {
  const derived: DerivedMemoryRule = {
    blockedWeekdays: [],
    preferredShiftNames: []
  };

  memory
    .filter((entry) => normalize(entry.employee) === normalize(employee.fullName))
    .forEach((entry) => {
      const normalizedContent = normalize(entry.content);
      const weekdayMatch = normalizedContent.match(/non lavora il ([a-z]+)/i);
      if (weekdayMatch) {
        const weekday = WEEKDAYS[weekdayMatch[1]];
        if (weekday !== undefined && !derived.blockedWeekdays.includes(weekday)) {
          derived.blockedWeekdays.push(weekday);
        }
      }

      const preferredMatch = normalizedContent.match(/preferisce ([a-z0-9 _-]+)/i);
      if (preferredMatch) {
        derived.preferredShiftNames.push(preferredMatch[1].trim());
      }
    });

  return derived;
}

function findExistingAssignment(schedule: ScheduleData, employeeId: string, dateISO: string) {
  return schedule.assignments[employeeId]?.[dateISO] ?? null;
}

function buildReply(actions: ScheduleAssistantAction[], warnings: string[], memoryUpdates: ScheduleAssistantMemoryUpdate[]) {
  if (actions.length === 0 && memoryUpdates.length === 0) {
    return warnings.length > 0 ? "Ho trovato dei punti da chiarire o dei conflitti." : "Richiesta poco chiara, dimmi meglio cosa vuoi fare.";
  }

  if (actions.length > 0 && memoryUpdates.length > 0) {
    return "Ho interpretato azioni e preferenze richieste.";
  }

  if (actions.length > 0) {
    return "Ho interpretato le modifiche richieste.";
  }

  return "Ho salvato la preferenza richiesta.";
}

export function interpretScheduleRequest(input: AssistantContext): ScheduleAssistantResponse {
  const request = input.request.trim();
  if (!request) {
    return {
      reply: "Richiesta vuota, scrivi cosa vuoi fare.",
      actions: [],
      warnings: [],
      memory_updates: []
    };
  }

  const currentDateISO = input.currentDateISO ?? toISODate(new Date());
  const currentYear = Number(currentDateISO.slice(0, 4));
  const employeeAliases = buildEmployeeAliases(input.employees);
  const employeePattern = employeeAliases.map((alias) => aliasPattern(alias.alias)).join("|");
  const shiftAliases = buildShiftAliases(input.shiftTypes);
  const shiftPattern = shiftAliases.map((alias) => aliasPattern(alias.alias)).join("|");
  const storeAliases = buildStoreAliases(input.stores);
  const storePattern = storeAliases.map((alias) => aliasPattern(alias.alias)).join("|");
  const leavePattern = "ferie|permesso|malattia|riposo|vacation|permit|sick|rest";
  const datePattern = "\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?|\\d{1,2}(?:\\s+[A-Za-zÀ-ÿ]+(?:\\s+\\d{4})?)?";

  const actions: ScheduleAssistantAction[] = [];
  const warnings: string[] = [];
  const memoryUpdates: ScheduleAssistantMemoryUpdate[] = [];
  const rulesByEmployee = new Map((input.rules ?? input.currentSchedule.rules).map((rule) => [rule.employeeId, rule]));
  const pending = new Map<string, ScheduleAssistantAction>();

  let lastDateContext: DateContext | null = null;

  const clauses = request
    .split(/[.;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  clauses.forEach((clause) => {
    let handled = false;

    if (employeePattern) {
      const nonWorkingMatch = clause.match(new RegExp(`(?<employee>${employeePattern})\\s+non\\s+lavora\\s+il\\s+(?<weekday>[A-Za-zÀ-ÿ]+)`, "i"));
      if (nonWorkingMatch?.groups?.employee && nonWorkingMatch.groups.weekday) {
        const employee = findEmployeeByText(nonWorkingMatch.groups.employee, employeeAliases);
        const weekdayLabel = nonWorkingMatch.groups.weekday.trim();
        if (employee && WEEKDAYS[normalize(weekdayLabel)] !== undefined) {
          memoryUpdates.push({
            type: "preference",
            employee: employee.fullName,
            content: `Non lavora il ${weekdayLabel}`
          });
        }
        handled = true;
      }

      const preferredShiftMatch = !handled && shiftPattern
        ? clause.match(new RegExp(`(?<employee>${employeePattern})\\s+preferisce\\s+(?<shift>${shiftPattern})`, "i"))
        : null;

      if (preferredShiftMatch?.groups?.employee && preferredShiftMatch.groups.shift) {
        const employee = findEmployeeByText(preferredShiftMatch.groups.employee, employeeAliases);
        if (employee) {
          memoryUpdates.push({
            type: "preference",
            employee: employee.fullName,
            content: `Preferisce ${preferredShiftMatch.groups.shift.trim()}`
          });
        }
        handled = true;
      }
    }

    if (!handled && employeePattern) {
      const leaveRangePatterns = [
        new RegExp(
          `(?<employee>${employeePattern})\\s+(?:(?:e|è)\\s+)?(?:in\\s+)?(?<leave>${leavePattern})\\s+(?<range>(?:dal|from)\\s+\\d{1,2}(?:\\s+[A-Za-zÀ-ÿ]+)?(?:\\s+\\d{4})?\\s+(?:al|to)\\s+\\d{1,2}\\s+[A-Za-zÀ-ÿ]+(?:\\s+\\d{4})?)`,
          "i"
        ),
        new RegExp(
          `(?<range>(?:dal|from)\\s+\\d{1,2}(?:\\s+[A-Za-zÀ-ÿ]+)?(?:\\s+\\d{4})?\\s+(?:al|to)\\s+\\d{1,2}\\s+[A-Za-zÀ-ÿ]+(?:\\s+\\d{4})?)\\s+(?<employee>${employeePattern})\\s+(?:(?:e|è)\\s+)?(?:in\\s+)?(?<leave>${leavePattern})`,
          "i"
        )
      ];

      for (const pattern of leaveRangePatterns) {
        const match = clause.match(pattern);
        const groups = match?.groups;
        if (!groups?.employee || !groups.leave || !groups.range) {
          continue;
        }

        const employee = findEmployeeByText(groups.employee, employeeAliases);
        const range = parseRangeText(groups.range, currentYear);

        if (!employee || !range) {
          warnings.push(`Non riesco a capire bene ferie o intervallo per: "${clause}".`);
          handled = true;
          break;
        }

        lastDateContext = range.context;
        const leaveType = canonicalLeaveType(groups.leave);
        const employeeRule = rulesByEmployee.get(employee.id);
        const derivedMemory = deriveMemoryRules(employee, input.memory);
        const touchedDates = eachDate(range.fromISO, range.toISO);

        const conflict = touchedDates.find((dateISO) => {
          const weekday = parseISODate(dateISO).getDay();
          const pendingAction = pending.get(`${employee.id}:${dateISO}`);
          if (pendingAction) return true;
          if (leaveType === "riposo" && employeeRule?.mustWorkWeekdays.includes(weekday)) return true;
          if (derivedMemory.blockedWeekdays.includes(weekday) && leaveType !== "riposo") return false;
          if (leaveType === "riposo") {
            const pairIds = employeeRule?.avoidRestWithEmployeeIds ?? [];
            return pairIds.some((coworkerId) => {
              const coworker = input.employees.find((item) => item.id === coworkerId);
              if (!coworker) return false;
              const coworkerStatus = getAvailabilityStatusForDate(
                coworker,
                dateISO,
                getEffectiveAssignmentForDate(coworker, dateISO, findExistingAssignment(input.currentSchedule, coworker.id, dateISO))
              );
              return coworkerStatus === "riposo";
            });
          }
          return false;
        });

        if (conflict) {
          warnings.push(`Non posso applicare ${leaveType} per ${employee.fullName}: c'è un conflitto nel periodo richiesto.`);
          handled = true;
          break;
        }

        const action: ScheduleAssistantAction = {
          action: "assign_leave",
          employee: employee.fullName,
          date_from: range.fromISO,
          date_to: range.toISO,
          leave_type: leaveType
        };

        actions.push(action);
        touchedDates.forEach((dateISO) => pending.set(`${employee.id}:${dateISO}`, action));
        handled = true;
        break;
      }
    }

    if (!handled && employeePattern) {
      const singleLeaveMatch = clause.match(
        new RegExp(`(?:metti|segna|set|put)?\\s*(?<employee>${employeePattern})\\s+(?:(?:e|è)\\s+)?(?:in\\s+)?(?<leave>${leavePattern})(?:\\s+(?:il|on))?\\s+(?<dateText>${datePattern})`, "i")
      );

      const leaveGroups = singleLeaveMatch?.groups;
      if (leaveGroups?.employee && leaveGroups.leave && leaveGroups.dateText) {
        const employee = findEmployeeByText(leaveGroups.employee, employeeAliases);
        const dateISO = parseDateToken(leaveGroups.dateText, lastDateContext, currentYear);

        if (!employee || !dateISO) {
          warnings.push(`Non riesco a capire bene data o persona per: "${clause}".`);
          handled = true;
        } else {
          lastDateContext = { month: Number(dateISO.slice(5, 7)), year: Number(dateISO.slice(0, 4)) };
          const leaveType = canonicalLeaveType(leaveGroups.leave);
          const employeeRule = rulesByEmployee.get(employee.id);
          const weekday = parseISODate(dateISO).getDay();
          const currentStatus = getAvailabilityStatusForDate(
            employee,
            dateISO,
            getEffectiveAssignmentForDate(employee, dateISO, findExistingAssignment(input.currentSchedule, employee.id, dateISO))
          );

          if (pending.has(`${employee.id}:${dateISO}`)) {
            warnings.push(`Esiste già un'altra azione per ${employee.fullName} il ${dateISO}.`);
          } else if (leaveType === "riposo" && employeeRule?.mustWorkWeekdays.includes(weekday)) {
            warnings.push(`${employee.fullName} non può andare in riposo in questo giorno.`);
          } else if (leaveType === "riposo" && (employeeRule?.avoidRestWithEmployeeIds ?? []).some((coworkerId) => {
            const coworker = input.employees.find((item) => item.id === coworkerId);
            if (!coworker) return false;
            const coworkerStatus = getAvailabilityStatusForDate(
              coworker,
              dateISO,
              getEffectiveAssignmentForDate(coworker, dateISO, findExistingAssignment(input.currentSchedule, coworker.id, dateISO))
            );
            return coworkerStatus === "riposo";
          })) {
            warnings.push(`${employee.fullName} non può riposare insieme alla collega indicata in questo giorno.`);
          } else {
            const action: ScheduleAssistantAction = {
              action: "assign_leave",
              employee: employee.fullName,
              date: dateISO,
              leave_type: leaveType
            };

            if (availabilityBlocksWork(currentStatus) && currentStatus === leaveType) {
              warnings.push(`${employee.fullName} risulta già in ${leaveType} il ${dateISO}.`);
            } else {
              actions.push(action);
              pending.set(`${employee.id}:${dateISO}`, action);
            }
          }
          handled = true;
        }
      }
    }

    if (!handled && employeePattern && shiftPattern && storePattern) {
      const shiftMatch = clause.match(
        new RegExp(
          `(?:metti|assegna|set|put)\\s+(?<employee>${employeePattern})\\s+(?:in|su|to)?\\s*(?<shift>${shiftPattern})\\s+(?:al|a|nel|in|at)\\s+(?<store>${storePattern})(?:\\s+(?:il|on))?\\s*(?<dateText>${datePattern})`,
          "i"
        )
      );

      const shiftGroups = shiftMatch?.groups;
      if (shiftGroups?.employee && shiftGroups.shift) {
        const employee = findEmployeeByText(shiftGroups.employee, employeeAliases);
        const store = storeAliases.find((item) => normalize(item.alias) === normalize(shiftGroups.store ?? ""))?.store ?? null;
        const shift = shiftAliases.find((item) => normalize(item.alias) === normalize(shiftGroups.shift))?.shift ?? null;
        const dateISO = parseDateToken(shiftGroups.dateText ?? "", lastDateContext, currentYear);

        if (!employee || !store || !shift || !dateISO) {
          warnings.push(`Non riesco a capire bene turno, negozio o data per: "${clause}".`);
          handled = true;
        } else {
          lastDateContext = { month: Number(dateISO.slice(5, 7)), year: Number(dateISO.slice(0, 4)) };
          const existingAssignment = getEffectiveAssignmentForDate(employee, dateISO, findExistingAssignment(input.currentSchedule, employee.id, dateISO));
          const currentStatus = getAvailabilityStatusForDate(employee, dateISO, existingAssignment);
          const weekday = parseISODate(dateISO).getDay();
          const memoryRule = deriveMemoryRules(employee, input.memory);
          const employeeRule = rulesByEmployee.get(employee.id);
          const shiftId = input.currentSchedule.templates.find((template) => normalize(template.name) === normalize(shift))?.id ?? null;

          if (pending.has(`${employee.id}:${dateISO}`)) {
            warnings.push(`Esiste già un'altra azione per ${employee.fullName} il ${dateISO}.`);
          } else if (existingAssignment) {
            warnings.push(`${employee.fullName} ha già un turno il ${dateISO}: ${assignmentLabel(existingAssignment)}.`);
          } else if (availabilityBlocksWork(currentStatus)) {
            warnings.push(`${employee.fullName} risulta ${currentStatus?.replaceAll("_", " ")} il ${dateISO}.`);
          } else if (memoryRule.blockedWeekdays.includes(weekday)) {
            warnings.push(`${employee.fullName} ha una preferenza salvata: non lavora di ${Object.keys(WEEKDAYS).find((key) => WEEKDAYS[key] === weekday && key.length > 3) ?? "quel giorno"}.`);
          } else if (memoryRule.preferredShiftNames.length > 0 && !memoryRule.preferredShiftNames.some((value) => normalize(value) === normalize(shift))) {
            warnings.push(`${employee.fullName} preferisce un altro turno secondo la memoria salvata.`);
          } else if (shiftId && employeeRule?.forbiddenShiftIds.includes(`CUSTOM:${shiftId}`)) {
            warnings.push(`${shift} è vietato per ${employee.fullName}.`);
          } else {
            const action: ScheduleAssistantAction = {
              action: "assign_shift",
              employee: employee.fullName,
              store,
              date: dateISO,
              shift
            };
            actions.push(action);
            pending.set(`${employee.id}:${dateISO}`, action);
          }
          handled = true;
        }
      }
    }

    if (!handled && employeePattern) {
      const removeMatch = clause.match(
        new RegExp(`(?:togli|leva|rimuovi|cancella|remove|delete)\\s+(?:il\\s+turno\\s+(?:a|di)\\s+)?(?<employee>${employeePattern})(?:.*?(?:il|on)\\s*(?<dateText>${datePattern}))?`, "i")
      );

      const removeGroups = removeMatch?.groups;
      if (removeGroups?.employee) {
        const employee = findEmployeeByText(removeGroups.employee, employeeAliases);
        const dateISO = parseDateToken(removeGroups.dateText ?? "", lastDateContext, currentYear);

        if (!employee || !dateISO) {
          warnings.push(`Mi serve la data precisa per rimuovere il turno in: "${clause}".`);
          handled = true;
        } else {
          lastDateContext = { month: Number(dateISO.slice(5, 7)), year: Number(dateISO.slice(0, 4)) };
          const existingAssignment = getEffectiveAssignmentForDate(employee, dateISO, findExistingAssignment(input.currentSchedule, employee.id, dateISO));

          if (!existingAssignment && !pending.has(`${employee.id}:${dateISO}`)) {
            warnings.push(`${employee.fullName} non ha un turno da rimuovere il ${dateISO}.`);
          } else {
            const action: ScheduleAssistantAction = {
              action: "remove_shift",
              employee: employee.fullName,
              date: dateISO
            };
            actions.push(action);
            pending.set(`${employee.id}:${dateISO}`, action);
          }
          handled = true;
        }
      }
    }

    if (!handled) {
      const needsStore = /apertura|chiusura|turno|shift|assegna|metti/i.test(clause) && input.stores.length > 1 && !new RegExp(storePattern, "i").test(clause);
      if (needsStore) {
        warnings.push(`Richiesta incompleta: manca il negozio in "${clause}".`);
      } else {
        warnings.push(`Non ho interpretato con sicurezza: "${clause}".`);
      }
    }
  });

  return {
    reply: buildReply(actions, warnings, memoryUpdates),
    actions,
    warnings,
    memory_updates: memoryUpdates
  };
}

export function buildAssistantMemoryFromRules(schedule: ScheduleData): ScheduleAssistantMemoryUpdate[] {
  const byEmployee = new Map(schedule.employees.map((employee) => [employee.id, employee.fullName]));
  const memory: ScheduleAssistantMemoryUpdate[] = [];

  schedule.rules.forEach((rule) => {
    const employeeName = byEmployee.get(rule.employeeId);
    if (!employeeName) return;

    rule.unavailableWeekdays.forEach((weekday) => {
      const weekdayLabel = Object.entries(WEEKDAYS).find((entry) => entry[1] === weekday && entry[0].length > 3)?.[0];
      if (weekdayLabel) {
        memory.push({
          type: "preference",
          employee: employeeName,
          content: `Non lavora il ${weekdayLabel}`
        });
      }
    });

    if (rule.preferredShiftId) {
      const template = schedule.templates.find((item) => shiftIdFromAssignment({ kind: "CUSTOM", templateId: item.id, name: item.name, startTime: item.startTime, endTime: item.endTime, unpaidBreakMinutes: item.unpaidBreakMinutes }) === rule.preferredShiftId);
      if (template) {
        memory.push({
          type: "preference",
          employee: employeeName,
          content: `Preferisce ${template.name}`
        });
      }
    }
  });

  return memory;
}
