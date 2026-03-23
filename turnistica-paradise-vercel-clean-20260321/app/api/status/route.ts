import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { shouldUseLocalData } from "@/lib/local-data";

export const dynamic = "force-dynamic";

function bool(value: unknown) {
  return Boolean(value);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Errore sconosciuto";
}

export async function GET() {
  const storageMode = shouldUseLocalData() ? "local" : "database";
  const env = {
    databaseUrl: bool(
      process.env.DATABASE_URL ||
        process.env.POSTGRES_PRISMA_URL ||
        process.env.POSTGRES_URL ||
        process.env.SUPABASE_DATABASE_URL
    ),
    directUrl: bool(
      process.env.DIRECT_URL ||
        process.env.POSTGRES_URL_NON_POOLING ||
        process.env.SUPABASE_DIRECT_URL
    ),
    storageMode: process.env.PARADISE_STORAGE_MODE || ""
  };

  if (storageMode === "local") {
    return NextResponse.json({
      ok: true,
      storageMode,
      env,
      database: {
        reachable: false,
        appStateReadable: false
      }
    });
  }

  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    const appStateCount = await prisma.appState.count();

    return NextResponse.json({
      ok: true,
      storageMode,
      env,
      database: {
        reachable: true,
        appStateReadable: true,
        appStateCount
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        storageMode,
        env,
        database: {
          reachable: false,
          appStateReadable: false,
          error: errorMessage(error)
        }
      },
      { status: 500 }
    );
  }
}
