import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/_core/trpc";
import { Button } from "@/components/ui/button";
import Shell from "@/components/Shell";
import SupervisorPanel from "@/components/SupervisorPanel";
import {
  createGame,
  render,
  screenToWorld,
  step,
  type GameState,
  type Input,
  type Viewport,
} from "@/game/engine";
import {
  DEFAULT_TUNING,
  VIEW_MODE_LABELS,
  rankProgress,
  type TuningConfig,
} from "@shared/tank";

export default function Play() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const inputRef = useRef<Input>({
    up: false,
    down: false,
    left: false,
    right: false,
    firing: false,
    aim: { x: 0, y: 0 },
  });
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(0);
  const recordedRef = useRef(false);

  const [config, setConfig] = useState<TuningConfig>(DEFAULT_TUNING);
  const [hud, setHud] = useState({ score: 0, kills: 0, wave: 1, hp: 100, elapsed: 0 });
  const [roundOver, setRoundOver] = useState(false);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [xpGained, setXpGained] = useState<number | null>(null);

  const tuningQ = trpc.tuning.get.useQuery();
  const profileQ = trpc.player.me.useQuery();
  const record = trpc.rounds.record.useMutation();
  const utils = trpc.useUtils();

  // Load the player's saved tuning once.
  useEffect(() => {
    if (tuningQ.data) setConfig(tuningQ.data.config as TuningConfig);
  }, [tuningQ.data]);

  const startRound = useCallback(() => {
    stateRef.current = createGame(config);
    recordedRef.current = false;
    setRoundOver(false);
    setRoundId(null);
    setBanner(null);
    setXpGained(null);
    setHud({ score: 0, kills: 0, wave: 1, hp: 100, elapsed: 0 });
  }, [config]);

  // Start the first round once tuning has loaded.
  useEffect(() => {
    if (tuningQ.data && !stateRef.current) startRound();
  }, [tuningQ.data, startRound]);

  // ── input ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) {
        e.preventDefault();
      }
      if (k === "w" || k === "arrowup") inputRef.current.up = true;
      if (k === "s" || k === "arrowdown") inputRef.current.down = true;
      if (k === "a" || k === "arrowleft") inputRef.current.left = true;
      if (k === "d" || k === "arrowright") inputRef.current.right = true;
      if (k === " ") inputRef.current.firing = true;
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") inputRef.current.up = false;
      if (k === "s" || k === "arrowdown") inputRef.current.down = false;
      if (k === "a" || k === "arrowleft") inputRef.current.left = false;
      if (k === "d" || k === "arrowright") inputRef.current.right = false;
      if (k === " ") inputRef.current.firing = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const vp: Viewport = { width: rect.width, height: rect.height };
    const world = screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
      config.arenaSize,
      vp,
      config.viewMode,
    );
    inputRef.current.aim = world;
  };

  // ── main loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = wrap.clientWidth;
      const h = Math.max(360, Math.min(620, Math.round(w * 0.62)));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const loop = (t: number) => {
      const state = stateRef.current;
      if (state) {
        const dt = Math.min(0.05, (t - (lastRef.current || t)) / 1000);
        lastRef.current = t;

        if (!state.over) {
          step(state, dt, inputRef.current, config);
          setHud({
            score: state.score,
            kills: state.kills,
            wave: state.wave,
            hp: state.player.hp,
            elapsed: state.elapsed,
          });
          if (state.waveClearedAt !== null) setBanner(`Wave ${state.wave} cleared`);
          else setBanner(null);
        } else if (!recordedRef.current) {
          recordedRef.current = true;
          setRoundOver(true);
          setBanner("Tank destroyed");
          record
            .mutateAsync({
              score: state.score,
              kills: state.kills,
              wave: state.wave,
              survivedSeconds: Math.round(state.elapsed),
              outcome: state.outcome,
              tuningSnapshot: config,
            })
            .then((res) => {
              setRoundId(res.roundId);
              setXpGained(res.xpGained);
              void utils.player.me.invalidate();
              void utils.player.rounds.invalidate();
            })
            .catch(() => {
              /* the round still counts locally; the panel shows the error */
            });
        }

        const rect = canvas.getBoundingClientRect();
        render(ctx, state, config, { width: rect.width, height: rect.height });
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [config, record, utils]);

  const profile = profileQ.data;
  const progress = useMemo(() => (profile ? rankProgress(profile.xp) : null), [profile]);
  const hpPct = Math.max(0, Math.min(100, hud.hp));

  return (
    <Shell>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {/* HUD strip */}
        <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="hud-label">Sector 7 · live engagement</p>
            <h1 className="hud-value mt-1 text-2xl font-semibold tracking-tight">
              {profile?.callsign ?? "Commander"}
              <span className="ml-2 text-sm font-normal text-primary">{profile?.rank ?? "Recruit"}</span>
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <Stat label="Score" value={hud.score.toLocaleString()} accent />
            <Stat label="Wave" value={String(hud.wave)} />
            <Stat label="Kills" value={String(hud.kills)} />
            <Stat label="Time" value={`${Math.floor(hud.elapsed)}s`} />
            <div className="min-w-[120px]">
              <p className="hud-label mb-1">Hull integrity</p>
              <div className="h-2 w-full border border-border bg-input">
                <div
                  className="h-full transition-[width] duration-150"
                  style={{
                    width: `${hpPct}%`,
                    background: hpPct > 55 ? "#7ee787" : hpPct > 25 ? "#f5a524" : "#d94f3d",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* rank progress */}
        {progress && (
          <div className="mb-3 flex items-center gap-3">
            <span className="hud-label">{progress.current.name}</span>
            <div className="h-1 flex-1 bg-input">
              <div className="h-full bg-primary" style={{ width: `${progress.pct * 100}%` }} />
            </div>
            <span className="hud-label text-muted-foreground">
              {progress.next ? `${progress.toNext} XP → ${progress.next.name}` : "max rank"}
            </span>
          </div>
        )}

        {/* canvas */}
        <div ref={wrapRef} className="panel scanlines relative overflow-hidden">
          <canvas
            ref={canvasRef}
            onPointerMove={onPointerMove}
            onPointerDown={() => (inputRef.current.firing = true)}
            onPointerUp={() => (inputRef.current.firing = false)}
            onPointerLeave={() => (inputRef.current.firing = false)}
            className="block w-full cursor-crosshair touch-none"
          />

          {/* corner readouts */}
          <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1">
            <span className="hud-label bg-background/70 px-1.5 py-0.5">
              {VIEW_MODE_LABELS[config.viewMode]}
            </span>
            <span className="hud-label bg-background/70 px-1.5 py-0.5">
              {config.enemyCount} hostiles · {Math.round(config.enemySpeed)} px/s
            </span>
          </div>

          {banner && !roundOver && (
            <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center">
              <span className="hud-value inline-block border border-primary/50 bg-background/85 px-4 py-2 text-lg tracking-[0.2em] text-primary">
                {banner}
              </span>
            </div>
          )}

          {roundOver && (
            <div className="absolute inset-0 grid place-items-center bg-background/85 p-4 backdrop-blur-sm">
              <div className="panel w-[min(92%,380px)] border-primary/30 bg-card p-6 text-center shadow-2xl">
                <p className="hud-label text-danger">Engagement ended</p>
                <p className="hud-value mt-2 text-3xl font-semibold">{hud.score.toLocaleString()}</p>
                <p className="hud-label mt-1">final score</p>
                <div className="mt-4 grid grid-cols-3 gap-2 border-y border-border py-3">
                  <MiniStat label="Wave" value={String(hud.wave)} />
                  <MiniStat label="Kills" value={String(hud.kills)} />
                  <MiniStat label="XP" value={xpGained === null ? "…" : `+${xpGained}`} />
                </div>
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  Give the supervisor feedback below, then deploy the next round.
                </p>
                <Button className="hud-label mt-4 h-10 w-full" onClick={startRound}>
                  Redeploy
                </Button>
              </div>
            </div>
          )}
        </div>

        <p className="hud-label mt-2">
          WASD / arrows to drive · mouse to aim · space or click to fire
        </p>

        {/* supervisor panel — directly beneath the canvas */}
        <SupervisorPanel
          config={config}
          roundId={roundId}
          roundOver={roundOver}
          onApplied={(next) => setConfig(next)}
          onNextRound={startRound}
        />
      </main>
    </Shell>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="hud-label mb-0.5">{label}</p>
      <p className={`hud-value text-lg font-semibold ${accent ? "text-primary" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="hud-label">{label}</p>
      <p className="hud-value mt-0.5 text-sm">{value}</p>
    </div>
  );
}
