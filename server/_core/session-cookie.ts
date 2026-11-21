import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";
import { sessionCookieName } from "../../shared/constants";

// Session cookie: a signed JWT holding the user id. HttpOnly + SameSite=Lax so
// it is not readable from JS and is not sent on cross-site POSTs.
const COOKIE = sessionCookieName(env.appSlug);
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function key(): Uint8Array {
  return new TextEncoder().encode(env.jwtSecret);
}

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(key());
}

export async function verifySession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export const sessionCookie = {
  name: COOKIE,
  maxAge: MAX_AGE,
  options: {
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: env.isProduction,
    path: "/",
    maxAge: MAX_AGE,
  },
};
