import "dotenv/config";

// Central env access. Secrets are injected by the platform at runtime; nothing
// here is ever committed. `secret()` throws when a required key is missing so a
// misconfigured deploy fails loudly instead of silently degrading.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
  get jwtSecret(): string {
    return required("SESSION_SECRET");
  },
  get appSlug(): string {
    return process.env.APP_SLUG ?? "app";
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
  /** A required secret. Throws when unset. */
  secret(name: string): string {
    return required(name);
  },
  /** An optional config value with a default. */
  config(name: string, fallback: string): string {
    return process.env[name] ?? fallback;
  },
};
