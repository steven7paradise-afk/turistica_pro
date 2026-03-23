import { spawn } from "child_process";

function firstEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) {
      return value;
    }
  }

  return "";
}

function setFallbackEnv() {
  const pooled = firstEnv(
    "DATABASE_URL",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL",
    "SUPABASE_DATABASE_URL",
    "NETLIFY_DATABASE_URL"
  );
  const unpooled = firstEnv(
    "DIRECT_URL",
    "POSTGRES_URL_NON_POOLING",
    "SUPABASE_DIRECT_URL",
    "NETLIFY_DATABASE_URL_UNPOOLED"
  );

  if (!process.env.DATABASE_URL && pooled) {
    process.env.DATABASE_URL = pooled;
  }

  if (!process.env.DATABASE_URL && unpooled) {
    process.env.DATABASE_URL = unpooled;
  }

  if (!process.env.DIRECT_URL && unpooled) {
    process.env.DIRECT_URL = unpooled;
  }

  if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
    process.env.DIRECT_URL = process.env.DATABASE_URL;
  }
}

async function run(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      env: process.env
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`));
    });

    child.on("error", reject);
  });
}

async function main() {
  setFallbackEnv();

  if (process.env.DATABASE_URL || process.env.DIRECT_URL) {
    await run("npx", ["prisma", "generate"]);
    await run("npx", ["prisma", "db", "push", "--skip-generate"]);
    await run("npx", ["tsx", "scripts/bootstrap-database.ts"]);
  }

  await run("npx", ["next", "build"]);
}

main().catch((error) => {
  console.error("build-app:", error);
  process.exit(1);
});
