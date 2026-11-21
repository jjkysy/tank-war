import { useEffect, useRef, useState } from "react";
import { trpc } from "@/_core/trpc";
import { Button } from "@/components/ui/button";
import {
  TUNING_LABELS,
  VIEW_MODE_LABELS,
  VIEW_MODES,
  formatTuningValue,
  type SupervisorReply,
  type TuningConfig,
  type ViewMode,
} from "@shared/tank";

const QUICK = [
  "Too hard — ease off",
  "Too easy, more enemies",
  "Make me faster",
  "Enemies are too accurate",
  "Switch to isometric view",
  "Pull back to tactical view",
  "Bigger arena please",
];

interface Props {
  config: TuningConfig;
  roundId: string | null;
  onApplied: (config: TuningConfig) => void;
  onNextRound: () => void;
  roundOver: boolean;
}

export default function SupervisorPanel({ config, roundId, onApplied, onNextRound, roundOver }: Props) {
  const [text, setText] = useState("");
  const [reply, setReply] = useState<SupervisorReply | null>(null);
  const [lastPlayerText, setLastPlayerText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const status = trpc.supervisor.status.useQuery();
  const ask = trpc.supervisor.ask.useMutation();
  const setTuning = trpc.tuning.set.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [reply]);

  async function submit(body: string) {
    const trimmed = body.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await ask.mutateAsync({ feedback: trimmed, roundId });
      setLastPlayerText(trimmed);
      setReply(res as SupervisorReply);
      onApplied(res.config as TuningConfig);
      setText("");
      void utils.player.patches.invalidate();
      void utils.player.feedback.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The supervisor did not answer.");
    } finally {
      setBusy(false);
    }
  }

  async function switchView(mode: ViewMode) {
    setBusy(true);
    setError(null);
    try {
      const res = await setTuning.mutateAsync({ viewMode: mode });
      onApplied(res.config as TuningConfig);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the view.");
    } finally {
      setBusy(false);
    }
  }

  const llm = status.data?.llmConfigured ?? false;

  return (
    <section className="panel mt-4 overflow-hidden">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-secondary/40 px-4 py-2.5">
        <span className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
          </span>
          <span className="hud-label text-signal">Supervisor channel</span>
        </span>

        <span
          className={`hud-label border px-2 py-1 ${
            llm ? "border-signal/40 text-signal" : "border-primary/40 text-primary"
          }`}
          title={
            llm
              ? "An LLM key is configured — feedback goes to the backend model."
              : "No LLM_API_KEY set — the built-in heuristic supervisor is answering."
          }
        >
          {llm ? "LLM agent" : "Heuristic agent"}
        </span>

        <span className="hud-label ml-auto text-muted-foreground">
          tuning v{reply?.version ?? "—"} · {VIEW_MODE_LABELS[config.viewMode]}
        </span>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
        {/* left: conversation */}
        <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
          <div ref={logRef} className="max-h-56 space-y-3 overflow-y-auto pr-1">
            {!reply && (
              <div className="panel-inset p-3">
                <p className="hud-label mb-1.5 text-signal">Supervisor</p>
                <p className="text-sm leading-relaxed text-secondary-foreground">
                  Round complete. Tell me how it felt — too hard, too slow, wrong camera — and I will
                  retune the next round before you deploy. Every change is bounded and applied
                  immediately.
                </p>
              </div>
            )}

            {reply && (
              <>
                <div className="panel-inset border-primary/30 p-3">
                  <p className="hud-label mb-1.5 text-primary">You</p>
                  <p className="text-sm leading-relaxed text-foreground">{lastPlayerText}</p>
                </div>
                <div className="panel-inset border-signal/30 p-3">
                  <p className="hud-label mb-1.5 text-signal">
                    Supervisor · {reply.source === "llm" ? "LLM" : "heuristic"}
                  </p>
                  <p className="text-sm leading-relaxed text-secondary-foreground">{reply.message}</p>
                  {Object.keys(reply.patch).length > 0 ? (
                    <ul className="mt-2.5 space-y-1">
                      {Object.entries(reply.patch).map(([k, v]) => (
                        <li key={k} className="flex items-baseline justify-between gap-3 border-t border-border/60 pt-1">
                          <span className="hud-label">{TUNING_LABELS[k as keyof TuningConfig]}</span>
                          <span className="hud-value text-xs text-signal">
                            {formatTuningValue(k as keyof TuningConfig, v as TuningConfig[keyof TuningConfig])}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="hud-label mt-2 text-muted-foreground">no tuning change</p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* quick chips */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button key={q} className="chip" disabled={busy} onClick={() => void submit(q)}>
                {q}
              </button>
            ))}
          </div>

          {/* input */}
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(text);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Tell the supervisor what to change…"
              maxLength={1000}
              className="hud-value h-10 flex-1 border border-input bg-input/60 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary"
            />
            <Button type="submit" disabled={busy || !text.trim()} className="hud-label h-10 px-4">
              {busy ? "Tuning…" : "Send"}
            </Button>
          </form>

          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>

        {/* right: live config + view switch */}
        <div className="p-4">
          <p className="hud-label mb-2">Live tuning</p>
          <dl className="space-y-1.5">
            {(Object.keys(TUNING_LABELS) as (keyof TuningConfig)[]).map((k) => (
              <div key={k} className="flex items-baseline justify-between gap-2 border-b border-border/50 pb-1">
                <dt className="hud-label">{TUNING_LABELS[k]}</dt>
                <dd className="hud-value text-xs text-foreground">
                  {formatTuningValue(k, config[k])}
                </dd>
              </div>
            ))}
          </dl>

          <p className="hud-label mb-2 mt-4">Camera</p>
          <div className="grid grid-cols-3 gap-1.5">
            {VIEW_MODES.map((m) => (
              <button
                key={m}
                className={`chip ${config.viewMode === m ? "border-primary text-primary" : ""}`}
                disabled={busy}
                onClick={() => void switchView(m)}
              >
                {m === "topdown" ? "Top" : m === "isometric" ? "Iso" : "Tac"}
              </button>
            ))}
          </div>

          <Button
            className="hud-label mt-4 h-10 w-full"
            onClick={onNextRound}
            disabled={!roundOver}
            variant={roundOver ? "default" : "outline"}
          >
            {roundOver ? "Deploy next round" : "Round in progress"}
          </Button>
        </div>
      </div>
    </section>
  );
}
