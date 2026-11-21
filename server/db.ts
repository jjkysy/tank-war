// ── AGENT-OWNED: business data-access ───────────────────────────────────────
// Every query is owner-scoped by userId. Routers stay thin and call these.
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./_core/db";
import { feedback, patches, profiles, rounds, tuning } from "../drizzle/schema";
import {
  DEFAULT_TUNING,
  clampTuning,
  rankForXp,
  xpForRound,
  type RoundResult,
  type TuningConfig,
  type TuningPatch,
} from "../shared/tank";

// ── profiles ────────────────────────────────────────────────────────────────

export async function getProfile(userId: string) {
  const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return row ?? null;
}

/** Create the profile on first touch. Idempotent: a second call returns the row. */
export async function ensureProfile(userId: string, fallbackCallsign: string) {
  const existing = await getProfile(userId);
  if (existing) return existing;
  const [row] = await db
    .insert(profiles)
    .values({ userId, callsign: fallbackCallsign.slice(0, 24) || "Commander" })
    .onConflictDoNothing({ target: profiles.userId })
    .returning();
  if (row) return row;
  // Lost the race — the other insert won, read it back.
  const again = await getProfile(userId);
  if (!again) throw new Error("could not create profile");
  return again;
}

export async function updateCallsign(userId: string, callsign: string) {
  const [row] = await db
    .update(profiles)
    .set({ callsign: callsign.slice(0, 24) })
    .where(eq(profiles.userId, userId))
    .returning();
  return row ?? null;
}

/** Top players by XP. Public data only — never email or feedback text. */
export async function leaderboard(limit = 20) {
  return db
    .select({
      callsign: profiles.callsign,
      rank: profiles.rank,
      xp: profiles.xp,
      bestScore: profiles.bestScore,
      roundsPlayed: profiles.roundsPlayed,
    })
    .from(profiles)
    .orderBy(desc(profiles.xp), desc(profiles.bestScore))
    .limit(limit);
}

// ── tuning ──────────────────────────────────────────────────────────────────

export async function getTuning(userId: string) {
  const [row] = await db.select().from(tuning).where(eq(tuning.userId, userId)).limit(1);
  if (row) return { config: clampTuning(row.config as TuningConfig), version: row.version };
  const [created] = await db
    .insert(tuning)
    .values({ userId, config: DEFAULT_TUNING, version: 1 })
    .onConflictDoNothing({ target: tuning.userId })
    .returning();
  if (created) return { config: clampTuning(created.config as TuningConfig), version: created.version };
  const [again] = await db.select().from(tuning).where(eq(tuning.userId, userId)).limit(1);
  return { config: clampTuning((again?.config as TuningConfig) ?? DEFAULT_TUNING), version: again?.version ?? 1 };
}

export async function saveTuning(userId: string, config: TuningConfig) {
  const clean = clampTuning(config);
  const [row] = await db
    .update(tuning)
    .set({ config: clean, version: sql`${tuning.version} + 1`, updatedAt: new Date() })
    .where(eq(tuning.userId, userId))
    .returning();
  if (row) return { config: clampTuning(row.config as TuningConfig), version: row.version };
  const [created] = await db
    .insert(tuning)
    .values({ userId, config: clean, version: 1 })
    .onConflictDoNothing({ target: tuning.userId })
    .returning();
  if (created) return { config: clampTuning(created.config as TuningConfig), version: created.version };
  return getTuning(userId);
}

// ── rounds ──────────────────────────────────────────────────────────────────

export async function listRounds(userId: string, limit = 30) {
  return db
    .select()
    .from(rounds)
    .where(eq(rounds.userId, userId))
    .orderBy(desc(rounds.createdAt))
    .limit(limit);
}

/**
 * Record a finished round and award XP. The profile update is a single SQL
 * statement with arithmetic in SET, so concurrent rounds cannot lose an
 * increment.
 */
export async function recordRound(userId: string, result: RoundResult) {
  const [row] = await db
    .insert(rounds)
    .values({
      userId,
      score: Math.max(0, Math.round(result.score)),
      kills: Math.max(0, Math.round(result.kills)),
      wave: Math.max(1, Math.round(result.wave)),
      survivedSeconds: Math.max(0, Math.round(result.survivedSeconds)),
      outcome: result.outcome === "cleared" ? "cleared" : "destroyed",
      tuningSnapshot: clampTuning(result.tuningSnapshot),
    })
    .returning();

  const gained = xpForRound(result);
  const [profile] = await db
    .update(profiles)
    .set({
      xp: sql`${profiles.xp} + ${gained}`,
      roundsPlayed: sql`${profiles.roundsPlayed} + 1`,
      bestScore: sql`greatest(${profiles.bestScore}, ${Math.max(0, Math.round(result.score))})`,
    })
    .where(eq(profiles.userId, userId))
    .returning();

  // Rank is derived from the new XP total; write it back so the leaderboard
  // query stays a single indexed read.
  let finalProfile = profile ?? null;
  if (profile) {
    const rank = rankForXp(profile.xp);
    if (rank !== profile.rank) {
      const [updated] = await db
        .update(profiles)
        .set({ rank })
        .where(eq(profiles.userId, userId))
        .returning();
      finalProfile = updated ?? profile;
    }
  }

  return { round: row, xpGained: gained, profile: finalProfile };
}

// ── feedback + patches ──────────────────────────────────────────────────────

export async function listFeedback(userId: string, limit = 40) {
  return db
    .select()
    .from(feedback)
    .where(eq(feedback.userId, userId))
    .orderBy(desc(feedback.createdAt))
    .limit(limit);
}

export async function addFeedback(input: {
  userId: string;
  roundId?: string | null;
  role: "player" | "supervisor";
  body: string;
  patch?: TuningPatch | null;
}) {
  const [row] = await db
    .insert(feedback)
    .values({
      userId: input.userId,
      roundId: input.roundId ?? null,
      role: input.role,
      body: input.body.slice(0, 2000),
      patch: input.patch ?? null,
    })
    .returning();
  return row;
}

export async function listPatches(userId: string, limit = 40) {
  return db
    .select()
    .from(patches)
    .where(eq(patches.userId, userId))
    .orderBy(desc(patches.createdAt))
    .limit(limit);
}

export async function addPatch(input: {
  userId: string;
  source: "llm" | "heuristic";
  summary: string;
  diff: TuningPatch;
}) {
  const [row] = await db
    .insert(patches)
    .values({
      userId: input.userId,
      source: input.source,
      summary: input.summary.slice(0, 1000),
      diff: input.diff,
    })
    .returning();
  return row;
}

/** Recent rounds for the supervisor's context window. */
export async function recentRoundSummary(userId: string, limit = 5) {
  return db
    .select({
      score: rounds.score,
      kills: rounds.kills,
      wave: rounds.wave,
      outcome: rounds.outcome,
      survivedSeconds: rounds.survivedSeconds,
    })
    .from(rounds)
    .where(eq(rounds.userId, userId))
    .orderBy(desc(rounds.createdAt))
    .limit(limit);
}

export async function deleteRound(id: string, userId: string) {
  await db.delete(rounds).where(and(eq(rounds.id, id), eq(rounds.userId, userId)));
  return { ok: true };
}
