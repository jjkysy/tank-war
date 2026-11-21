// ── AGENT-OWNED: the supervisor agent ───────────────────────────────────────
// Turns player feedback into a BOUNDED tuning patch.
//
// Two paths, and the panel always says which one ran:
//   1. LLM  — an OpenAI-compatible chat endpoint, key from env.secret("LLM_API_KEY").
//   2. Heuristic — a real rule-based supervisor that parses the feedback text.
//      Used when no key is configured, or when the LLM call fails. It is not a
//      mock: it produces a genuine patch from the words the player wrote.
//
// Every patch — from either path — passes through applyPatch() in shared/tank.ts,
// which drops unknown keys and clamps numbers to TUNING_BOUNDS. The LLM cannot
// escape the bounds.
import { outboundFetch } from "../_core/fetch";
import {
  DEFAULT_TUNING,
  TUNING_BOUNDS,
  VIEW_MODES,
  applyPatch,
  diffTuning,
  formatTuningValue,
  type TuningConfig,
  type TuningPatch,
} from "../../shared/tank";

export interface SupervisorInput {
  feedback: string;
  config: TuningConfig;
  recentRounds: { score: number; kills: number; wave: number; outcome: string; survivedSeconds: number }[];
}

export interface SupervisorOutput {
  source: "llm" | "heuristic";
  message: string;
  patch: TuningPatch;
  config: TuningConfig;
}

const SYSTEM_PROMPT = `You are the SUPERVISOR of a 2D tank battle game. The player just finished a round and wrote feedback. Your job: decide a small, bounded tuning change that makes the NEXT round better match what they asked for.

Reply with ONLY a JSON object, no prose, no markdown fence:
{"message": "<one or two sentences to the player, in their language, saying what you changed and why>", "patch": {<only the keys you change>}}

Allowed patch keys and their hard limits:
- enemyCount: 1..12 (enemies per wave)
- enemySpeed: 20..220 (px/s)
- enemyFireRate: 0.05..3 (shots per second)
- enemyAccuracy: 0..1 (0 = wild, 1 = aimed)
- playerSpeed: 60..320 (px/s)
- playerFireRate: 0.4..6 (shots per second)
- arenaSize: 500..1600 (world units)
- viewMode: "topdown" | "isometric" | "tactical"

Rules:
- Change only what the feedback justifies. A small change is better than a big one.
- If the player asks for a different camera or view, set viewMode.
- If the player is happy, return an empty patch {} and say so.
- Never invent keys. Never exceed the limits.`;

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function coercePatch(raw: unknown): TuningPatch {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const patch: TuningPatch = {};
  for (const key of Object.keys(TUNING_BOUNDS) as (keyof TuningConfig)[]) {
    if (!(key in obj)) continue;
    if (key === "viewMode") {
      const v = String(obj.viewMode);
      if ((VIEW_MODES as readonly string[]).includes(v)) patch.viewMode = v as TuningConfig["viewMode"];
      continue;
    }
    const n = Number(obj[key]);
    if (Number.isFinite(n)) (patch as Record<string, number>)[key] = n;
  }
  return patch;
}

// ── Heuristic supervisor ────────────────────────────────────────────────────
// A real rule-based agent. It reads the feedback for intent keywords and
// produces a genuine, bounded patch. Deterministic and testable.

interface Rule {
  test: RegExp;
  apply: (cfg: TuningConfig) => TuningPatch;
  note: string;
}

// Each axis is a pair of OPPOSITE intents. The negative (more specific) rule is
// listed first and the merge below is FIRST-WINS per key, so "too hard" can
// never also trip the "harder" rule and cancel itself out.
const HARDER = /(harder|too easy|more enem|tougher|more challeng|increase (the )?(difficulty|enemies)|更难|增加敌人|太简单|无聊)/i;
const EASIER = /(too hard|too difficult|impossible|unfair|easier|less enem|fewer enem|calm|relax|太难|太困难|减少敌人|放松|简单点)/i;
const FASTER = /(faster|speed up|too slow|quicker|加速|快一点|太慢)/i;
const SLOWER = /(slower|slow down|too fast|减速|慢一点|太快)/i;
const MORE_ACCURATE = /(more accurate|sharpen|precise|sniper|更准|精准)/i;
const LESS_ACCURATE = /(too accurate|inaccurate|miss|wild|stormtrooper|不准|打不中|太准)/i;
const BIGGER = /(bigger|larger|more space|大一点|更大|空间)/i;
const SMALLER = /(smaller|tight|cramped|小一点|更小|狭窄)/i;
const ISO = /(isometric|2\.5d|iso|斜|等距|立体)/i;
const TACTICAL = /(tactical|zoom|overview|far|wide|俯瞰|战术|拉远|全景)/i;
const TOPDOWN = /(top.?down|overhead|flat|俯视|平面|正上方)/i;

// Order matters: view modes first (unambiguous), then each axis's NEGATIVE rule
// before its positive one.
const RULES: Rule[] = [
  { test: ISO, apply: () => ({ viewMode: "isometric" }), note: "switched the camera to isometric 2.5D" },
  { test: TACTICAL, apply: () => ({ viewMode: "tactical" }), note: "pulled the camera back to tactical zoom" },
  { test: TOPDOWN, apply: () => ({ viewMode: "topdown" }), note: "returned the camera to top-down" },
  {
    test: EASIER,
    apply: (c) => ({ enemyCount: c.enemyCount - 1, enemyFireRate: c.enemyFireRate - 0.1, enemyAccuracy: c.enemyAccuracy - 0.05 }),
    note: "eased the pressure",
  },
  {
    test: HARDER,
    apply: (c) => ({ enemyCount: c.enemyCount + 1, enemyFireRate: c.enemyFireRate + 0.1, enemyAccuracy: c.enemyAccuracy + 0.05 }),
    note: "raised the pressure",
  },
  { test: SLOWER, apply: (c) => ({ playerSpeed: c.playerSpeed - 25, playerFireRate: c.playerFireRate - 0.3 }), note: "slowed you down" },
  { test: FASTER, apply: (c) => ({ playerSpeed: c.playerSpeed + 25, playerFireRate: c.playerFireRate + 0.3 }), note: "made you faster" },
  { test: LESS_ACCURATE, apply: (c) => ({ enemyAccuracy: c.enemyAccuracy - 0.1 }), note: "loosened enemy aim" },
  { test: MORE_ACCURATE, apply: (c) => ({ enemyAccuracy: c.enemyAccuracy + 0.1 }), note: "sharpened enemy aim" },
  { test: SMALLER, apply: (c) => ({ arenaSize: c.arenaSize - 150 }), note: "tightened the arena" },
  { test: BIGGER, apply: (c) => ({ arenaSize: c.arenaSize + 150 }), note: "enlarged the arena" },
];

export function heuristicSupervisor(input: SupervisorInput): SupervisorOutput {
  const text = input.feedback;
  const patch: TuningPatch = {};
  const notes: string[] = [];

  for (const rule of RULES) {
    if (!rule.test.test(text)) continue;
    const p = rule.apply(input.config);
    let applied = false;
    for (const [k, v] of Object.entries(p)) {
      // FIRST-WINS per key: an earlier (more specific) rule owns the key, so an
      // opposite rule later in the list cannot cancel it out.
      if (k in patch) continue;
      (patch as Record<string, unknown>)[k] = v;
      applied = true;
    }
    if (applied) notes.push(rule.note);
  }

  // No keyword matched: fall back to the round history. A player who keeps
  // dying early gets a small ease-off; a player who clears waves gets more.
  if (notes.length === 0) {
    const recent = input.recentRounds.slice(0, 3);
    const avgWave = recent.length ? recent.reduce((s, r) => s + r.wave, 0) / recent.length : 1;
    const deaths = recent.filter((r) => r.outcome === "destroyed").length;
    if (recent.length >= 2 && deaths >= 2 && avgWave <= 2) {
      patch.enemyCount = input.config.enemyCount - 1;
      patch.enemyFireRate = input.config.enemyFireRate - 0.08;
      notes.push("you have been going down early, so I eased the opening waves");
    } else if (recent.length >= 2 && avgWave >= 4) {
      patch.enemyCount = input.config.enemyCount + 1;
      patch.enemySpeed = input.config.enemySpeed + 10;
      notes.push("you are clearing waves comfortably, so I raised the ceiling");
    } else {
      notes.push("nothing in that feedback pointed at a specific dial, so I left the tuning as it is");
    }
  }

  const next = applyPatch(input.config, patch);
  const diff = diffTuning(input.config, next);
  const changed = Object.keys(diff).length;

  const message = changed
    ? `Heuristic supervisor: ${notes.join("; ")}. Applied ${changed} change${changed === 1 ? "" : "s"}.`
    : `Heuristic supervisor: ${notes.join("; ")}. No change applied.`;

  return { source: "heuristic", message, patch: diff, config: next };
}

// ── LLM supervisor ──────────────────────────────────────────────────────────

async function llmSupervisor(input: SupervisorInput, apiKey: string): Promise<SupervisorOutput> {
  // Imported lazily: _core/env validates DATABASE_URL at module load, and this
  // module is pulled in by routers.ts, which the frozen _core tests import.
  const { env } = await import("../_core/env");
  const baseUrl = env.config("LLM_BASE_URL", "https://api.openai.com/v1");
  const model = env.config("LLM_MODEL", "gpt-4o-mini");

  const context = [
    `Current tuning: ${JSON.stringify(input.config)}`,
    input.recentRounds.length
      ? `Recent rounds (newest first): ${input.recentRounds
          .map((r) => `score ${r.score}, ${r.kills} kills, wave ${r.wave}, ${r.outcome}, ${r.survivedSeconds}s`)
          .join(" | ")}`
      : "No previous rounds.",
    `Player feedback: ${input.feedback}`,
  ].join("\n");

  const res = await outboundFetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: context },
      ],
    }),
    timeoutMs: 20_000,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM endpoint returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  const parsed = extractJson(content) as { message?: unknown; patch?: unknown } | null;
  if (!parsed) throw new Error("LLM reply was not JSON");

  const patch = coercePatch(parsed.patch);
  const next = applyPatch(input.config, patch);
  const diff = diffTuning(input.config, next);
  const message =
    typeof parsed.message === "string" && parsed.message.trim()
      ? parsed.message.trim()
      : `Applied ${Object.keys(diff).length} tuning change(s).`;

  return { source: "llm", message, patch: diff, config: next };
}

/**
 * Run the supervisor. Tries the LLM when a key is configured; on any failure
 * (no key, network, bad JSON) it falls back to the heuristic supervisor and
 * says so. It never claims an LLM answered when one did not.
 */
export async function runSupervisor(input: SupervisorInput): Promise<SupervisorOutput & { fallbackReason?: string }> {
  let apiKey: string | null = null;
  try {
    const { env } = await import("../_core/env");
    apiKey = env.secret("LLM_API_KEY");
  } catch {
    apiKey = null;
  }

  if (!apiKey) {
    const out = heuristicSupervisor(input);
    return { ...out, fallbackReason: "no LLM_API_KEY configured" };
  }

  try {
    return await llmSupervisor(input, apiKey);
  } catch (e) {
    const out = heuristicSupervisor(input);
    return { ...out, fallbackReason: e instanceof Error ? e.message : "LLM call failed" };
  }
}

/** Human-readable one-liner for a patch, used in the patch history. */
export function describePatch(patch: TuningPatch): string {
  const parts = Object.entries(patch).map(
    ([k, v]) => `${k} → ${formatTuningValue(k as keyof TuningConfig, v as TuningConfig[keyof TuningConfig])}`,
  );
  return parts.length ? parts.join(", ") : "no change";
}

export { DEFAULT_TUNING };
