const { Body, Bodies } = Matter;

export const CELL = 54;   // bigger blocks feel better to grab

export const TYPES = {
  I: { cells: [[-1.5,0],[-0.5,0],[0.5,0],[1.5,0]], color: 0x00E5FF, glow: 0x0091EA },
  O: { cells: [[-0.5,-0.5],[0.5,-0.5],[-0.5,0.5],[0.5,0.5]], color: 0xFFEA00, glow: 0xFFC400 },
  T: { cells: [[-1,0],[0,0],[1,0],[0,-1]], color: 0xD500F9, glow: 0xAA00FF },
  S: { cells: [[-1,0],[0,0],[0,-1],[1,-1]], color: 0x00E676, glow: 0x00C853 },
  Z: { cells: [[1,0],[0,0],[0,-1],[-1,-1]], color: 0xFF1744, glow: 0xD50000 },
  J: { cells: [[-1,-1],[-1,0],[0,0],[1,0]], color: 0x2979FF, glow: 0x2962FF },
  L: { cells: [[1,-1],[-1,0],[0,0],[1,0]], color: 0xFF6D00, glow: 0xE65100 },
};

export function createPiece(type, x, y) {
  const def = TYPES[type];

  const parts = def.cells.map(([cx, cy]) =>
    Bodies.rectangle(
      x + cx * CELL,
      y + cy * CELL,
      CELL - 5,
      CELL - 5,
      { chamfer: { radius: 7 } }
    )
  );

  const compound = Body.create({
    parts,
    restitution: 0.02,
    friction: 0.95,
    frictionStatic: 1.1,
    frictionAir: 0.045,
    density: 0.003,
    label: 'piece',
    sleepThreshold: 30,
  });

  compound.pieceType   = type;
  compound.pieceColor  = def.color;
  compound.pieceGlow   = def.glow;
  compound._settled    = false;
  compound._slowFrames = 0;

  return compound;
}

const typeKeys = Object.keys(TYPES);
export function randomType() {
  return typeKeys[Math.floor(Math.random() * typeKeys.length)];
}
