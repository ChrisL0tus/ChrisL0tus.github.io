import { CELL } from './pieces.js';

// Accent color per hand index (hand 0 = cyan, hand 1 = magenta)
const HAND_ACCENT = [0x00e5ff, 0xff4090];

export class Renderer {
  constructor(canvas, W, H) {
    this.W = W; this.H = H;

    this.app = new PIXI.Application({
      view: canvas, width: W, height: H,
      backgroundAlpha: 0, antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });

    // Layer order (bottom → top)
    this._starBg     = new PIXI.Graphics();
    this._twinkleGfx = new PIXI.Graphics();
    this._grid       = new PIXI.Graphics();
    this._pieceLayer = new PIXI.Container();
    this._heartGfx   = new PIXI.Graphics();   // Easter egg heart blocks
    this._lineFlash  = new PIXI.Graphics();
    this._particles  = new PIXI.Container();
    this._emojiLayer = new PIXI.Container();  // Floating heart emojis
    this._hand       = new PIXI.Graphics();
    this._skylarCont = new PIXI.Container();  // Easter egg SKYLAR text (topmost)

    for (const layer of [
      this._starBg, this._twinkleGfx, this._grid,
      this._pieceLayer, this._heartGfx, this._lineFlash,
      this._particles, this._emojiLayer, this._hand, this._skylarCont,
    ]) this.app.stage.addChild(layer);

    this._gfxMap      = new Map();
    this._flashBands  = [];
    this._twinkleData = [];

    this._initStarfield();
    this._drawGrid();
  }

  // ── Starfield ────────────────────────────────────────────────────────────

  _initStarfield() {
    const g = this._starBg;
    const { W, H } = this;

    const NEBULA = [0x6633aa, 0x2244bb, 0x441177, 0x112255, 0x772299, 0x224466];
    for (let i = 0; i < 7; i++) {
      g.beginFill(NEBULA[i % NEBULA.length], 0.018 + Math.random() * 0.028);
      g.drawCircle(Math.random() * W, Math.random() * H, 130 + Math.random() * 300);
      g.endFill();
    }

    for (let i = 0; i < 220; i++) {
      const r = Math.random();
      const sz = r < 0.6 ? Math.random() * 0.7 + 0.2
               : r < 0.88 ? Math.random() * 1.2 + 0.5
               : Math.random() * 2.0 + 1.0;
      const a = Math.random() * 0.55 + 0.1;
      const c = r < 0.78 ? 0xffffff : r < 0.89 ? 0xaaccff : r < 0.95 ? 0xffeecc : 0xddbbff;
      g.beginFill(c, a);
      g.drawCircle(Math.random() * W, Math.random() * H, sz);
      g.endFill();
      if (sz > 1.5) {
        g.beginFill(c, a * 0.15);
        g.drawCircle(Math.random() * W, Math.random() * H, sz * 5);
        g.endFill();
      }
    }

    this._twinkleData = Array.from({ length: 30 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 2.0 + 0.8,
      baseAlpha: Math.random() * 0.55 + 0.25,
      phase: Math.random() * Math.PI * 2,
      speed: 0.25 + Math.random() * 1.8,
      color: [0xffffff, 0xaaccff, 0xffeecc, 0xddbbff][Math.floor(Math.random() * 4)],
    }));
  }

  _tickTwinkles(time) {
    const g = this._twinkleGfx;
    g.clear();
    const t = time * 0.001;
    for (const s of this._twinkleData) {
      const a = s.baseAlpha * (0.35 + 0.65 * Math.sin(t * s.speed + s.phase));
      if (a <= 0) continue;
      g.beginFill(s.color, a);
      g.drawCircle(s.x, s.y, s.r);
      g.endFill();
      if (s.r > 1.5) {
        g.beginFill(s.color, a * 0.18);
        g.drawCircle(s.x, s.y, s.r * 4.5);
        g.endFill();
      }
    }
  }

  // ── Grid ─────────────────────────────────────────────────────────────────

  _drawGrid() {
    const g = this._grid;
    g.lineStyle(1, 0xffffff, 0.028);
    for (let x = 0; x <= this.W; x += CELL) { g.moveTo(x, 0); g.lineTo(x, this.H); }
    for (let y = 0; y <= this.H; y += CELL) { g.moveTo(0, y); g.lineTo(this.W, y); }
    g.lineStyle(2, 0x00e5ff, 0.09);
    g.moveTo(0, this.H - 1); g.lineTo(this.W, this.H - 1);
  }

  // ── Pieces ───────────────────────────────────────────────────────────────

  // grabbedSet: a Set of body references currently held by any hand
  updatePieces(bodies, grabbedSet) {
    for (const [id, gfx] of this._gfxMap) {
      if (!bodies.find(b => b.id === id)) {
        this._pieceLayer.removeChild(gfx); gfx.destroy(); this._gfxMap.delete(id);
      }
    }
    for (const body of bodies) {
      let gfx = this._gfxMap.get(body.id);
      if (!gfx) { gfx = new PIXI.Graphics(); this._pieceLayer.addChild(gfx); this._gfxMap.set(body.id, gfx); }
      this._drawPiece(gfx, body, grabbedSet.has(body));
    }
  }

  _drawPiece(gfx, body, grabbed) {
    gfx.clear();
    const color   = body.pieceColor ?? 0x00e5ff;
    const glow    = body.pieceGlow  ?? 0x0088ff;
    const settled = body._settled || body.isStatic;
    const glowW   = grabbed ? 18 : settled ? 4  : 10;
    const glowA   = grabbed ? 0.6 : settled ? 0.09 : 0.24;
    const fillA   = grabbed ? 0.82 : settled ? 0.90 : 0.60;

    const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
    for (const part of parts) {
      const v = part.vertices;
      if (!v || v.length < 3) continue;

      gfx.lineStyle(glowW, glow, glowA);
      gfx.beginFill(glow, grabbed ? 0.14 : settled ? 0.01 : 0.06);
      this._poly(gfx, v); gfx.endFill();

      gfx.lineStyle(1.5, color, settled ? 0.70 : 0.92);
      gfx.beginFill(color, fillA);
      this._poly(gfx, v); gfx.endFill();

      // Inner shine dot
      const cx = part.position.x, cy = part.position.y;
      gfx.lineStyle(0);
      gfx.beginFill(0xffffff, settled ? 0.10 : 0.22);
      gfx.drawCircle(cx - CELL * 0.17, cy - CELL * 0.17, CELL * 0.15);
      gfx.endFill();
    }
  }

  _poly(gfx, v) {
    gfx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) gfx.lineTo(v[i].x, v[i].y);
    gfx.closePath();
  }

  // ── Hand skeletons ───────────────────────────────────────────────────────

  // gestures: array of gesture data objects (0–2 items), each has .landmarks and .handIndex
  updateHand(gestures) {
    this._hand.clear();
    if (!gestures?.length) return;
    for (const gd of gestures) {
      if (gd?.landmarks) this._drawSkeleton(gd, HAND_ACCENT[gd.handIndex] ?? 0x00e5ff);
    }
  }

  _drawSkeleton(gd, accent) {
    const lm = gd.landmarks;
    const W = this.W, H = this.H;
    const px = i => (1 - lm[i].x) * W;
    const py = i => lm[i].y * H;

    const EDGES = [
      [0,1],[1,2],[2,3],[3,4], [0,5],[5,6],[6,7],[7,8],
      [0,9],[9,10],[10,11],[11,12], [0,13],[13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20], [5,9],[9,13],[13,17],
    ];

    this._hand.lineStyle(1.5, 0xffffff, 0.22);
    for (const [a, b] of EDGES) { this._hand.moveTo(px(a), py(a)); this._hand.lineTo(px(b), py(b)); }

    for (let i = 0; i < 21; i++) {
      const key = i === 4 || i === 8;
      this._hand.lineStyle(key ? 2 : 0, accent, 0.9);
      this._hand.beginFill(key ? accent : 0xffffff, key ? 0.95 : 0.32);
      this._hand.drawCircle(px(i), py(i), key ? 8 : 3.5);
      this._hand.endFill();
    }

    if (gd.pinching) {
      this._hand.lineStyle(2.5, accent, 0.9);
      this._hand.beginFill(accent, 0.10);
      this._hand.drawCircle(gd.pos.x, gd.pos.y, 26);
      this._hand.endFill();
      this._hand.lineStyle(1.5, accent, 0.25);
      this._hand.beginFill(0, 0);
      this._hand.drawCircle(gd.pos.x, gd.pos.y, 44);
      this._hand.endFill();
    }
  }

  // ── Line-clear flash ─────────────────────────────────────────────────────

  flashRow(rowY) { this._flashBands.push({ y: rowY, life: 1.0 }); }

  _tickFlash() {
    this._lineFlash.clear();
    for (let i = this._flashBands.length - 1; i >= 0; i--) {
      const b = this._flashBands[i];
      b.life -= 0.045;
      if (b.life <= 0) { this._flashBands.splice(i, 1); continue; }
      this._lineFlash.beginFill(0xffffff, b.life * 0.6);
      this._lineFlash.drawRect(0, b.y - CELL / 2, this.W, CELL);
      this._lineFlash.endFill();
    }
  }

  // ── Particles ────────────────────────────────────────────────────────────

  spawnBurst(x, y, color, n = 18) {
    for (let i = 0; i < n; i++) {
      const g = new PIXI.Graphics();
      g.beginFill(color, 0.95);
      g.drawCircle(0, 0, 2 + Math.random() * 4.5);
      g.endFill();
      g.x = x; g.y = y;
      const angle = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.7;
      const spd   = 3 + Math.random() * 8;
      g._vx   = Math.cos(angle) * spd;
      g._vy   = Math.sin(angle) * spd - 2;
      g._life = 1 + Math.random() * 0.3;
      this._particles.addChild(g);
    }
  }

  // ── Main tick ────────────────────────────────────────────────────────────

  // ── Floating heart emojis (Easter egg pinch effect) ──────────────────────

  spawnHeartEmoji(x, y) {
    const chars = ['❤️', '💕', '💗', '💖', '🩷'];
    const char  = chars[Math.floor(Math.random() * chars.length)];
    const size  = 20 + Math.random() * 24;

    const t = new PIXI.Text(char, { fontSize: size });
    t.anchor.set(0.5);
    t.x      = x + (Math.random() - 0.5) * 28;
    t.y      = y;
    t._origX = t.x;
    t._vy    = -(1.6 + Math.random() * 2.8);   // upward speed
    t._life  = 1.0;
    t._decay = 0.006 + Math.random() * 0.005;   // fade-out rate
    t._phase = Math.random() * Math.PI * 2;     // wobble phase offset
    t._tick  = 0;

    this._emojiLayer.addChild(t);
  }

  // ── Main tick ────────────────────────────────────────────────────────────

  tickParticles(time) {
    // Burst particles
    const kids = this._particles.children;
    for (let i = kids.length - 1; i >= 0; i--) {
      const p = kids[i];
      p.x += p._vx; p.y += p._vy;
      p._vy += 0.38; p._vx *= 0.95;
      p._life -= 0.028;
      p.alpha = Math.max(0, p._life);
      if (p._life <= 0) { this._particles.removeChild(p); p.destroy(); }
    }

    // Floating emoji hearts
    const emojis = this._emojiLayer.children;
    for (let i = emojis.length - 1; i >= 0; i--) {
      const e = emojis[i];
      e._tick++;
      // Gentle sine-wave horizontal sway
      e.x    = e._origX + Math.sin(e._tick * 0.13 + e._phase) * 10;
      e.y   += e._vy;
      e._life -= e._decay;
      e.alpha  = Math.max(0, e._life);
      if (e._life <= 0) { this._emojiLayer.removeChild(e); e.destroy(); }
    }

    this._tickTwinkles(time);
    this._tickFlash();
  }

  // ── Easter egg: heart blocks ──────────────────────────────────────────────

  // Draw all heart blocks each frame with a pulsing pink glow.
  // alpha: 0–1 used for fade-in / fade-out.
  updateHeartBlocks(bodies, time, alpha = 1) {
    const g = this._heartGfx;
    g.clear();
    g.alpha = alpha;
    if (!bodies.length) return;

    const pulse = 0.55 + 0.45 * Math.sin(time * 0.0028);
    const color = 0xFF1177;
    const glow  = 0xFF0044;

    for (const b of bodies) {
      const v = b.vertices;
      if (!v || v.length < 3) continue;

      // Wide outer glow (pulsing)
      g.lineStyle(22, glow, 0.28 * pulse);
      g.beginFill(glow, 0.06 * pulse);
      this._poly(g, v); g.endFill();

      // Mid glow
      g.lineStyle(10, 0xFF66AA, 0.5 * pulse);
      g.beginFill(0, 0);
      this._poly(g, v); g.endFill();

      // Main fill
      g.lineStyle(1.5, 0xFFAACC, 0.95);
      g.beginFill(color, 0.88);
      this._poly(g, v); g.endFill();

      // Top-left shine
      const cx = b.position.x, cy = b.position.y;
      g.lineStyle(0);
      g.beginFill(0xFFFFFF, 0.30);
      g.drawCircle(cx - CELL * 0.17, cy - CELL * 0.17, CELL * 0.15);
      g.endFill();
    }
  }

  // ── Easter egg: SKYLAR text ───────────────────────────────────────────────

  showSkylarText(cx, cy) {
    this._skylarCont.removeChildren();

    // Glow backdrop (blurred copy via alpha + size trick)
    const glowStyle = new PIXI.TextStyle({
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif',
      fontSize: 96,
      fontWeight: '800',
      fill: '#FF2266',
      letterSpacing: 10,
    });

    for (let i = 3; i >= 1; i--) {
      const gt = new PIXI.Text('SKYLAR', { ...glowStyle, fontSize: 96 + i * 12 });
      gt.anchor.set(0.5);
      gt.x = cx; gt.y = cy;
      gt.alpha = 0.18 - i * 0.04;
      this._skylarCont.addChild(gt);
    }

    // Crisp main text
    const mainStyle = new PIXI.TextStyle({
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif',
      fontSize: 92,
      fontWeight: '800',
      fill: ['#FFFFFF', '#FFCCDD'],
      fillGradientType: PIXI.TEXT_GRADIENT.LINEAR_VERTICAL,
      stroke: '#FF0044',
      strokeThickness: 2,
      dropShadow: true,
      dropShadowColor: '#FF0044',
      dropShadowBlur: 32,
      dropShadowDistance: 0,
      dropShadowAlpha: 1.0,
      letterSpacing: 10,
    });

    this._skylarText = new PIXI.Text('SKYLAR', mainStyle);
    this._skylarText.anchor.set(0.5);
    this._skylarText.x = cx;
    this._skylarText.y = cy;
    this._skylarCont.addChild(this._skylarText);
  }

  setSkylarAlpha(a) {
    this._skylarCont.alpha = a;
    this._heartGfx.alpha  = a;
  }

  hideSkylarText() {
    this._skylarCont.removeChildren();
    this._skylarText = null;
  }
}
