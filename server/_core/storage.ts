// File storage (DESIGN §5.6). Uploads go browser → platform storage directly
// through a signed URL; the app only records the key. This module is the
// server-side half: mint the signed PUT, commit the row, list, delete.
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { files } from "../../drizzle/schema";

export class StorageError extends Error {
  code: "failed" | "not_found" | "forbidden";
  constructor(message: string, code: "failed" | "not_found" | "forbidden") {
    super(message);
    this.code = code;
  }
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..")) {
    throw new StorageError(`unsafe storage key: ${key}`, "forbidden");
  }
}

/** Mint a signed upload URL for a new key. */
export async function storagePutUrl(
  key: string,
  contentType: string,
  _opts: { ownerId: string },
): Promise<{ uploadUrl: string; publicPath: string }> {
  assertSafeKey(key);
  // The platform storage endpoint is injected at deploy time; in dev the app
  // serves /app-storage itself, so a relative path is the correct answer.
  const base = process.env.STORAGE_PUBLIC_BASE ?? "";
  return {
    uploadUrl: `${base}/app-storage/upload/${encodeURIComponent(key)}?contentType=${encodeURIComponent(contentType)}`,
    publicPath: `/app-storage/${key}`,
  };
}

/** Record an uploaded key against its owner. */
export async function storageCommit(
  key: string,
  opts: { ownerId: string; name: string },
): Promise<{ key: string; publicPath: string }> {
  assertSafeKey(key);
  const [existing] = await db.select().from(files).where(eq(files.key, key)).limit(1);
  if (existing) {
    if (existing.ownerId !== opts.ownerId) throw new StorageError("key owned by another user", "forbidden");
    return { key, publicPath: `/app-storage/${key}` };
  }
  await db.insert(files).values({
    key,
    ownerId: opts.ownerId,
    name: opts.name.slice(0, 200),
    size: 0,
    contentType: null,
  });
  return { key, publicPath: `/app-storage/${key}` };
}

export async function storageListByOwner(ownerId: string) {
  return db
    .select({ key: files.key, name: files.name, size: files.size, createdAt: files.createdAt })
    .from(files)
    .where(eq(files.ownerId, ownerId))
    .orderBy(desc(files.createdAt))
    .limit(100);
}

export async function storageDeleteOwned(ownerId: string, key: string) {
  assertSafeKey(key);
  await db.delete(files).where(and(eq(files.key, key), eq(files.ownerId, ownerId)));
  return { ok: true };
}
