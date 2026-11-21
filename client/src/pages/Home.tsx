import { Link } from "wouter";
import { trpc } from "@/_core/trpc";
import { useAuth } from "@/_core/useAuth";
import { Button } from "@/components/ui/button";
import Shell from "@/components/Shell";
import { RANKS } from "@shared/tank";

export default function Home() {
  const { user } = useAuth();
  const board = trpc.player.leaderboard.useQuery({ limit: 5 });

  return (
    <Shell>
      <main className="mx-auto max-w-6xl px-4">
        {/* hero */}
        <section className="grid gap-10 py-14 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:py-20">
          <div>
            <p className="hud-label flex items-center gap-2">
              <span className="h-1.5 w-1.5 bg-signal" />
              supervised battle simulator
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
              A tank game that
              <br />
              <span className="text-primary">retunes itself</span>
              <br />
              every round.
            </h1>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
              Drive, aim, survive. When the round ends, tell the supervisor agent how it felt — too
              hard, too slow, wrong camera — and it patches the next round before you deploy. Every
              change is bounded, logged, and applied instantly.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              {user ? (
                <Button asChild className="hud-label h-11 px-6">
                  <Link to="/play">Deploy to sector 7</Link>
                </Button>
              ) : (
                <>
                  <Button asChild className="hud-label h-11 px-6">
                    <Link to="/signup">Enlist now</Link>
                  </Button>
                  <Button asChild variant="outline" className="hud-label h-11 px-6">
                    <Link to="/login">Sign in</Link>
                  </Button>
                </>
              )}
            </div>

            <div className="mt-8 grid max-w-md grid-cols-3 gap-4 border-t border-border pt-5">
              <Feature k="8" v="ranks" />
              <Feature k="3" v="camera modes" />
              <Feature k="∞" v="tuning rounds" />
            </div>
          </div>

          {/* leaderboard preview */}
          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-secondary/40 px-4 py-2.5">
              <span className="hud-label text-primary">Top operators</span>
              <Link to="/leaderboard" className="hud-label hover:text-foreground">
                full board →
              </Link>
            </div>
            {board.isLoading ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-9 animate-pulse bg-secondary/50" />
                ))}
              </div>
            ) : board.data && board.data.length > 0 ? (
              <ul>
                {board.data.map((p, i) => (
                  <li
                    key={`${p.callsign}-${i}`}
                    className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-0"
                  >
                    <span className="hud-value w-5 text-xs text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="hud-value flex-1 truncate text-sm">{p.callsign}</span>
                    <span className="hud-label text-primary">{p.rank}</span>
                    <span className="hud-value w-14 text-right text-xs text-muted-foreground">
                      {p.xp.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-10 text-center">
                <p className="hud-label text-muted-foreground">No operators on record</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  The board fills as players finish rounds. Be the first name on it.
                </p>
                <Button asChild size="sm" className="hud-label mt-4">
                  <Link to={user ? "/play" : "/signup"}>Take the field</Link>
                </Button>
              </div>
            )}
          </div>
        </section>

        {/* how it works */}
        <section className="border-t border-border py-12">
          <p className="hud-label">How the loop works</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Step n="01" title="Fight a round" body="Top-down arena, enemy tanks closing in. Score, waves, hull integrity — all live in the HUD." />
            <Step n="02" title="Report to the supervisor" body="Type or tap feedback under the canvas. The backend agent reads it and returns a bounded tuning patch." />
            <Step n="03" title="Deploy retuned" body="Enemy count, speed, accuracy, your speed, arena size, even the camera — applied to the very next round." />
          </div>
        </section>

        {/* rank ladder */}
        <section className="border-t border-border py-12">
          <p className="hud-label">Rank ladder</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {RANKS.map((r) => (
              <div key={r.name} className="panel px-3 py-2">
                <p className="hud-value text-sm">{r.name}</p>
                <p className="hud-label mt-0.5 text-muted-foreground">{r.minXp.toLocaleString()} XP</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </Shell>
  );
}

function Feature({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="hud-value text-2xl font-semibold text-primary">{k}</p>
      <p className="hud-label mt-0.5">{v}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="panel p-4">
      <p className="hud-value text-xs text-primary">{n}</p>
      <p className="mt-2 text-sm font-medium">{title}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
