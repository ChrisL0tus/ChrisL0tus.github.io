import { COLS, ROWS, SHAPES, COLORS } from './engine.js';

const CELL = 30;
const cells = matrix => matrix.flatMap((row, y) => row.flatMap((v, x) => v ? [{ x, y }] : []));
function block(ctx, x, y, size, color, ghost = false) {
  const gap = size > 22 ? 1.4 : 1;
  ctx.beginPath();
  ctx.roundRect(x + gap, y + gap, size - gap * 2, size - gap * 2, Math.max(2, size * .11));
  if (ghost) {
    ctx.fillStyle = `${color}0d`; ctx.fill();
    ctx.strokeStyle = `${color}7f`; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    return;
  }
  ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = '#ffffff30'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#ffffff30';
  ctx.fillRect(x + gap + 3, y + gap + 3, size - gap * 2 - 6, 2);
  ctx.fillStyle = '#18332916';
  ctx.fillRect(x + gap + 2, y + size - gap - 4, size - gap * 2 - 4, 2);
}

export class Renderer {
  constructor(canvas, holdCanvas, nextCanvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.holdCanvas = holdCanvas; this.nextCanvas = nextCanvas;
    this.particles = []; this.flashes = []; this.impact = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.previewKey = '';
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = 300 * ratio; canvas.height = 600 * ratio;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.mobileQuery = matchMedia('(max-width: 540px)');
    this.mobileQuery.addEventListener('change', () => { this.previewKey = ''; });
  }
  event(event) {
    if (this.reducedMotion) return;
    if (event.type === 'start') { this.particles = []; this.flashes = []; }
    if (event.type === 'drop' && event.hard) this.impact = 1;
    if (event.type === 'clear') {
      for (const row of event.rows) {
        this.flashes.push({ row, life: 1 });
        for (let i = 0; i < 16; i++) this.particles.push({ x: Math.random() * 300, y: row * CELL + 15, vx: (Math.random() - .5) * 100, vy: -30 - Math.random() * 70, life: 1, size: 2 + Math.random() * 3, color: '#d1ecc1' });
      }
    }
  }
  draw(game, dt) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 300, 600);
    ctx.fillStyle = '#1b302a'; ctx.fillRect(0, 0, 300, 600);
    ctx.strokeStyle = '#b1c5a50b'; ctx.lineWidth = .6; ctx.beginPath();
    for (let x = 0; x <= COLS; x++) { ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, 600); }
    for (let y = 0; y <= ROWS; y++) { ctx.moveTo(0, y * CELL); ctx.lineTo(300, y * CELL); }
    ctx.stroke();
    if (game.state === 'idle') this.drawIdle();
    else {
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        if (game.board[y][x]) block(ctx, x * CELL, y * CELL, CELL, COLORS[game.board[y][x]]);
      }
      if (game.active) {
        const { x, y, matrix, type } = game.active;
        const ghostY = game.ghostY();
        cells(matrix).forEach(cell => { if (cell.y + ghostY >= 0) block(ctx, (x + cell.x) * CELL, (ghostY + cell.y) * CELL, CELL, COLORS[type], true); });
        cells(matrix).forEach(cell => { if (cell.y + y >= 0) block(ctx, (x + cell.x) * CELL, (y + cell.y) * CELL, CELL, COLORS[type]); });
      }
    }
    for (const flash of this.flashes) { ctx.fillStyle = `rgba(225,248,208,${flash.life * .7})`; ctx.fillRect(0, flash.row * CELL, 300, CELL); flash.life -= dt / 320; }
    this.flashes = this.flashes.filter(flash => flash.life > 0);
    for (const p of this.particles) { p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.vy += dt / 5; p.life -= dt / 650; ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); }
    ctx.globalAlpha = 1; this.particles = this.particles.filter(p => p.life > 0);
    if (this.impact > 0) { ctx.fillStyle = `rgba(185,229,156,${this.impact * .15})`; ctx.fillRect(0, 592, 300, 8); this.impact -= dt / 200; }
    this.previews(game);
  }
  drawIdle() {
    const placements = [['J',0,18],['O',3,18],['L',5,18],['T',7,17],['S',0,16],['I',5,15],['Z',2,16]];
    this.ctx.globalAlpha = .62;
    for (const [type, x, y] of placements) cells(SHAPES[type]).forEach(cell => block(this.ctx, (x + cell.x) * CELL, (y + cell.y) * CELL, CELL, COLORS[type]));
    this.ctx.globalAlpha = 1;
  }
  setupPreview(canvas, width, height) {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * ratio; canvas.height = height * ratio;
    const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return ctx;
  }
  previewPiece(ctx, type, cx, cy, size) {
    if (!type) return;
    const points = cells(SHAPES[type]);
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
    points.forEach(p => block(ctx, cx + (p.x - minX - (maxX - minX + 1) / 2) * size, cy + (p.y - minY - (maxY - minY + 1) / 2) * size, size, COLORS[type]));
  }
  previews(game) {
    const mobile = this.mobileQuery.matches;
    const key = `${game.held}:${game.next.slice(0, 3).join('')}:${mobile}`;
    if (this.previewKey === key) return;
    this.previewKey = key;
    const hold = this.setupPreview(this.holdCanvas, 160, 72);
    this.previewPiece(hold, game.held, 80, 36, 23);
    const width = mobile ? 56 : 240, height = mobile ? 175 : 76;
    const next = this.setupPreview(this.nextCanvas, width, height);
    game.next.slice(0, 3).forEach((type, index) => this.previewPiece(next, type, mobile ? 28 : 40 + index * 80, mobile ? 30 + index * 57 : 38, mobile ? 12 : 15));
  }
}
