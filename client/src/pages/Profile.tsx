import { useState } from "react";
import { trpc } from "@/_core/trpc";
import { Button } from "@/components/ui/button";
import Shell from "@/components/Shell";
import {
  TUNING_LABELS,
  formatTuningValue,
  rankProgress,
  type TuningConfig,
  type TuningPatch,
} from "@shared/tank";

export default function Profile() {
  const me = trpc.player.me.useQuery();
  const rounds = trpc.player.rounds.useQuery({ limit: 20 });
  const patches = trpc.player.patches.useQuery({ limit: 20 });
  const utils = trpc.useUtils();
  const setCallsign = trpc.player.setCallsign.useMutation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const p = me.data;
  const progress = p ? rankProgress(p.xp) : null;

  async function save() {
    if (!draft.trim()) return;
    await setCallsign.mutateAsync({ callsign: draft.trim() });
    setEditing(false);
    void utils.player.me.invalidate();
    void utils.player.leaderboard.invalidate();
  }

  return (
    <Shell>
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="hud-label">Dossier</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Service record</h1>

        {/* identity card */}
        <div className="panel mt-6 grid gap-6 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            {editing ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={24}
                  className="hud-value h-9 w-48 border border-input bg-input/60 px-2 text-sm outline-none focus:border-primary"
                  placeholder="Callsign"
                />
                <Button size="sm" className="hud-label h-9" onClick={() => void save()}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="hud-label h-9"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <h2 className="hud-value text-2xl font-semibold">{p?.callsign ?? "—"}</h2>
                <button
                  className="hud-label text-muted-foreground hover:text-primary"
                  onClick={() => {
                    setDraft(p?.callsign ?? "");
                    setEditing(true);
                  }}
                >
                  edit
                </button>
              </div>
            )}
            <p className="hud-label mt-1.5 text-primary">{p?.rank ?? "Recruit"}</p>

            {progress && (
              <div className="mt-4 max-w-sm">
                <div className="h-1.5 bg-input">
                  <div className="h-full bg-primary" style={{ width: `${progress.pct * 100}%` }} />
                </div>
                <p className="hud-label mt-1.5">
                  {progress.next
                    ? `${p!.xp.toLocaleString()} XP · ${progress.toNext} to ${progress.next.name}`
                    : `${p!.xp.toLocaleString()} XP · highest rank`}
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-5 sm:gap-7">
            <Metric label="Rounds" value={String(p?.roundsPlayed ?? 0)} />
            <Metric label="Best score" value={(p?.bestScore ?? 0).toLocaleString()} />
            <Metric label="XP" value={(p?.xp ?? 0).toLocaleString()} />
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* round history */}
          <section className="panel overflow-hidden">
            <div className="border-b border-border bg-secondary/40 px-4 py-2.5">
              <span className="hud-label text-primary">Round history</span>
            </div>
            {rounds.isLoading ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-9 animate-pulse bg-secondary/50" />
                ))}
              </div>
            ) : rounds.data && rounds.data.length > 0 ? (
              <ul className="max-h-[420px] overflow-y-auto">
                {rounds.data.map((r) => (
                  <li key={r.id} className="border-b border-border/60 px-4 py-2.5 last:border-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="hud-value text-sm">{r.score.toLocaleString()}</span>
                      <span className="hud-label text-muted-foreground">
                        wave {r.wave} · {r.kills} kills · {r.survivedSeconds}s
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span
                        className={`hud-label ${r.outcome === "cleared" ? "text-signal" : "text-danger"}`}
                      >
                        {r.outcome}
                      </span>
                      <span className="hud-label text-muted-foreground/70">
                        {new Date(r.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-12 text-center">
                <p className="hud-label text-muted-foreground">No rounds logged</p>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                  Every engagement you finish is recorded here with its score, wave and outcome.
                </p>
              </div>
            )}
          </section>

          {/* patch history */}
          <section className="panel overflow-hidden">
            <div className="border-b border-border bg-secondary/40 px-4 py-2.5">
              <span className="hud-label text-signal">Supervisor patch log</span>
            </div>
            {patches.isLoading ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-9 animate-pulse bg-secondary/50" />
                ))}
              </div>
            ) : patches.data && patches.data.length > 0 ? (
              <ul className="max-h-[420px] overflow-y-auto">
                {patches.data.map((pt) => {
                  const diff = (pt.diff ?? {}) as TuningPatch;
                  return (
                    <li key={pt.id} className="border-b border-border/60 px-4 py-3 last:border-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`hud-label border px-1.5 py-0.5 ${
                            pt.source === "llm"
                              ? "border-signal/40 text-signal"
                              : "border-primary/40 text-primary"
                          }`}
                        >
                          {pt.source}
                        </span>
                        <span className="hud-label text-muted-foreground/70">
                          {new Date(pt.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-2 text-[13px] leading-relaxed text-secondary-foreground">
                        {pt.summary}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {Object.entries(diff).map(([k, v]) => (
                          <span key={k} className="hud-label border border-border px-1.5 py-0.5">
                            {TUNING_LABELS[k as keyof TuningConfig]}:{" "}
                            <span className="text-signal">
                              {formatTuningValue(k as keyof TuningConfig, v as TuningConfig[keyof TuningConfig])}
                            </span>
                          </span>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-4 py-12 text-center">
                <p className="hud-label text-muted-foreground">No patches yet</p>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                  When you give the supervisor feedback that changes the tuning, the exact diff lands
                  here — what changed, from which agent, and when.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
    </Shell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="hud-label">{label}</p>
      <p className="hud-value mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
