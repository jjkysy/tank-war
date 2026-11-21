# Tank War — a game that retunes itself

A 2D tank battle game with a **supervisor agent** that reads your feedback after every round and
patches the next one before you deploy. Accounts and ranks live in Postgres; the frontend is a
canvas renderer; the supervisor runs on the backend.

## The supervised loop

1. **Fight a round** — top-down arena, enemy tanks closing in, waves that escalate.
2. **Report to the supervisor** — type or tap feedback in the panel directly beneath the canvas.
3. **Deploy retuned** — the agent returns a bounded JSON patch, applied to the very next round.

The supervisor has two paths, and the panel always says which one ran:

| Path | When | What it does |
|---|---|---|
| **LLM agent** | `LLM_API_KEY` is set | Sends the feedback, the current tuning and the last five rounds to an OpenAI-compatible chat endpoint and parses a JSON patch back. |
| **Heuristic agent** | No key, or the LLM call fails | A real rule-based supervisor that parses the feedback text for intent and produces a genuine patch. Not a mock — it reads the words you wrote. |

**Every patch from either path passes through one gate** (`applyPatch` in `shared/tank.ts`), which
drops unknown keys and clamps every number to `TUNING_BOUNDS`. The LLM cannot escape the bounds.

### What the supervisor can change

| Dial | Range |
|---|---|
| Enemy count | 1–12 per wave |
| Enemy speed | 20–220 px/s |
| Enemy fire rate | 0.05–3 /s |
| Enemy accuracy | 0–100% |
| Player speed | 60–320 px/s |
| Player fire rate | 0.4–6 /s |
| Arena size | 500–1600 u |
| **View mode** | top-down · isometric 2.5D · tactical zoom |

The camera is a projection switch, not a second engine — the same simulation renders through three
different transforms, so the supervisor can change the view mid-session.

## Stack

- **Frontend** — React + Vite + Tailwind v4, canvas 2D renderer (`client/src/game/engine.ts`)
- **API** — tRPC over Hono (`server/routers.ts`)
- **Database** — Postgres via Drizzle (`drizzle/schema.ts`)
- **Auth** — email + password, session cookie
- **CI/CD** — GitHub Actions (`.github/workflows/ci.yml`)

## Data model

| Table | Holds |
|---|---|
| `profiles` | callsign, XP, rank, rounds played, best score — one row per player |
| `tuning` | the live config the game reads, plus a version counter |
| `rounds` | one row per finished round, with the tuning snapshot it was played under |
| `feedback` | the supervisor conversation — player messages and agent replies |
| `patches` | every tuning change the supervisor made, with its source and diff |

Rank is derived from XP against the ladder in `shared/tank.ts` (Recruit → General) and written back
on each round, so the leaderboard is a single indexed read.

## Running it

```bash
pnpm install
pnpm db:migrate      # apply migrations to your database
pnpm dev             # API + Vite dev server
```

Environment:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | session cookie signing |
| `LLM_API_KEY` | *optional* — enables the LLM supervisor. Without it the heuristic agent answers. |
| `LLM_BASE_URL` | *optional* — defaults to `https://api.openai.com/v1` |
| `LLM_MODEL` | *optional* — defaults to `gpt-4o-mini` |

Secrets are read from the environment and never committed.

## Tests

```bash
pnpm typecheck
pnpm test
```

The suite covers the bounded-patch contract (clamping, unknown keys, invalid view modes), the rank
ladder, and the supervisor's intent parsing — including a regression test for the case where
"too hard" used to trip both the harder and easier rules and cancel itself out.

## CI/CD

`.github/workflows/ci.yml` runs on every push and pull request to `main`/`master`:
install → typecheck → unit tests → production build, then uploads the build output as an artifact.
The build uses a placeholder `DATABASE_URL` because no database is contacted at build time.

## Out of scope

No multiplayer, no 3D engine (the view modes are projections of the same 2D simulation), and no
payments or email.
