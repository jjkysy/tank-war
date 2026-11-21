// ── AGENT-OWNED: tRPC API surface ───────────────────────────────────────────
// Thin procedures: validate with zod, call server/db.ts for data and
// server/services/* for the supervisor. Auth comes from _core.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { authProvider, registerLocalUser, AuthError, EmailTakenError } from "./_core/auth";
import { storageCommit, storageDeleteOwned, storageListByOwner, storagePutUrl, StorageError } from "./_core/storage";
import * as q from "./db";
import { runSupervisor, describePatch } from "./services/supervisor";
import { VIEW_MODES, clampTuning, rankProgress, type TuningConfig } from "../shared/tank";

// ── auth ────────────────────────────────────────────────────────────────────
const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ctx.user),

  signup: publicProcedure
    .input(z.object({ email: z.email(), password: z.string().min(8), name: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const user = await registerLocalUser(input.email, input.password, input.name);
        await authProvider().login(ctx.c, input.email, input.password); // set session cookie
        // Give the new player a profile straight away so the leaderboard and
        // the game both have a callsign to work with.
        await q.ensureProfile(user.id, input.name || input.email.split("@")[0]);
        return user;
      } catch (e: unknown) {
        if (e instanceof EmailTakenError) throw new TRPCError({ code: "CONFLICT", message: e.message });
        throw e;
      }
    }),

  login: publicProcedure
    .input(z.object({ email: z.email(), password: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const user = await authProvider().login(ctx.c, input.email, input.password);
        await q.ensureProfile(user.id, user.name || user.email.split("@")[0]);
        return user;
      } catch (e) {
        if (e instanceof AuthError) throw new TRPCError({ code: "UNAUTHORIZED", message: e.message });
        throw e;
      }
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    await authProvider().logout(ctx.c);
    return { ok: true };
  }),
});

// ── player profile + rank ───────────────────────────────────────────────────
const playerRouter = router({
  /** Own profile, created on first read. */
  me: protectedProcedure.query(async ({ ctx }) => {
    const profile = await q.ensureProfile(ctx.user.id, ctx.user.name || ctx.user.email.split("@")[0]);
    return { ...profile, progress: rankProgress(profile.xp) };
  }),

  setCallsign: protectedProcedure
    .input(z.object({ callsign: z.string().min(2).max(24) }))
    .mutation(async ({ ctx, input }) => {
      await q.ensureProfile(ctx.user.id, ctx.user.name || "Commander");
      const row = await q.updateCallsign(ctx.user.id, input.callsign.trim());
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found." });
      return { ...row, progress: rankProgress(row.xp) };
    }),

  /** Public leaderboard — callsign, rank, XP, best score only. */
  leaderboard: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
    .query(({ input }) => q.leaderboard(input?.limit ?? 20)),

  /** Own round history. */
  rounds: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(({ ctx, input }) => q.listRounds(ctx.user.id, input?.limit ?? 30)),

  /** Own patch history — what the supervisor changed and why. */
  patches: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(({ ctx, input }) => q.listPatches(ctx.user.id, input?.limit ?? 30)),

  /** Own supervisor conversation. */
  feedback: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(({ ctx, input }) => q.listFeedback(ctx.user.id, input?.limit ?? 40)),
});

// ── tuning ──────────────────────────────────────────────────────────────────
const tuningRouter = router({
  get: protectedProcedure.query(({ ctx }) => q.getTuning(ctx.user.id)),

  /** Manual override from the panel — same bounds as a supervisor patch. */
  set: protectedProcedure
    .input(
      z.object({
        enemyCount: z.number().optional(),
        enemySpeed: z.number().optional(),
        enemyFireRate: z.number().optional(),
        enemyAccuracy: z.number().optional(),
        playerSpeed: z.number().optional(),
        playerFireRate: z.number().optional(),
        arenaSize: z.number().optional(),
        viewMode: z.enum(VIEW_MODES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const current = await q.getTuning(ctx.user.id);
      const next = clampTuning({ ...current.config, ...input } as TuningConfig);
      return q.saveTuning(ctx.user.id, next);
    }),

  reset: protectedProcedure.mutation(async ({ ctx }) => {
    const { DEFAULT_TUNING } = await import("../shared/tank");
    return q.saveTuning(ctx.user.id, DEFAULT_TUNING);
  }),
});

// ── rounds ──────────────────────────────────────────────────────────────────
const roundsRouter = router({
  /** Record a finished round and award XP. */
  record: protectedProcedure
    .input(
      z.object({
        score: z.number().min(0).max(1_000_000),
        kills: z.number().min(0).max(10_000),
        wave: z.number().min(1).max(1000),
        survivedSeconds: z.number().min(0).max(86_400),
        outcome: z.enum(["destroyed", "cleared"]),
        tuningSnapshot: z.object({
          enemyCount: z.number(),
          enemySpeed: z.number(),
          enemyFireRate: z.number(),
          enemyAccuracy: z.number(),
          playerSpeed: z.number(),
          playerFireRate: z.number(),
          arenaSize: z.number(),
          viewMode: z.enum(VIEW_MODES),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await q.ensureProfile(ctx.user.id, ctx.user.name || "Commander");
      const out = await q.recordRound(ctx.user.id, input);
      return {
        roundId: out.round?.id ?? null,
        xpGained: out.xpGained,
        profile: out.profile ? { ...out.profile, progress: rankProgress(out.profile.xp) } : null,
      };
    }),
});

// ── supervisor ──────────────────────────────────────────────────────────────
const supervisorRouter = router({
  /**
   * The supervised loop. Takes the player's feedback, runs the supervisor
   * (LLM when LLM_API_KEY is set, otherwise the heuristic agent), applies the
   * bounded patch to the caller's own tuning, and returns the reply + diff.
   */
  ask: protectedProcedure
    .input(
      z.object({
        feedback: z.string().min(1).max(1000),
        roundId: z.uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await q.ensureProfile(ctx.user.id, ctx.user.name || "Commander");
      const current = await q.getTuning(ctx.user.id);
      const recentRounds = await q.recentRoundSummary(ctx.user.id, 5);

      const result = await runSupervisor({
        feedback: input.feedback,
        config: current.config,
        recentRounds,
      });

      // Persist the player's message and the supervisor's reply.
      await q.addFeedback({
        userId: ctx.user.id,
        roundId: input.roundId ?? null,
        role: "player",
        body: input.feedback,
      });
      await q.addFeedback({
        userId: ctx.user.id,
        roundId: input.roundId ?? null,
        role: "supervisor",
        body: result.message,
        patch: result.patch,
      });

      const changed = Object.keys(result.patch).length > 0;
      let version = current.version;
      if (changed) {
        const saved = await q.saveTuning(ctx.user.id, result.config);
        version = saved.version;
        await q.addPatch({
          userId: ctx.user.id,
          source: result.source,
          summary: `${result.message} (${describePatch(result.patch)})`,
          diff: result.patch,
        });
      }

      return {
        source: result.source,
        message: result.message,
        patch: result.patch,
        config: result.config,
        version,
        changed,
        fallbackReason: result.fallbackReason ?? null,
      };
    }),

  /** Whether an LLM key is configured — the panel says which mode it is in. */
  status: protectedProcedure.query(() => {
    let configured = false;
    try {
      configured = Boolean(process.env.LLM_API_KEY);
    } catch {
      configured = false;
    }
    return { llmConfigured: configured };
  }),
});

// ── files (kept from the scaffold) ──────────────────────────────────────────
export function sanitizeBasename(name: string): string {
  const last = name.split(/[/\\]/).pop() ?? "";
  const dot = last.lastIndexOf(".");
  const rawStem = dot > 0 ? last.slice(0, dot) : last;
  const rawExt = dot > 0 ? last.slice(dot + 1) : "";
  const stem = rawStem.replace(/[^A-Za-z0-9._-]/g, "").replace(/^\.+/, "") || "upload";
  const ext = rawExt.replace(/[^A-Za-z0-9]/g, "").slice(0, 10);
  return ext ? `${stem}.${ext}` : stem;
}

const filesRouter = router({
  uploadUrl: protectedProcedure
    .input(z.object({ name: z.string().min(1), contentType: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const key = `${crypto.randomUUID()}-${sanitizeBasename(input.name)}`;
      try {
        const { uploadUrl, publicPath } = await storagePutUrl(key, input.contentType, { ownerId: ctx.user.id });
        return { key, uploadUrl, publicPath };
      } catch (e) {
        if (e instanceof StorageError && e.code === "failed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "upload rejected by storage — check contentType is on the platform's whitelist " +
              "(png/jpeg/gif/webp/avif, pdf, text/plain, csv, json, mpeg/wav audio, mp4/webm video)",
          });
        }
        throw e;
      }
    }),

  commit: protectedProcedure
    .input(z.object({ key: z.string().min(1), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await storageCommit(input.key, { ownerId: ctx.user.id, name: input.name });
      } catch (e) {
        if (e instanceof StorageError && e.code === "not_found") {
          throw new TRPCError({ code: "NOT_FOUND", message: "upload not found — did the PUT succeed?" });
        }
        if (e instanceof StorageError && e.code === "forbidden") {
          throw new TRPCError({ code: "FORBIDDEN", message: "that key belongs to another user" });
        }
        throw e;
      }
    }),

  list: protectedProcedure.query(({ ctx }) => storageListByOwner(ctx.user.id)),

  remove: protectedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await storageDeleteOwned(ctx.user.id, input.key);
      } catch (e) {
        if (e instanceof StorageError && e.code === "forbidden") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "malformed key" });
        }
        throw e;
      }
    }),
});

export const appRouter = router({
  auth: authRouter,
  player: playerRouter,
  tuning: tuningRouter,
  rounds: roundsRouter,
  supervisor: supervisorRouter,
  files: filesRouter,
});

export type AppRouter = typeof appRouter;
