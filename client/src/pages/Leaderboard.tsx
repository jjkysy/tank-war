import { trpc } from "@/_core/trpc";
import Shell from "@/components/Shell";
import { rankProgress } from "@shared/tank";

export default function Leaderboard() {
  const board = trpc.player.leaderboard.useQuery({ limit: 50 });
  const me = trpc.player.me.useQuery();

  return (
    <Shell>
      <main className="mx-auto max-w-4xl px-4 py-10">
        <p className="hud-label">Standings</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Rank board</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Ordered by XP. XP comes from score, kills and the waves you clear — so the board rewards
          playing well against a supervisor that keeps raising the bar.
        </p>

        <div className="panel mt-6 overflow-hidden">
          <div className="grid grid-cols-[40px_1fr_110px_80px_80px] gap-2 border-b border-border bg-secondary/40 px-4 py-2.5">
            <span className="hud-label">#</span>
            <span className="hud-label">Callsign</span>
            <span className="hud-label">Rank</span>
            <span className="hud-label text-right">XP</span>
            <span className="hud-label text-right">Best</span>
          </div>

          {board.isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 animate-pulse bg-secondary/50" />
              ))}
            </div>
          ) : board.data && board.data.length > 0 ? (
            <ul>
              {board.data.map((p, i) => {
                const isMe = me.data?.callsign === p.callsign;
                return (
                  <li
                    key={`${p.callsign}-${i}`}
                    className={`grid grid-cols-[40px_1fr_110px_80px_80px] items-center gap-2 border-b border-border/60 px-4 py-2.5 last:border-0 ${
                      isMe ? "bg-primary/5" : ""
                    }`}
                  >
                    <span className="hud-value text-xs text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="hud-value truncate text-sm">
                      {p.callsign}
                      {isMe && <span className="hud-label ml-2 text-primary">you</span>}
                    </span>
                    <span className="hud-label text-primary">{p.rank}</span>
                    <span className="hud-value text-right text-xs">{p.xp.toLocaleString()}</span>
                    <span className="hud-value text-right text-xs text-muted-foreground">
                      {p.bestScore.toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-4 py-14 text-center">
              <p className="hud-label text-muted-foreground">The board is empty</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Nobody has finished a round yet. Play one engagement and your callsign lands here
                with the XP it earned.
              </p>
            </div>
          )}
        </div>

        {me.data && (
          <div className="panel mt-4 flex flex-wrap items-center gap-4 p-4">
            <div className="flex-1">
              <p className="hud-label">Your standing</p>
              <p className="hud-value mt-1 text-sm">
                {me.data.callsign} · {me.data.rank} · {me.data.xp.toLocaleString()} XP
              </p>
            </div>
            <div className="w-full sm:w-56">
              <div className="h-1.5 bg-input">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${rankProgress(me.data.xp).pct * 100}%` }}
                />
              </div>
              <p className="hud-label mt-1.5">
                {rankProgress(me.data.xp).next
                  ? `${rankProgress(me.data.xp).toNext} XP to ${rankProgress(me.data.xp).next!.name}`
                  : "highest rank reached"}
              </p>
            </div>
          </div>
        )}
      </main>
    </Shell>
  );
}
