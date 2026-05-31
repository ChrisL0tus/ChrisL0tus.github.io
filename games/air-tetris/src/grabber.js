const { Body } = Matter;

export class Grabber {
  constructor() {
    this.body    = null;
    this._offset = { x: 0, y: 0 };
    this.GRAB_RADIUS = 110;
  }

  tryGrab(pos, pieces) {
    let best = null, bestDist = this.GRAB_RADIUS;
    for (const p of pieces) {
      const d = Math.hypot(p.position.x - pos.x, p.position.y - pos.y);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    if (!best) return false;

    this.body    = best;
    this._offset = { x: best.position.x - pos.x, y: best.position.y - pos.y };

    // IMPORTANT: only call setStatic(true) if the body is currently DYNAMIC.
    // Calling setStatic(true) on an already-static body overwrites _original
    // with {mass: Infinity, ...}. Then setStatic(false) on release restores
    // those Infinity values → mass=Infinity, inverseMass=0 → NaN physics.
    if (!best.isStatic) {
      Body.setStatic(best, true);
    }

    return true;
  }

  move(pos) {
    if (!this.body) return;
    Body.setPosition(this.body, {
      x: pos.x + this._offset.x,
      y: pos.y + this._offset.y,
    });
  }

  release(vel) {
    if (!this.body) return null;
    const b = this.body;
    this.body = null;

    // Restore to fully dynamic state.
    // setStatic(false) is safe here in all cases:
    // - body was dynamic before grab → setStatic(true) saved real _original → restores correctly
    // - body was already static (settled) → tryGrab skipped setStatic(true),
    //   so _original still has the real physics values → restores correctly
    Body.setStatic(b, false);

    // Clear any sleep state so the body immediately participates in physics
    b.isSleeping   = false;
    b.sleepCounter = 0;

    // Apply velocity; guarantee at least a small downward push so a
    // gently-released piece always free-falls under gravity
    Body.setVelocity(b, {
      x: vel.x * 0.28,
      y: Math.max(vel.y * 0.28, 0.8),
    });
    Body.setAngularVelocity(b, vel.x * 0.006);

    return b;
  }

  isGrabbing() { return this.body !== null; }
}
