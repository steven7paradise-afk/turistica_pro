import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ShiftAssignment } from "@/app/turnistica/_lib/types";

export type AssignmentMatrix = Record<string, Record<string, ShiftAssignment>>;

export async function ensureMonth(monthKey: string) {
  return prisma.scheduleMonth.upsert({
    where: { monthKey },
    update: {},
    create: { monthKey }
  });
}

export async function loadMonthMatrix(scheduleMonthId: string): Promise<AssignmentMatrix> {
  const assignments = await prisma.scheduleAssignment.findMany({ where: { scheduleMonthId } });
  const matrix: AssignmentMatrix = {};

  for (const item of assignments) {
    if (!matrix[item.employeeId]) matrix[item.employeeId] = {};
    matrix[item.employeeId][item.dateISO] = item.assignmentJson as ShiftAssignment;
  }

  return matrix;
}

type TxLike = Pick<typeof prisma, "scheduleAssignment">;

export async function saveMatrix(scheduleMonthId: string, matrix: AssignmentMatrix, txClient?: TxLike) {
  const tx = txClient ?? prisma;
  await tx.scheduleAssignment.deleteMany({ where: { scheduleMonthId } });

  const creates: Array<Promise<unknown>> = [];
  for (const [employeeId, byDate] of Object.entries(matrix)) {
    for (const [dateISO, assignment] of Object.entries(byDate)) {
      creates.push(
        tx.scheduleAssignment.create({
          data: {
            scheduleMonthId,
            employeeId,
            dateISO,
            assignmentJson: assignment === null ? Prisma.JsonNull : (assignment as Prisma.InputJsonValue)
          }
        })
      );
    }
  }

  if (creates.length > 0) {
    await Promise.all(creates);
  }
}
