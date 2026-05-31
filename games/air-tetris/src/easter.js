// ── Secret Easter egg ─────────────────────────────────────────────────────
// Triggered by bringing both hands' raised index fingertips together.
// No mention of this feature in README or hints.

import { CELL } from './pieces.js';

const { Bodies } = Matter;

// 11 rows × 13 cols pixel-art heart (axis of symmetry at col 6)
export const HEART_GRID = [
  [0,0,1,1,1,0,0,0,1,1,1,0,0],
  [0,1,1,1,1,1,0,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1],
  [0,1,1,1,1,1,1,1,1,1,1,1,0],
  [0,0,1,1,1,1,1,1,1,1,1,0,0],
  [0,0,0,1,1,1,1,1,1,1,0,0,0],
  [0,0,0,0,1,1,1,1,1,0,0,0,0],
  [0,0,0,0,0,1,1,1,0,0,0,0,0],
  [0,0,0,0,0,0,1,0,0,0,0,0,0],
];

// Build all heart blocks as static bodies in the physics world.
// Returns { bodies, cx, cy } where cx/cy is the visual centre.
export function buildHeart(physics, W, H) {
  const ROWS = HEART_GRID.length;     // 11
  const COLS = HEART_GRID[0].length;  // 13

  const ox = (W - COLS * CELL) / 2;
  const oy = (H - ROWS * CELL) / 2;

  const bodies = [];

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!HEART_GRID[r][c]) continue;

      const bx = ox + c * CELL + CELL / 2;
      const by = oy + r * CELL + CELL / 2;

      const b = Bodies.rectangle(bx, by, CELL - 4, CELL - 4, {
        isStatic: true,
        label: 'heart',
        chamfer: { radius: 6 },
        // Heart blocks don't collide with game pieces
        collisionFilter: { category: 0x0002, mask: 0x0000 },
      });

      b.pieceColor = 0xFF1177;
      b.pieceGlow  = 0xFF0044;
      b._isHeart   = true;

      physics.add(b);
      bodies.push(b);
    }
  }

  return {
    bodies,
    cx: ox + COLS * CELL / 2,
    cy: oy + ROWS * CELL / 2,
  };
}

export function removeHeart(physics, bodies) {
  for (const b of bodies) physics.remove(b);
}

// Detect: both hands' index fingers raised and tips touching (< 130 px apart).
export function detectHeartGesture(gestures, W, H) {
  if (gestures.length < 2) return false;

  const g0 = gestures.find(g => g.handIndex === 0 && g.landmarks);
  const g1 = gestures.find(g => g.handIndex === 1 && g.landmarks);
  if (!g0 || !g1 || g0.pinching || g1.pinching) return false;

  const lm0 = g0.landmarks, lm1 = g1.landmarks;

  // Both index fingers must be clearly extended
  if (lm0[8].y >= lm0[6].y || lm1[8].y >= lm1[6].y) return false;

  // Index tips must be close together (screen-space, x is mirrored)
  const x0 = (1 - lm0[8].x) * W, y0 = lm0[8].y * H;
  const x1 = (1 - lm1[8].x) * W, y1 = lm1[8].y * H;

  return Math.hypot(x0 - x1, y0 - y1) < 130;
}
