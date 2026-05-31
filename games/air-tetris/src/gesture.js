// Two independent hand slots.  update() returns an array (0–2 items).
export class GestureDetector {
  constructor() {
    this._hands = [this._mkSlot(), this._mkSlot()];
  }

  _mkSlot() {
    return {
      pinching: false, pinchPos: { x:0, y:0 },
      velocity: { x:0, y:0 },
      _prev: null, _prevTime: 0, _velBuf: [],
      // Gesture stability: must see same gesture N frames before reporting it
      _rawGesture: 'other', _stableFrames: 0, _confirmedGesture: 'other',
    };
  }

  // ── Strict classification using MCP joints ────────────────────────────────
  // Tip must be CLEARLY above/below MCP — avoids triggering on relaxed hands.
  _classify(lm) {
    // Metacarpophalangeal (knuckle) indices: index=5, middle=9, ring=13, pinky=17
    // Fingertip indices:                     index=8, middle=12, ring=16, pinky=20
    const EXTEND = 0.07;   // tip must be ≥7% frame-height above MCP
    const CURL   = 0.05;   // tip must be ≥5% frame-height below MCP

    const ext = (tip, mcp) => lm[tip].y < lm[mcp].y - EXTEND;
    const cur = (tip, mcp) => lm[tip].y > lm[mcp].y + CURL;

    if (ext(8,5) && ext(12,9) && ext(16,13) && ext(20,17)) return 'open_palm';
    if (cur(8,5) && cur(12,9) && cur(16,13) && cur(20,17)) return 'fist';
    return 'other';
  }

  _processSlot(s, lm, W, H, now) {
    const thumb = lm[4], index = lm[8];
    const dist  = Math.hypot(thumb.x - index.x, thumb.y - index.y);

    // Mirror x for CSS-flipped video
    const cx = (1 - (thumb.x + index.x) / 2) * W;
    const cy = ((thumb.y + index.y) / 2) * H;

    // Rolling velocity average
    if (s._prev) {
      const dt = Math.max(now - s._prevTime, 1);
      s._velBuf.push({ vx: ((cx - s._prev.x)/dt)*16, vy: ((cy - s._prev.y)/dt)*16 });
      if (s._velBuf.length > 8) s._velBuf.shift();
      s.velocity = {
        x: s._velBuf.reduce((a,v)=>a+v.vx,0)/s._velBuf.length,
        y: s._velBuf.reduce((a,v)=>a+v.vy,0)/s._velBuf.length,
      };
    }
    s._prev = { x:cx, y:cy };
    s._prevTime = now;

    const was    = s.pinching;
    s.pinching   = dist < (was ? 0.078 : 0.055);
    s.pinchPos   = { x:cx, y:cy };

    // Gesture stability: require STABLE_FRAMES consecutive frames of same raw gesture
    const STABLE = 6;
    const rawGesture = s.pinching ? 'pinch' : this._classify(lm);

    if (rawGesture === s._rawGesture) {
      s._stableFrames = Math.min(s._stableFrames + 1, STABLE);
    } else {
      s._rawGesture   = rawGesture;
      s._stableFrames = 1;
    }

    // Pinch is immediate; open_palm and fist need stable detection
    if (rawGesture === 'pinch' || s._stableFrames >= STABLE) {
      s._confirmedGesture = rawGesture;
    }
    // 'other' resets confirmation immediately (don't hold stale gesture)
    if (rawGesture === 'other') s._confirmedGesture = 'other';

    return {
      pinching:     s.pinching,
      justPinched:  !was && s.pinching,
      justReleased: was  && !s.pinching,
      pos:          { x:cx, y:cy },
      velocity:     { ...s.velocity },
      landmarks:    lm,
      gesture:      s._confirmedGesture,
    };
  }

  update(multiHandLandmarks, W, H) {
    const now   = performance.now();
    const count = multiHandLandmarks?.length ?? 0;
    const out   = [];

    for (let i = 0; i < 2; i++) {
      const s = this._hands[i];
      if (i < count) {
        const gd = this._processSlot(s, multiHandLandmarks[i], W, H, now);
        gd.handIndex = i;
        out.push(gd);
      } else if (s.pinching) {
        // Hand vanished while pinching → synthesise release
        out.push({
          handIndex: i, pinching: false, justPinched: false, justReleased: true,
          pos: { ...s.pinchPos }, velocity: { ...s.velocity },
          landmarks: null, gesture: 'none',
        });
        s.pinching = false; s._velBuf = []; s._prev = null;
        s._rawGesture = 'other'; s._stableFrames = 0; s._confirmedGesture = 'other';
      }
    }
    return out;
  }
}
