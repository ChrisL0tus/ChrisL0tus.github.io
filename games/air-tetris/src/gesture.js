// Geometry and timing are independent of the camera so controls can be tested
// with recorded/synthetic landmarks. All distances account for image aspect ratio.
const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const distance = (a, b, aspect) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

export function classifyHand(landmarks, aspect = 4 / 3) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21 ||
      landmarks.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const lm = landmarks;
  const size = Math.max(distance(lm[5], lm[17], aspect), distance(lm[0], lm[9], aspect));
  if (size < 0.035) return null;
  const fingers = [5, 9, 13, 17].map(mcp => {
    const pip = lm[mcp + 1], tip = lm[mcp + 3];
    const ax = (lm[mcp].x - pip.x) * aspect, ay = lm[mcp].y - pip.y;
    const bx = (tip.x - pip.x) * aspect, by = tip.y - pip.y;
    const cosine = (ax * bx + ay * by) / Math.max(0.000001, Math.hypot(ax, ay) * Math.hypot(bx, by));
    const radial = distance(tip, lm[0], aspect) / Math.max(0.000001, distance(pip, lm[0], aspect));
    return { extended: cosine < -0.45 && radial > 1.08, curled: cosine > -0.1 || radial < 0.95 };
  });
  const extended = fingers.filter(f => f.extended).length;
  const fist = fingers.filter(f => f.curled).length >= 3 && extended === 0;
  return {
    landmarks: lm,
    size,
    x: clamp(1 - [0, 5, 9, 13, 17].reduce((sum, i) => sum + lm[i].x, 0) / 5),
    y: [0, 5, 9, 13, 17].reduce((sum, i) => sum + lm[i].y, 0) / 5,
    pinchRatio: distance(lm[4], lm[8], aspect) / size,
    fist,
    open: extended >= 3,
    indexExtended: fingers[0].extended,
  };
}

export class GestureInterpreter {
  constructor() { this.reset(); }

  reset() {
    this.x = null;
    this.lastHand = null;
    this.lastTime = null;
    this.pinchFired = false;
    this.fistFired = false;
    this.secretFired = false;
    this._clearTimers();
  }

  _clearTimers() {
    this.pinchSince = null;
    this.pinchReleaseSince = null;
    this.fistSince = null;
    this.fistReleaseSince = null;
    this.openSince = null;
    this.secretSince = null;
    this.direction = null;
    this.nextMove = 0;
  }

  update(landmarks = [], now = 0, aspect = 4 / 3, handedness = []) {
    const hands = landmarks.map((lm, index) => {
      const hand = classifyHand(lm, aspect);
      if (hand) hand.identity = handedness[index]?.label || null;
      return hand;
    }).filter(Boolean);
    const dt = this.lastTime === null ? 50 : Math.max(0, now - this.lastTime);
    // A frozen tab or a lost hand must not finish a partially held gesture.
    if (dt > 250) this._clearTimers();
    this.lastTime = now;
    const output = { actions: [], secret: false, tracking: { present: false, label: '把一只手放入画面', progress: 0, x: this.x ?? 0.5 } };
    if (!hands.length) {
      this._clearTimers();
      this.x = null;
      this.lastHand = null;
      return output;
    }

    // Result order can change. Prefer the previous handedness, then the closest
    // raw palm (not its smoothed display position). A replacement hand must earn
    // its own hold time, even when no empty frame appears between the two hands.
    const previous = this.lastHand;
    const sameIdentity = previous?.identity ? hands.filter(hand => hand.identity === previous.identity) : [];
    const candidates = sameIdentity.length ? sameIdentity : hands;
    const hand = !previous ? candidates[0] : candidates.reduce((closest, next) =>
      distance(next, previous, aspect) < distance(closest, previous, aspect) ? next : closest);
    const changedIdentity = previous?.identity && hand.identity && previous.identity !== hand.identity;
    const discontinuity = previous && distance(hand, previous, aspect) >
      Math.max(0.14, Math.min(previous.size, hand.size) * 0.85) + Math.min(dt, 200) * 0.0004;
    if (changedIdentity || discontinuity) {
      this._clearTimers();
      this.x = null;
    }
    this.lastHand = { x: hand.x, y: hand.y, size: hand.size, identity: hand.identity };
    this.x = this.x === null ? hand.x : this.x + (hand.x - this.x) * (1 - Math.exp(-dt / 75));
    output.tracking = { present: true, label: '张开手掌，放松手指', progress: 0, x: this.x };

    const secretPose = hands.length === 2 && hands.every(h => h.indexExtended) &&
      distance(hands[0].landmarks[8], hands[1].landmarks[8], aspect) < (hands[0].size + hands[1].size) * 0.22;
    if (secretPose) {
      this.secretSince ??= now;
      if (!this.secretFired && now - this.secretSince >= 1200) {
        this.secretFired = true;
        output.secret = true;
      }
      // Keep the two-handed pose from moving pieces in the background.
      this.direction = null;
      this.openSince = null;
      this.pinchSince = null;
      this.fistSince = null;
      return output;
    }
    this.secretSince = null;

    // A fist can put thumb and index close together too; prefer the fist.
    const pinching = !hand.fist && hand.pinchRatio < (this.pinchSince !== null || this.pinchFired ? 0.42 : 0.27);
    if (!pinching && hand.pinchRatio > 0.42) {
      this.pinchReleaseSince ??= now;
      if (now - this.pinchReleaseSince >= 90) this.pinchFired = false;
    } else this.pinchReleaseSince = null;
    if (!hand.fist) {
      this.fistReleaseSince ??= now;
      if (now - this.fistReleaseSince >= 150) this.fistFired = false;
    } else this.fistReleaseSince = null;

    if (hand.fist) {
      this.fistSince ??= now;
      this.pinchSince = null;
      output.tracking.progress = this.fistFired ? 1 : clamp((now - this.fistSince) / 650);
      output.tracking.label = this.fistFired ? '已落下 · 松开手掌' : '保持握拳 · 准备落下';
      if (!this.fistFired && now - this.fistSince >= 650) {
        output.actions.push('drop');
        this.fistFired = true;
      }
    } else if (pinching) {
      this.fistSince = null;
      this.pinchSince ??= now;
      output.tracking.label = this.pinchFired ? '已旋转 · 松开手指' : '捏合 · 旋转';
      if (!this.pinchFired && now - this.pinchSince >= 70) {
        output.actions.push('rotate');
        this.pinchFired = true;
      }
    } else {
      this.fistSince = null;
      this.pinchSince = null;
      if (hand.open) {
        this.openSince ??= now;
        let direction = this.direction;
        if (this.x < 0.35) direction = 'left';
        else if (this.x > 0.65) direction = 'right';
        else if ((direction === 'left' && this.x > 0.42) || (direction === 'right' && this.x < 0.58)) direction = null;
        if (direction !== this.direction) {
          this.direction = direction;
          this.nextMove = now;
        }
        output.tracking.label = direction === 'left' ? '向左移动' : direction === 'right' ? '向右移动' : '居中 · 保持';
        if (direction && now - this.openSince >= 100 && now >= this.nextMove) {
          output.actions.push(direction);
          this.nextMove = now + (now - this.openSince < 200 ? 300 : 150);
        }
        return output;
      }
    }
    this.openSince = null;
    this.direction = null;
    return output;
  }
}
