import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const users = [
  { name: "Admin Paradise", email: "admin@paradise.it", role: "ADMIN" },
  { name: "Manager Paradise", email: "manager@paradise.it", role: "MANAGER" },
  { name: "Staff Paradise", email: "staff@paradise.it", role: "STAFF" }
] as const;

const employees = [
  "Giulia Rossi",
  "Sofia Bianchi",
  "Martina Verdi",
  "Elena Ferri",
  "Alice Neri",
  "Beatrice Sala"
];

const templates = [
  { name: "Apertura", startTime: "08:30", endTime: "13:30" },
  { name: "Serale", startTime: "13:30", endTime: "20:30" }
];

async function main() {
  const passwordHash = await bcrypt.hash("Paradise!2026", 10);

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { passwordHash, role: user.role, active: true, name: user.name },
      create: { email: user.email, name: user.name, role: user.role, passwordHash, active: true }
    });
  }

  for (const fullName of employees) {
    await prisma.employee.upsert({
      where: { fullName },
      update: { active: true },
      create: { fullName, active: true }
    });
  }

  for (const template of templates) {
    await prisma.shiftTemplate.upsert({
      where: { name: template.name },
      update: template,
      create: template
    });
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
