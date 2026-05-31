import { CameraManager } from './camera.js';
import { GestureDetector } from './gesture.js';
import { PhysicsWorld }    from './physics.js';
import { Grabber }         from './grabber.js';
import { Renderer }        from './renderer.js';
import { createPiece, randomType, CELL } from './pieces.js';
import { buildHeart, removeHeart, detectHeartGesture } from './easter.js';

const { Body, Runner } = Matter;

// ── Config ────────────────────────────────────────────────────────────────
const MAX_PIECES    = 22;
const SPAWN_BASE    = 5000;
const SPAWN_MIN     = 1800;
const SETTLE_SPEED  = 0.36;
const SETTLE_FRAMES = 60;
const PALM_HOLD_MS  = 1200;
const FIST_HOLD_MS  = 2000;
const RING_C        = 2 * Math.PI * 18;
const ANG_DAMP      = 0.88;

// ── DOM ───────────────────────────────────────────────────────────────────
const W = window.innerWidth;
const H = window.innerHeight;

const $canvas      = document.getElementById('game-canvas');
const $video       = document.getElementById('video');
const $score       = document.getElementById('score');
const $level       = document.getElementById('level');
const $status      = document.getElementById('status');
const $loading     = document.getElementById('loading');
const $loadingMsg  = document.getElementById('loading-status');
const $pauseEl     = document.getElementById('pause-overlay');
const $flash       = document.getElementById('flash');
const $gestureHUD  = document.getElementById('gesture-hud');
const $gestureIcon = document.getElementById('gesture-icon');
const $gestureLbl  = document.getElementById('gesture-label');
const $ringArc     = document.getElementById('ring-arc');

// ── Systems ───────────────────────────────────────────────────────────────
const physics  = new PhysicsWorld(W, H);
const renderer = new Renderer($canvas, W, H);
const gesture  = new GestureDetector();
// Two independent grabbers — one per hand slot
const grabbers = [new Grabber(), new Grabber()];

// ── State ─────────────────────────────────────────────────────────────────
let score         = 0;
let level         = 1;
let settledCount  = 0;
let paused        = false;
let gestures      = [];
let lastSpawn     = -SPAWN_BASE;
let spawnInterval = SPAWN_BASE;

// Hold-gesture timers — activated only after strict classification
let palmHoldStart = 0;
let fistHoldStart = 0;

// ── Easter egg state ─────────────────────────────────────────────────────
let easterState    = 'idle';   // 'idle' | 'active'
let heartHoldStart = 0;
let easterBodies   = [];
let easterCx = 0, easterCy = 0;
let lastEmojiTime  = [0, 0];  // per-hand throttle for emoji spawning

const HEART_HOLD_MS  = 1500;
const EMOJI_INTERVAL = 110;   // ms between emojis per hand (~9/s)

// ── Helpers ───────────────────────────────────────────────────────────────
const addScore  = n => { score += n; $score.textContent = score; };
const setStatus = m => { $status.textContent = m; };
const setLevel  = n => {
  level = n; $level.textContent = `LV ${level}`;
  spawnInterval = Math.max(SPAWN_MIN, SPAWN_BASE - (level - 1) * 400);
};

// ── Snap to grid ──────────────────────────────────────────────────────────
// Snaps body so every cell centre lands on a CELL-grid intersection.
// Call BEFORE Body.setStatic to avoid physics collisions during the move.
function snapToGrid(body) {
  // 1. Snap rotation to nearest 90°
  const snapAngle = Math.round(body.angle / (Math.PI / 2)) * (Math.PI / 2);
  Body.setAngle(body, snapAngle);
  Body.setVelocity(body, { x: 0, y: 0 });
  Body.setAngularVelocity(body, 0);

  // 2. Compute uniform snap offset: average mismatch across all cells
  const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
  let dx = 0, dy = 0;
  for (const p of parts) {
    dx += Math.round(p.position.x / CELL) * CELL - p.position.x;
    dy += Math.round(p.position.y / CELL) * CELL - p.position.y;
  }
  Body.setPosition(body, {
    x: body.position.x + dx / parts.length,
    y: body.position.y + dy / parts.length,
  });

  // 3. Resolve overlap: if any cell lands on an occupied cell, push up
  resolveSnapOverlap(body);
}

// Push snapping body upward until no cell overlaps an existing settled piece.
function resolveSnapOverlap(body) {
  const settled = physics.getPieces().filter(p => p.isStatic && p !== body);
  if (!settled.length) return;

  // Build occupied-cell set from all settled pieces
  const occ = new Set();
  for (const s of settled) {
    const parts = s.parts.length > 1 ? s.parts.slice(1) : [s];
    for (const p of parts) {
      occ.add(`${Math.round(p.position.x / CELL)},${Math.round(p.position.y / CELL)}`);
    }
  }

  const myParts = body.parts.length > 1 ? body.parts.slice(1) : [body];

  for (let attempt = 0; attempt < 8; attempt++) {
    const overlapping = myParts.some(p =>
      occ.has(`${Math.round(p.position.x / CELL)},${Math.round(p.position.y / CELL)}`)
    );
    if (!overlapping) return;
    // Shift body up one row
    Body.setPosition(body, { x: body.position.x, y: body.position.y - CELL });
  }
}

// ── Spawn aligned to grid columns ─────────────────────────────────────────
function spawnPiece() {
  if (physics.getPieces().length >= MAX_PIECES) return;

  const totalCols = Math.floor(W / CELL);
  const margin    = 2;
  const col = margin + Math.floor(Math.random() * (totalCols - margin * 2));
  const piece = createPiece(randomType(), col * CELL, -90);

  // X-snap at spawn so cells are on grid columns from the start
  const parts = piece.parts.length > 1 ? piece.parts.slice(1) : [piece];
  let dx = 0;
  for (const p of parts) dx += Math.round(p.position.x / CELL) * CELL - p.position.x;
  Body.setPosition(piece, { x: piece.position.x + dx / parts.length, y: piece.position.y });

  physics.add(piece);
}

// ── Support check — prevents mid-air locking ──────────────────────────────
function isSupported(body, allPieces) {
  const bot = body.bounds.max.y;
  if (bot < H * 0.28) return false;               // too high on screen
  if (bot >= H - CELL * 0.65) return true;         // near the floor
  for (const p of allPieces) {
    if (!p.isStatic || p === body) continue;
    if (Math.abs(p.position.x - body.position.x) > CELL * 2.8) continue;
    const gap = p.bounds.min.y - bot;
    if (gap > -CELL * 0.25 && gap < CELL * 0.65) return true;
  }
  return false;
}

// ── Settle processing ─────────────────────────────────────────────────────
function processSettling(pieces) {
  const allGrabbed = new Set(grabbers.map(g => g.body).filter(Boolean));
  let anyLocked = false;

  for (const b of pieces) {
    if (b._settled || b.isStatic || allGrabbed.has(b)) continue;

    // Angular damping keeps pieces more upright → cleaner snap
    if (Math.abs(b.angularVelocity) > 0.001) {
      Body.setAngularVelocity(b, b.angularVelocity * ANG_DAMP);
    }

    const speed = Math.hypot(b.velocity.x, b.velocity.y) + Math.abs(b.angularVelocity) * 12;
    b._slowFrames = speed < SETTLE_SPEED ? b._slowFrames + 1 : 0;

    if (b._slowFrames >= SETTLE_FRAMES && isSupported(b, pieces)) {
      snapToGrid(b);           // align + resolve overlap BEFORE static
      Body.setStatic(b, true);
      b._settled    = true;
      b._slowFrames = 0;

      renderer.spawnBurst(b.position.x, b.position.y, b.pieceGlow ?? 0xffffff, 8);
      addScore(10);
      settledCount++;
      anyLocked = true;
      if (settledCount % 7 === 0) setLevel(level + 1);
    }
  }
  return anyLocked;
}

// ── Line clear ────────────────────────────────────────────────────────────
function checkLines() {
  const pieces  = physics.getPieces();
  const settled = pieces.filter(p => p.isStatic);
  if (settled.length < 3) return 0;

  const grid   = new Map();
  const rowOf  = y => Math.round(y / CELL);
  const colOf  = x => Math.round(x / CELL);
  const THRESH = Math.floor((W / CELL) * 0.80);

  for (const body of settled) {
    const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
    for (const p of parts) {
      const r = rowOf(p.position.y), c = colOf(p.position.x);
      if (!grid.has(r)) grid.set(r, new Set());
      grid.get(r).add(c);
    }
  }

  const clearedRows = [];
  for (const [row, cols] of grid) if (cols.size >= THRESH) clearedRows.push(row);
  if (!clearedRows.length) return 0;

  const minClearedY = Math.min(...clearedRows) * CELL;

  const toRemove = new Set();
  for (const body of settled) {
    const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
    for (const p of parts) {
      if (clearedRows.includes(rowOf(p.position.y))) { toRemove.add(body); break; }
    }
  }
  for (const body of toRemove) {
    renderer.spawnBurst(body.position.x, body.position.y, body.pieceGlow ?? 0xffffff, 22);
    physics.remove(body);
  }
  for (const row of clearedRows) renderer.flashRow(row * CELL);

  for (const body of physics.getPieces()) {
    if (body.isStatic && body.position.y < minClearedY) {
      Body.setStatic(body, false);
      body._settled = false; body._slowFrames = 0;
    }
  }

  const n = clearedRows.length;
  addScore(n * n * 120);
  setStatus(`消除 ${n} 行！ +${n * n * 120}`);
  return n;
}

// ── Pause / Resume ────────────────────────────────────────────────────────
function setPaused(val) {
  paused = val;
  $pauseEl.classList.toggle('visible', val);
  if (val) {
    grabbers.forEach(g => { if (g.isGrabbing()) g.release({ x:0, y:0 }); });
    Runner.stop(physics.runner);
  } else {
    Runner.run(physics.runner, physics.engine);
    lastSpawn = performance.now();
    setStatus('继续！');
  }
}

// ── Restart ───────────────────────────────────────────────────────────────
function restart() {
  grabbers.forEach(g => { if (g.isGrabbing()) g.release({ x:0, y:0 }); });
  if (paused) setPaused(false);

  // Clean up Easter egg if it was active
  if (easterState !== 'idle') {
    removeHeart(physics, easterBodies);
    easterBodies = [];
    renderer.hideSkylarText();
    renderer.setSkylarAlpha(1);
    easterState = 'idle';
  }

  for (const b of physics.getPieces()) physics.remove(b);
  score = 0; $score.textContent = '0';
  settledCount = 0; setLevel(1);
  lastSpawn = -SPAWN_BASE;
  $flash.classList.remove('pop'); void $flash.offsetWidth; $flash.classList.add('pop');
  spawnPiece();
  setStatus('重新开始！');
}

// ── Gesture HUD ───────────────────────────────────────────────────────────
const ICONS  = { open_palm:'🖐', fist:'✊', pinch:'🤏', other:'', none:'' };
const LABELS = { open_palm:'掌心 → 暂停', fist:'握拳 → 重置', pinch:'捏合中', other:'', none:'' };

function updateGestureHUD(gestures, now) {
  const primary = gestures.find(g => ['open_palm','fist'].includes(g.gesture))
               ?? gestures.find(g => g.gesture === 'pinch')
               ?? gestures[0];
  const gest = primary?.gesture ?? 'none';

  if (!gest || gest === 'none' || gest === 'other') {
    $gestureHUD.classList.remove('active');
    $ringArc.style.strokeDashoffset = RING_C;
    $ringArc.style.opacity = 0;
    return;
  }
  $gestureHUD.classList.add('active');
  $gestureIcon.textContent = ICONS[gest]  ?? '';
  $gestureLbl.textContent  = LABELS[gest] ?? '';

  let prog = 0;
  if (gest === 'open_palm' && palmHoldStart) prog = Math.min(1, (now - palmHoldStart) / PALM_HOLD_MS);
  if (gest === 'fist'      && fistHoldStart) prog = Math.min(1, (now - fistHoldStart) / FIST_HOLD_MS);

  $ringArc.style.strokeDashoffset = RING_C * (1 - prog);
  $ringArc.style.opacity = prog > 0.01 ? 1 : 0;
}

// ── Easter egg activation ─────────────────────────────────────────────────
function activateEasterEgg(now) {
  if (easterState !== 'idle') return;

  // Clear all regular pieces
  for (const b of physics.getPieces()) physics.remove(b);
  grabbers.forEach(g => { if (g.isGrabbing()) g.release({ x: 0, y: 0 }); });

  // Build heart
  const result = buildHeart(physics, W, H);
  easterBodies   = result.bodies;
  easterCx       = result.cx;
  easterCy       = result.cy;
  easterState       = 'active';
  lastEmojiTime     = [0, 0];

  // Burst at every heart block for a dazzling entrance
  for (const b of easterBodies) {
    renderer.spawnBurst(b.position.x, b.position.y, 0xFF1177, 4);
  }

  renderer.showSkylarText(easterCx, easterCy);
  renderer.setSkylarAlpha(1);

  // Suspend piece spawning while Easter egg is shown (reset on restart)
  lastSpawn = now + 9999999;
}

// ── Camera callback ───────────────────────────────────────────────────────
const cam = new CameraManager($video, results => {
  const lms   = results.multiHandLandmarks ?? [];
  const hands = results.multiHandedness    ?? [];

  // Sort by handedness so Right hand = slot 0, Left = slot 1 — stays consistent
  // even if MediaPipe swaps array order between frames.
  const sorted = lms
    .map((lm, i) => ({ lm, label: hands[i]?.label ?? 'Right' }))
    .sort((a, b) => (a.label === 'Left' ? 1 : 0) - (b.label === 'Left' ? 1 : 0));

  gestures = gesture.update(sorted.map(s => s.lm), W, H);

  const now = performance.now();

  // ── Hold gestures ────────────────────────────────────────────────────────
  const anyPalm = gestures.some(g => g.gesture === 'open_palm' && !g.pinching);
  const anyFist = gestures.some(g => g.gesture === 'fist'      && !g.pinching);

  // Palm pause is suppressed while Easter egg is showing (they share open-hand shape)
  if (anyPalm && easterState === 'idle') {
    if (!palmHoldStart) palmHoldStart = now;
    if (now - palmHoldStart >= PALM_HOLD_MS) { palmHoldStart = 0; setPaused(!paused); }
  } else { palmHoldStart = 0; }

  // Fist always works — dismisses Easter egg via restart()
  if (anyFist) {
    if (!fistHoldStart) fistHoldStart = now;
    if (now - fistHoldStart >= FIST_HOLD_MS) { fistHoldStart = 0; restart(); }
  } else { fistHoldStart = 0; }

  // ── Secret heart gesture ─────────────────────────────────────────────
  if (easterState === 'idle') {
    if (detectHeartGesture(gestures, W, H)) {
      if (!heartHoldStart) heartHoldStart = now;
      if (now - heartHoldStart >= HEART_HOLD_MS) {
        heartHoldStart = 0;
        activateEasterEgg(now);
        return;
      }
    } else {
      heartHoldStart = 0;
    }
  }

  // ── Heart emojis: pinch during Easter egg → float up and fade ───────────
  if (easterState === 'active') {
    for (const gd of gestures) {
      const hi = gd.handIndex;
      if (gd.pinching && now - lastEmojiTime[hi] > EMOJI_INTERVAL) {
        lastEmojiTime[hi] = now;
        renderer.spawnHeartEmoji(gd.pos.x, gd.pos.y);
      }
    }
  }

  if (paused) return;

  // ── Per-hand pinch / grab (fully independent) ─────────────────────────
  for (const gd of gestures) {
    const i  = gd.handIndex;
    const gr = grabbers[i];

    // Exclude pieces held by any OTHER grabber
    const takenByOthers = grabbers
      .filter((_, j) => j !== i)
      .map(g => g.body)
      .filter(Boolean);
    const available = physics.getPieces().filter(p => !takenByOthers.includes(p));

    if (gd.justPinched) {
      const ok = gr.tryGrab(gd.pos, available);
      if (ok) {
        const b = gr.body;
        // Clear settled flags — DO NOT call setStatic(false) here.
        // The body must stay static while being held by the grabber.
        // setStatic(false) happens only in Grabber.release().
        if (b?._settled) {
          b._settled    = false;
          b._slowFrames = 0;
          b.isSleeping   = false;
          b.sleepCounter = 0;
        }
        setStatus(`手 ${i + 1} 抓住了！`);
        renderer.spawnBurst(gd.pos.x, gd.pos.y, i === 0 ? 0x00e5ff : 0xff4090, 10);
      } else {
        setStatus('靠近方块再捏合');
      }

    } else if (gd.pinching && gr.isGrabbing()) {
      gr.move(gd.pos);

    } else if (gd.justReleased && gr.isGrabbing()) {
      // Release with inertia — grabber.release guarantees min downward velocity
      const b = gr.release(gd.velocity);
      if (b) renderer.spawnBurst(b.position.x, b.position.y, b.pieceGlow ?? 0x00e5ff, 14);
      setStatus('释放！');
    }
  }

  // Auto-release grabs for hands that are no longer tracked
  for (let i = 0; i < 2; i++) {
    if (!gestures.find(g => g.handIndex === i) && grabbers[i].isGrabbing()) {
      grabbers[i].release({ x:0, y:0 });
    }
  }
});

// ── Game loop ─────────────────────────────────────────────────────────────
function loop(now) {
  requestAnimationFrame(loop);

  if (!paused) {
    if (now - lastSpawn > spawnInterval) { lastSpawn = now; spawnPiece(); }

    const pieces = physics.getPieces();
    for (const b of pieces) {
      // Remove bodies that escaped the world or have NaN positions (physics corruption)
      if (b.position.y > H + 400 || isNaN(b.position.x) || isNaN(b.position.y)) {
        physics.remove(b);
      }
    }

    if (processSettling(physics.getPieces())) checkLines();
  }

  updateGestureHUD(gestures, now);

  const grabbedSet = new Set(grabbers.map(g => g.body).filter(Boolean));
  renderer.updatePieces(physics.getPieces(), grabbedSet);
  // Easter egg heart: render while active, invisible otherwise
  renderer.updateHeartBlocks(easterBodies, now, easterState === 'active' ? 1 : 0);
  renderer.updateHand(gestures);
  renderer.tickParticles(now);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
$loadingMsg.textContent = '正在请求摄像头权限...';

cam.init()
  .then(() => {
    $loading.classList.add('hidden');
    setStatus('捏合来抓取方块');
    spawnPiece();
    requestAnimationFrame(loop);
  })
  .catch(err => {
    $loadingMsg.textContent = '摄像头错误：' + err.message;
    console.error('[AirTetris]', err);
  });
