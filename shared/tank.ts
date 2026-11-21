// ── Tank War shared domain ──────────────────────────────────────────────────
// Types, defaults, rank ladder and the BOUNDED patch logic. Shared by the
// client (renders the config, shows the diff) and the server (validates and
// applies what the supervisor returns), so both sides agree on the limits.

export const VIEW_MODES = ["topdown", "isometric", "tactical"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  topdown: "Top-down",
  isometric: "Isometric 2.5D",
  tactical: "Tactical zoom",
};

export interface TuningConfig {
  /** How many enemy tanks spawn per wave. */
  enemyCount: number;
  /** Enemy movement speed, px/s at 1x. */
  enemySpeed: number;
  /** Enemy shots per second. */
  enemyFireRate: number;
  /** 0..1 — chance an enemy shot is aimed at the player rather than jittered. */
  enemyAccuracy: number;
  /** Player movement speed, px/s. */
  playerSpeed: number;
  /** Player shots per second. */
  playerFireRate: number;
  /** Arena side length in world units. */
  arenaSize: number;
  /** Renderer projection. */
  viewMode: ViewMode;
}

export const DEFAULT_TUNING: TuningConfig = {
  enemyCount: 3,
  enemySpeed: 70,
  enemyFireRate: 0.45,
  enemyAccuracy: 0.45,
  playerSpeed: 150,
  playerFireRate: 1.6,
  arenaSize: 900,
  viewMode: "topdown",
};

/** Hard bounds. A patch outside these is clamped, never rejected outright. */
export const TUNING_BOUNDS: Record<keyof TuningConfig, { min: number; max: number }> = {
  enemyCount: { min: 1, max: 12 },
  enemySpeed: { min: 20, max: 220 },
  enemyFireRate: { min: 0.05, max: 3 },
  enemyAccuracy: { min: 0, max: 1 },
  playerSpeed: { min: 60, max: 320 },
  playerFireRate: { min: 0.4, max: 6 },
  arenaSize: { min: 500, max: 1600 },
  viewMode: { min: 0, max: 0 }, // not numeric — handled separately
};

export const TUNING_LABELS: Record<keyof TuningConfig, string> = {
  enemyCount: "Enemy count",
  enemySpeed: "Enemy speed",
  enemyFireRate: "Enemy fire rate",
  enemyAccuracy: "Enemy accuracy",
  playerSpeed: "Player speed",
  playerFireRate: "Player fire rate",
  arenaSize: "Arena size",
  viewMode: "View mode",
};

export const TUNING_UNITS: Partial<Record<keyof TuningConfig, string>> = {
  enemySpeed: "px/s",
  enemyFireRate: "/s",
  playerSpeed: "px/s",
  playerFireRate: "/s",
  arenaSize: "u",
};

/** A patch is a partial config — only the keys the supervisor changed. */
export type TuningPatch = Partial<TuningConfig>;

export function clampTuning(cfg: TuningConfig): TuningConfig {
  const out = { ...cfg };
  for (const key of Object.keys(TUNING_BOUNDS) as (keyof TuningConfig)[]) {
    if (key === "viewMode") continue;
    const b = TUNING_BOUNDS[key];
    const v = Number(out[key]);
    out[key] = Number.isFinite(v) ? Math.min(b.max, Math.max(b.min, v)) : DEFAULT_TUNING[key];
  }
  if (!VIEW_MODES.includes(out.viewMode)) out.viewMode = "topdown";
  return out;
}

/**
 * Apply a patch to a config. Unknown keys are dropped, numbers are clamped to
 * TUNING_BOUNDS, and viewMode must be one of VIEW_MODES. This is the single
 * gate every supervisor patch passes through — the LLM cannot escape it.
 */
export function applyPatch(base: TuningConfig, patch: TuningPatch): TuningConfig {
  const next: TuningConfig = { ...base };
  for (const key of Object.keys(patch) as (keyof TuningConfig)[]) {
    if (!(key in TUNING_BOUNDS)) continue;
    if (key === "viewMode") {
      const v = patch.viewMode;
      if (v && VIEW_MODES.includes(v)) next.viewMode = v;
      continue;
    }
    const v = Number(patch[key]);
    if (!Number.isFinite(v)) continue;
    const b = TUNING_BOUNDS[key];
    next[key] = Math.min(b.max, Math.max(b.min, v));
  }
  return next;
}

/** Only the keys that actually changed, rounded for display. */
export function diffTuning(before: TuningConfig, after: TuningConfig): TuningPatch {
  const diff: TuningPatch = {};
  for (const key of Object.keys(after) as (keyof TuningConfig)[]) {
    if (before[key] !== after[key]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (diff as any)[key] = after[key];
    }
  }
  return diff;
}

export function formatTuningValue(key: keyof TuningConfig, value: TuningConfig[keyof TuningConfig]): string {
  if (key === "viewMode") return VIEW_MODE_LABELS[value as ViewMode] ?? String(value);
  const n = Number(value);
  const unit = TUNING_UNITS[key] ?? "";
  const shown = key === "enemyAccuracy" ? `${Math.round(n * 100)}%` : Number.isInteger(n) ? String(n) : n.toFixed(2);
  return unit ? `${shown} ${unit}` : shown;
}

// ── Rank ladder ─────────────────────────────────────────────────────────────
export interface RankTier {
  name: string;
  minXp: number;
}

export const RANKS: RankTier[] = [
  { name: "Recruit", minXp: 0 },
  { name: "Corporal", minXp: 300 },
  { name: "Sergeant", minXp: 800 },
  { name: "Lieutenant", minXp: 1600 },
  { name: "Captain", minXp: 2800 },
  { name: "Major", minXp: 4500 },
  { name: "Colonel", minXp: 7000 },
  { name: "General", minXp: 10000 },
];

export function rankForXp(xp: number): string {
  let name = RANKS[0].name;
  for (const r of RANKS) if (xp >= r.minXp) name = r.name;
  return name;
}

/** Progress toward the next rank: 0..1, plus the XP still needed. */
export function rankProgress(xp: number): { current: RankTier; next: RankTier | null; pct: number; toNext: number } {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].minXp) idx = i;
  const current = RANKS[idx];
  const next = RANKS[idx + 1] ?? null;
  if (!next) return { current, next: null, pct: 1, toNext: 0 };
  const span = next.minXp - current.minXp;
  const pct = span > 0 ? Math.min(1, Math.max(0, (xp - current.minXp) / span)) : 1;
  return { current, next, pct, toNext: Math.max(0, next.minXp - xp) };
}

/** XP awarded for a round: score is the main driver, kills and waves add. */
export function xpForRound(r: { score: number; kills: number; wave: number }): number {
  return Math.max(0, Math.round(r.score / 10) + r.kills * 5 + r.wave * 10);
}

// ── Round result contract (client → server) ─────────────────────────────────
export interface RoundResult {
  score: number;
  kills: number;
  wave: number;
  survivedSeconds: number;
  outcome: "destroyed" | "cleared";
  tuningSnapshot: TuningConfig;
}

export interface SupervisorReply {
  source: "llm" | "heuristic";
  message: string;
  patch: TuningPatch;
  config: TuningConfig;
  version: number;
}
