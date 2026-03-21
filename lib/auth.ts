import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SessionUser } from "@/app/turnistica/_lib/types";

const COOKIE_NAME = "turnistica_paradise_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SIMPLE_PIN = process.env.SIMPLE_PIN || "190326";
const LOGIN_DISABLED = process.env.PARADISE_DISABLE_LOGIN !== "0";
const SESSION_SECRET =
  process.env.PARADISE_SESSION_SECRET || process.env.NEXTAUTH_SECRET || "turnistica-paradise-local-session-secret";

const SESSION_USER: SessionUser = {
  id: "local-admin",
  name: "Paradise",
  role: "ADMIN"
};

type SessionPayload = SessionUser & {
  exp: number;
};

function sign(data: string): string {
  return createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function encode(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data)}`;
}

function decode(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [data, signature] = token.split(".");

  if (!data || !signature || !safeCompare(sign(data), signature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as SessionPayload;
    if (!payload?.exp || payload.exp <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // L'app gira in LAN locale via http://IP-DEL-PC:3001, quindi il cookie
    // non deve richiedere HTTPS oppure il PIN non sblocca davvero la sessione.
    secure: false,
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  };
}

export function validatePin(pin: string): boolean {
  if (LOGIN_DISABLED) {
    return true;
  }

  return pin.trim() === SIMPLE_PIN;
}

export function createLoginResponse() {
  const response = NextResponse.json({ ok: true, user: SESSION_USER });
  const payload: SessionPayload = {
    ...SESSION_USER,
    exp: Date.now() + SESSION_TTL_SECONDS * 1000
  };

  response.cookies.set(COOKIE_NAME, encode(payload), sessionCookieOptions());
  return response;
}

export function createLogoutResponse() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, "", {
    ...sessionCookieOptions(),
    expires: new Date(0),
    maxAge: 0
  });
  return response;
}

export async function getAppSession(): Promise<{ user: SessionUser } | null> {
  if (LOGIN_DISABLED) {
    return { user: SESSION_USER };
  }

  const token = cookies().get(COOKIE_NAME)?.value;
  const payload = decode(token);
  if (!payload) {
    return null;
  }

  return {
    user: {
      id: payload.id,
      name: payload.name,
      role: payload.role
    }
  };
}

export function isLoginDisabled(): boolean {
  return LOGIN_DISABLED;
}
