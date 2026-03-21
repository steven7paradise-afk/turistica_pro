import { promises as fs } from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

type ParsedEmployee = {
  id?: string;
  photoFileName?: string | null;
  photoMimeType?: string | null;
};

const APP_STATE_KEY = "primary";
const STORE_FILE = path.join(process.cwd(), ".local-data", "turnistica.json");
const PHOTO_DIR = path.join(process.cwd(), ".local-data", "employee-photos");

function mimeFromFileName(fileName: string): string {
  const ext = path.extname(fileName).replace(".", "").toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "application/octet-stream";
}

async function main() {
  if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
    console.log("bootstrap-database: DATABASE_URL/DIRECT_URL non impostati, skip.");
    return;
  }

  const force = process.env.PARADISE_FORCE_BOOTSTRAP === "1";
  const existing = await prisma.appState.findUnique({ where: { key: APP_STATE_KEY } });

  if (existing && !force) {
    console.log("bootstrap-database: database gia inizializzato, skip.");
    return;
  }

  const raw = await fs.readFile(STORE_FILE, "utf8").catch(() => "");
  if (!raw.trim()) {
    console.log("bootstrap-database: nessun file .local-data/turnistica.json trovato, skip.");
    return;
  }

  const parsed = JSON.parse(raw);
  const stateJson = JSON.parse(JSON.stringify(parsed)) as Prisma.InputJsonValue;

  await prisma.appState.upsert({
    where: { key: APP_STATE_KEY },
    update: { stateJson },
    create: {
      key: APP_STATE_KEY,
      stateJson
    }
  });

  await prisma.employeePhoto.deleteMany();

  const employees = Array.isArray((parsed as { employees?: ParsedEmployee[] }).employees)
    ? ((parsed as { employees?: ParsedEmployee[] }).employees ?? [])
    : [];

  for (const employee of employees) {
    if (!employee.id || !employee.photoFileName) continue;

    const photoPath = path.join(PHOTO_DIR, employee.photoFileName);
    const buffer = await fs.readFile(photoPath).catch(() => null);
    if (!buffer) continue;

    await prisma.employeePhoto.upsert({
      where: { employeeId: employee.id },
      update: {
        mimeType: employee.photoMimeType || mimeFromFileName(employee.photoFileName),
        dataBase64: buffer.toString("base64")
      },
      create: {
        employeeId: employee.id,
        mimeType: employee.photoMimeType || mimeFromFileName(employee.photoFileName),
        dataBase64: buffer.toString("base64")
      }
    });
  }

  console.log(`bootstrap-database: stato importato nel database con ${employees.length} dipendenti.`);
}

main()
  .catch((error) => {
    console.error("bootstrap-database: errore", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
