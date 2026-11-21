import { describe, expect, it } from "vitest";
import {
  DEFAULT_TUNING,
  RANKS,
  TUNING_BOUNDS,
  applyPatch,
  clampTuning,
  diffTuning,
  rankForXp,
  rankProgress,
  xpForRound,
  type TuningConfig,
} from "./tank";

describe("applyPatch — the supervisor's only gate", () => {
  it("applies a valid numeric change", () => {
    expect(applyPatch(DEFAULT_TUNING, { enemyCount: 6 }).enemyCount).toBe(6);
  });

  it("clamps above the maximum", () => {
    expect(applyPatch(DEFAULT_TUNING, { enemyCount: 999 }).enemyCount).toBe(TUNING_BOUNDS.enemyCount.max);
  });

  it("clamps below the minimum", () => {
    expect(applyPatch(DEFAULT_TUNING, { enemyCount: -5 }).enemyCount).toBe(TUNING_BOUNDS.enemyCount.min);
  });

  it("drops unknown keys", () => {
    const next = applyPatch(DEFAULT_TUNING, { nuke: 1 } as unknown as Partial<TuningConfig>);
    expect(next).toEqual(DEFAULT_TUNING);
  });

  it("ignores a non-finite number", () => {
    expect(applyPatch(DEFAULT_TUNING, { enemySpeed: Number.NaN }).enemySpeed).toBe(
      DEFAULT_TUNING.enemySpeed,
    );
  });

  it("accepts a valid view mode and rejects an invalid one", () => {
    expect(applyPatch(DEFAULT_TUNING, { viewMode: "tactical" }).viewMode).toBe("tactical");
    expect(
      applyPatch(DEFAULT_TUNING, { viewMode: "third-person" as unknown as TuningConfig["viewMode"] })
        .viewMode,
    ).toBe("topdown");
  });

  it("never mutates the base config", () => {
    const base = { ...DEFAULT_TUNING };
    applyPatch(base, { enemyCount: 9 });
    expect(base.enemyCount).toBe(DEFAULT_TUNING.enemyCount);
  });
});

describe("clampTuning", () => {
  it("repairs an out-of-range stored config", () => {
    const fixed = clampTuning({ ...DEFAULT_TUNING, enemyCount: 500, enemyAccuracy: -3 });
    expect(fixed.enemyCount).toBe(TUNING_BOUNDS.enemyCount.max);
    expect(fixed.enemyAccuracy).toBe(TUNING_BOUNDS.enemyAccuracy.min);
  });
});

describe("diffTuning", () => {
  it("returns only the keys that changed", () => {
    const next = { ...DEFAULT_TUNING, enemyCount: 5, viewMode: "isometric" as const };
    expect(diffTuning(DEFAULT_TUNING, next)).toEqual({ enemyCount: 5, viewMode: "isometric" });
  });

  it("returns an empty object when nothing changed", () => {
    expect(diffTuning(DEFAULT_TUNING, { ...DEFAULT_TUNING })).toEqual({});
  });
});

describe("rank ladder", () => {
  it("starts everyone at Recruit", () => {
    expect(rankForXp(0)).toBe("Recruit");
  });

  it("promotes at each threshold", () => {
    for (const r of RANKS) expect(rankForXp(r.minXp)).toBe(r.name);
  });

  it("caps at General", () => {
    expect(rankForXp(999_999)).toBe("General");
  });

  it("reports progress toward the next rank", () => {
    const p = rankProgress(150); // halfway from Recruit(0) to Corporal(300)
    expect(p.current.name).toBe("Recruit");
    expect(p.next?.name).toBe("Corporal");
    expect(p.pct).toBeCloseTo(0.5, 2);
    expect(p.toNext).toBe(150);
  });

  it("reports full progress at the top rank", () => {
    const p = rankProgress(20_000);
    expect(p.next).toBeNull();
    expect(p.pct).toBe(1);
  });
});

describe("xpForRound", () => {
  it("rewards score, kills and waves", () => {
    expect(xpForRound({ score: 1000, kills: 5, wave: 3 })).toBe(100 + 25 + 30);
  });

  it("never goes negative", () => {
    expect(xpForRound({ score: 0, kills: 0, wave: 1 })).toBeGreaterThanOrEqual(0);
  });
});
