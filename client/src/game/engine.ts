// ── Tank War — game engine ──────────────────────────────────────────────────
// A deterministic, framework-free simulation. The React page owns the canvas
// and the input; this module owns the rules. Keeping it separate means the
// mechanics can be unit-tested and the supervisor's tuning values have exactly
// one place they take effect.
import type { TuningConfig, ViewMode } from "../../../shared/tank";

export interface Vec {
  x: number;
  y: number;
}

export interface Tank {
  id: number;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  cooldown: number;
  /** Enemy strafe direction, flipped on a timer. */
  strafe: number;
  strafeTimer: number;
}

export interface Bullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fromPlayer: boolean;
  life: number;
}

export interface Input {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  firing: boolean;
  /** Aim point in WORLD coordinates. */
  aim: Vec;
}

export interface GameState {
  player: Tank;
  enemies: Tank[];
  bullets: Bullet[];
  score: number;
  kills: number;
  wave: number;
  elapsed: number;
  over: boolean;
  outcome: "destroyed" | "cleared";
  /** Set when a wave is cleared, so the page can flash a banner. */
  waveClearedAt: number | null;
  nextId: number;
  spawnTimer: number;
}

export const PLAYER_RADIUS = 15;
export const ENEMY_RADIUS = 15;
export const BULLET_RADIUS = 3.5;
export const BULLET_SPEED = 430;
export const PLAYER_MAX_HP = 100;
export const ENEMY_HP = 30;

export function createGame(config: TuningConfig): GameState {
  const c = config.arenaSize / 2;
  return {
    player: {
      id: 0,
      x: c,
      y: c,
      angle: -Math.PI / 2,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      cooldown: 0,
      strafe: 1,
      strafeTimer: 0,
    },
    enemies: [],
    bullets: [],
    score: 0,
    kills: 0,
    wave: 1,
    elapsed: 0,
    over: false,
    outcome: "destroyed",
    waveClearedAt: null,
    nextId: 1,
    spawnTimer: 0,
  };
}

function spawnEnemy(state: GameState, config: TuningConfig): Tank {
  const size = config.arenaSize;
  const margin = 60;
  const edge = Math.floor(Math.random() * 4);
  let x = 0;
  let y = 0;
  if (edge === 0) {
    x = margin + Math.random() * (size - margin * 2);
    y = margin;
  } else if (edge === 1) {
    x = size - margin;
    y = margin + Math.random() * (size - margin * 2);
  } else if (edge === 2) {
    x = margin + Math.random() * (size - margin * 2);
    y = size - margin;
  } else {
    x = margin;
    y = margin + Math.random() * (size - margin * 2);
  }
  return {
    id: state.nextId++,
    x,
    y,
    angle: 0,
    hp: ENEMY_HP,
    maxHp: ENEMY_HP,
    cooldown: 0.6 + Math.random() * 0.8,
    strafe: Math.random() < 0.5 ? -1 : 1,
    strafeTimer: 1 + Math.random() * 2,
  };
}

/** How many enemies this wave should hold. Grows slowly with the wave number. */
export function waveEnemyCount(config: TuningConfig, wave: number): number {
  return Math.min(12, config.enemyCount + Math.floor((wave - 1) / 2));
}

function clampToArena(v: number, size: number, r: number) {
  return Math.min(size - r, Math.max(r, v));
}

function dist(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Advance the simulation by `dt` seconds. Pure with respect to `config` — the
 * tuning values are read fresh every step, which is what makes a supervisor
 * patch take effect on the very next frame.
 */
export function step(state: GameState, dt: number, input: Input, config: TuningConfig): GameState {
  if (state.over) return state;
  const size = config.arenaSize;
  state.elapsed += dt;

  // ── player movement ──────────────────────────────────────────────────────
  const p = state.player;
  let mx = 0;
  let my = 0;
  if (input.up) my -= 1;
  if (input.down) my += 1;
  if (input.left) mx -= 1;
  if (input.right) mx += 1;
  if (mx || my) {
    const len = Math.hypot(mx, my);
    p.x += (mx / len) * config.playerSpeed * dt;
    p.y += (my / len) * config.playerSpeed * dt;
  }
  p.x = clampToArena(p.x, size, PLAYER_RADIUS);
  p.y = clampToArena(p.y, size, PLAYER_RADIUS);
  p.angle = Math.atan2(input.aim.y - p.y, input.aim.x - p.x);

  // ── player firing ────────────────────────────────────────────────────────
  p.cooldown -= dt;
  if (input.firing && p.cooldown <= 0) {
    p.cooldown = 1 / config.playerFireRate;
    state.bullets.push({
      id: state.nextId++,
      x: p.x + Math.cos(p.angle) * (PLAYER_RADIUS + 6),
      y: p.y + Math.sin(p.angle) * (PLAYER_RADIUS + 6),
      vx: Math.cos(p.angle) * BULLET_SPEED,
      vy: Math.sin(p.angle) * BULLET_SPEED,
      fromPlayer: true,
      life: 2.2,
    });
  }

  // ── wave spawning ────────────────────────────────────────────────────────
  const target = waveEnemyCount(config, state.wave);
  if (state.enemies.length < target) {
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      state.enemies.push(spawnEnemy(state, config));
      state.spawnTimer = 0.55;
    }
  } else {
    state.spawnTimer = 0;
  }

  // ── enemy AI ─────────────────────────────────────────────────────────────
  for (const e of state.enemies) {
    const d = dist(e, p);
    const toPlayer = Math.atan2(p.y - e.y, p.x - e.x);
    e.angle = toPlayer;

    // Close in when far, back off when too close, strafe in between.
    const desired = 190;
    let ax = 0;
    let ay = 0;
    if (d > desired + 40) {
      ax = Math.cos(toPlayer);
      ay = Math.sin(toPlayer);
    } else if (d < desired - 60) {
      ax = -Math.cos(toPlayer);
      ay = -Math.sin(toPlayer);
    } else {
      ax = Math.cos(toPlayer + Math.PI / 2) * e.strafe;
      ay = Math.sin(toPlayer + Math.PI / 2) * e.strafe;
    }
    e.strafeTimer -= dt;
    if (e.strafeTimer <= 0) {
      e.strafe *= -1;
      e.strafeTimer = 1.2 + Math.random() * 2;
    }
    e.x += ax * config.enemySpeed * dt;
    e.y += ay * config.enemySpeed * dt;
    e.x = clampToArena(e.x, size, ENEMY_RADIUS);
    e.y = clampToArena(e.y, size, ENEMY_RADIUS);

    // Fire. Accuracy decides whether the shot is aimed or jittered.
    e.cooldown -= dt;
    if (e.cooldown <= 0 && d < 620) {
      e.cooldown = 1 / config.enemyFireRate;
      const aimed = Math.random() < config.enemyAccuracy;
      const spread = aimed ? 0.06 : 0.55;
      const a = toPlayer + (Math.random() - 0.5) * 2 * spread;
      state.bullets.push({
        id: state.nextId++,
        x: e.x + Math.cos(a) * (ENEMY_RADIUS + 6),
        y: e.y + Math.sin(a) * (ENEMY_RADIUS + 6),
        vx: Math.cos(a) * BULLET_SPEED * 0.82,
        vy: Math.sin(a) * BULLET_SPEED * 0.82,
        fromPlayer: false,
        life: 2.4,
      });
    }
  }

  // ── bullets ──────────────────────────────────────────────────────────────
  const survivors: Bullet[] = [];
  for (const b of state.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0) continue;
    if (b.x < -20 || b.y < -20 || b.x > size + 20 || b.y > size + 20) continue;

    if (b.fromPlayer) {
      let hit = false;
      for (const e of state.enemies) {
        if (dist(b, e) < ENEMY_RADIUS + BULLET_RADIUS) {
          e.hp -= 12;
          hit = true;
          break;
        }
      }
      if (hit) continue;
    } else {
      if (dist(b, p) < PLAYER_RADIUS + BULLET_RADIUS) {
        p.hp -= 9;
        continue;
      }
    }
    survivors.push(b);
  }
  state.bullets = survivors;

  // ── deaths ───────────────────────────────────────────────────────────────
  const alive: Tank[] = [];
  for (const e of state.enemies) {
    if (e.hp <= 0) {
      state.kills += 1;
      state.score += 100 + state.wave * 10;
    } else {
      alive.push(e);
    }
  }
  state.enemies = alive;

  // ── wave clear ───────────────────────────────────────────────────────────
  if (state.enemies.length === 0 && state.waveClearedAt === null && state.elapsed > 1) {
    state.waveClearedAt = state.elapsed;
    state.score += 250;
  }
  if (state.waveClearedAt !== null && state.elapsed - state.waveClearedAt > 1.6) {
    state.wave += 1;
    state.waveClearedAt = null;
    state.spawnTimer = 0.4;
  }

  // ── player death ─────────────────────────────────────────────────────────
  if (p.hp <= 0) {
    p.hp = 0;
    state.over = true;
    state.outcome = "destroyed";
  }

  return state;
}

// ── Rendering ───────────────────────────────────────────────────────────────

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Projection for each view mode. Top-down is a straight fit; isometric squashes
 * Y and shears X to read as 2.5D; tactical zooms out and adds a vignette so the
 * whole arena is legible.
 */
export function projectionFor(mode: ViewMode, arenaSize: number, vp: Viewport) {
  const pad = 24;
  const base = Math.min((vp.width - pad * 2) / arenaSize, (vp.height - pad * 2) / arenaSize);
  if (mode === "isometric") {
    return { scale: base * 0.92, squashY: 0.62, shear: 0.34, offsetX: 0, offsetY: 0 };
  }
  if (mode === "tactical") {
    return { scale: base * 0.78, squashY: 1, shear: 0, offsetX: 0, offsetY: 0 };
  }
  return { scale: base, squashY: 1, shear: 0, offsetX: 0, offsetY: 0 };
}

export function worldToScreen(
  x: number,
  y: number,
  arenaSize: number,
  vp: Viewport,
  mode: ViewMode,
): Vec {
  const p = projectionFor(mode, arenaSize, vp);
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  const half = arenaSize / 2;
  const dx = x - half;
  const dy = y - half;
  // Isometric: shear X by Y, then squash Y.
  const sx = dx + dy * p.shear;
  const sy = dy * p.squashY;
  return { x: cx + sx * p.scale, y: cy + sy * p.scale };
}

export function screenToWorld(
  sx: number,
  sy: number,
  arenaSize: number,
  vp: Viewport,
  mode: ViewMode,
): Vec {
  const p = projectionFor(mode, arenaSize, vp);
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  const half = arenaSize / 2;
  const px = (sx - cx) / p.scale;
  const py = (sy - cy) / p.scale;
  const dy = py / p.squashY;
  const dx = px - dy * p.shear;
  return { x: dx + half, y: dy + half };
}

function drawTank(
  ctx: CanvasRenderingContext2D,
  t: Tank,
  isPlayer: boolean,
  arenaSize: number,
  vp: Viewport,
  mode: ViewMode,
) {
  const s = worldToScreen(t.x, t.y, arenaSize, vp, mode);
  const p = projectionFor(mode, arenaSize, vp);
  const r = (isPlayer ? PLAYER_RADIUS : ENEMY_RADIUS) * p.scale;
  const body = isPlayer ? "#f5a524" : "#c4553f";
  const dark = isPlayer ? "#8a5c10" : "#6d2c20";

  ctx.save();
  ctx.translate(s.x, s.y);

  // Shadow / ground contact
  ctx.beginPath();
  ctx.ellipse(0, r * 0.55, r * 1.05, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fill();

  // Tracks
  ctx.fillStyle = dark;
  ctx.fillRect(-r * 1.05, -r * 0.95, r * 0.42, r * 1.9);
  ctx.fillRect(r * 0.63, -r * 0.95, r * 0.42, r * 1.9);

  // Hull
  ctx.beginPath();
  ctx.rect(-r * 0.72, -r * 0.82, r * 1.44, r * 1.64);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Turret + barrel, rotated to the tank's facing
  ctx.rotate(t.angle);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
  ctx.fillStyle = isPlayer ? "#ffc65c" : "#e07a5f";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.stroke();

  ctx.fillStyle = dark;
  ctx.fillRect(r * 0.3, -r * 0.13, r * 1.15, r * 0.26);
  ctx.restore();

  // HP bar for enemies
  if (!isPlayer && t.hp < t.maxHp) {
    const w = r * 2;
    const h = 3;
    const bx = s.x - w / 2;
    const by = s.y - r * 1.5;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = "#d94f3d";
    ctx.fillRect(bx, by, w * Math.max(0, t.hp / t.maxHp), h);
  }
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  config: TuningConfig,
  vp: Viewport,
) {
  const mode = config.viewMode;
  const size = config.arenaSize;
  const p = projectionFor(mode, size, vp);

  ctx.clearRect(0, 0, vp.width, vp.height);

  // Arena floor
  const tl = worldToScreen(0, 0, size, vp, mode);
  const br = worldToScreen(size, size, size, vp, mode);
  const ax = Math.min(tl.x, br.x);
  const ay = Math.min(tl.y, br.y);
  const aw = Math.abs(br.x - tl.x);
  const ah = Math.abs(br.y - tl.y);

  ctx.fillStyle = "#0c110a";
  ctx.fillRect(ax, ay, aw, ah);

  // Grid
  ctx.strokeStyle = "rgba(38,48,31,0.85)";
  ctx.lineWidth = 1;
  const cells = 12;
  for (let i = 0; i <= cells; i++) {
    const t = (i / cells) * size;
    const a = worldToScreen(t, 0, size, vp, mode);
    const b = worldToScreen(t, size, size, vp, mode);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const c = worldToScreen(0, t, size, vp, mode);
    const d = worldToScreen(size, t, size, vp, mode);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }

  // Arena border
  ctx.strokeStyle = "#3d4a2e";
  ctx.lineWidth = 2;
  ctx.strokeRect(ax, ay, aw, ah);

  // Bullets
  for (const b of state.bullets) {
    const s = worldToScreen(b.x, b.y, size, vp, mode);
    const r = Math.max(2, BULLET_RADIUS * p.scale);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = b.fromPlayer ? "#ffd479" : "#ff7a5c";
    ctx.shadowColor = b.fromPlayer ? "#f5a524" : "#d94f3d";
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Enemies then player (player on top)
  for (const e of state.enemies) drawTank(ctx, e, false, size, vp, mode);
  drawTank(ctx, state.player, true, size, vp, mode);

  // Tactical mode: corner minimap frame
  if (mode === "tactical") {
    ctx.strokeStyle = "rgba(126,231,135,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(ax - 6, ay - 6, aw + 12, ah + 12);
  }
}
