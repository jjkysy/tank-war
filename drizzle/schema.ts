import { pgTable, uuid, text, timestamp, index, bigint, integer, jsonb } from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM TABLE — managed by the scaffold. The Agent MUST NOT redefine or drop
// the auth columns here; it only ADDS business tables below.
// ─────────────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"), // null for SSO-linked users (future)
  name: text("name"),
  role: text("role").notNull().default("user"), // 'user' | 'admin'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// SYSTEM TABLE — managed by the scaffold, written by server/_core/storage.ts.
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    contentType: text("content_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("files_owner_idx").on(t.ownerId), index("files_created_idx").on(t.createdAt)],
);

// ─────────────────────────────────────────────────────────────────────────────
// TANK WAR business tables
// ─────────────────────────────────────────────────────────────────────────────

// One row per player. Rank is stored (not derived on read) so the leaderboard
// is a single indexed query.
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    callsign: text("callsign").notNull(),
    xp: integer("xp").notNull().default(0),
    rank: text("rank").notNull().default("Recruit"),
    roundsPlayed: integer("rounds_played").notNull().default(0),
    bestScore: integer("best_score").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("profiles_xp_idx").on(t.xp), index("profiles_rank_idx").on(t.rank)],
);

// The live tuning config the game reads. One row per player.
export const tuning = pgTable(
  "tuning",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    config: jsonb("config").notNull(),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tuning_user_idx").on(t.userId)],
);

// One row per completed round.
export const rounds = pgTable(
  "rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: integer("score").notNull().default(0),
    kills: integer("kills").notNull().default(0),
    wave: integer("wave").notNull().default(1),
    survivedSeconds: integer("survived_seconds").notNull().default(0),
    outcome: text("outcome").notNull().default("destroyed"), // 'destroyed' | 'cleared'
    tuningSnapshot: jsonb("tuning_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rounds_user_idx").on(t.userId), index("rounds_created_idx").on(t.createdAt)],
);

// The supervisor conversation: player feedback and the agent's reply.
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roundId: uuid("round_id").references(() => rounds.id, { onDelete: "set null" }),
    role: text("role").notNull(), // 'player' | 'supervisor'
    body: text("body").notNull(),
    patch: jsonb("patch"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feedback_user_idx").on(t.userId), index("feedback_round_idx").on(t.roundId)],
);

// Every tuning change the supervisor made, and why.
export const patches = pgTable(
  "patches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // 'llm' | 'heuristic'
    summary: text("summary").notNull(),
    diff: jsonb("diff").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("patches_user_idx").on(t.userId)],
);
