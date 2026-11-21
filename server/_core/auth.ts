import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import type { Context as HonoContext } from "hono";
import { db } from "./db";
import { users } from "../../drizzle/schema";
import { isUniqueViolation } from "./db-errors";
import { sessionCookie, signSession, verifySession } from "./session-cookie";
import type { SessionUser } from "../../shared/types";

export class AuthError extends Error {}
export class EmailTakenError extends AuthError {}

function toSessionUser(row: typeof users.$inferSelect): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role === "admin" ? "admin" : "user",
  };
}

/** Create a local (email + password) user. Throws EmailTakenError on a duplicate. */
export async function registerLocalUser(
  email: string,
  password: string,
  name?: string,
): Promise<SessionUser> {
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const [row] = await db
      .insert(users)
      .values({ email: email.toLowerCase().trim(), passwordHash, name: name?.trim() || null })
      .returning();
    return toSessionUser(row);
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new EmailTakenError("That email is already registered — try logging in instead.");
    }
    throw e;
  }
}

interface AuthProvider {
  login(c: HonoContext, email: string, password: string): Promise<SessionUser>;
  logout(c: HonoContext): Promise<void>;
  getSession(c: HonoContext): Promise<SessionUser | null>;
}

/** The local email/password provider. */
export function authProvider(): AuthProvider {
  return {
    async login(c, email, password) {
      const [row] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase().trim()))
        .limit(1);
      if (!row?.passwordHash) throw new AuthError("Incorrect email or password.");
      const ok = await bcrypt.compare(password, row.passwordHash);
      if (!ok) throw new AuthError("Incorrect email or password.");

      const token = await signSession(row.id);
      c.header(
        "set-cookie",
        `${sessionCookie.name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionCookie.maxAge}${
          sessionCookie.options.secure ? "; Secure" : ""
        }`,
      );
      return toSessionUser(row);
    },

    async logout(c) {
      c.header("set-cookie", `${sessionCookie.name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    },

    async getSession(c) {
      const raw = c.req.header("cookie") ?? "";
      const match = raw
        .split(";")
        .map((p) => p.trim())
        .find((p) => p.startsWith(`${sessionCookie.name}=`));
      if (!match) return null;
      const token = match.slice(sessionCookie.name.length + 1);
      const userId = await verifySession(token);
      if (!userId) return null;
      const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return row ? toSessionUser(row) : null;
    },
  };
}
