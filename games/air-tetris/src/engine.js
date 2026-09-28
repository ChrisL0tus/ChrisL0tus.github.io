/** A small, renderer-independent Tetris engine. All time values are milliseconds. */
export const COLS = 10;
export const ROWS = 20;

export const SHAPES = Object.freeze({
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
});

export const COLORS = Object.freeze({
  I: '#84d9cf',
  O: '#ead18a',
  T: '#b6a2d9',
  S: '#a3c997',
  Z: '#de9295',
  J: '#8eaddb',
  L: '#e8ac82',
});

const TYPES = Object.keys(SHAPES);
const LOCK_DELAY = 450;
const MAX_LOCK_RESETS = 15;
const CLEAR_POINTS = [0, 100, 300, 500, 800];

// SRS offsets, expressed in canvas coordinates (positive y points down).
const KICKS = {
  '0>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '1>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '1>2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '2>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '2>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '3>2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '3>0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '0>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
};
const I_KICKS = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
};

const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));
const copyMatrix = matrix => matrix.map(row => [...row]);
const rotateMatrix = (matrix, direction) => matrix.map((row, y) =>
  row.map((_, x) => direction > 0
    ? matrix[matrix.length - 1 - x][y]
    : matrix[x][matrix.length - 1 - y]));

export class Tetris {
  constructor({ random = Math.random, onEvent = () => {} } = {}) {
    this.random = random;
    this.onEvent = onEvent;
    this._initialize();
  }

  _initialize() {
    this.state = 'idle';
    this.board = emptyBoard();
    this.active = null;
    this.next = [];
    this.held = null;
    this.canHold = true;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    // The first clear is combo 0; subsequent consecutive clears are 1, 2, ...
    this.combo = -1;
    this.elapsed = 0;
    this._bag = [];
    this._fallTime = 0;
    this._lockTime = 0;
    this._lockResets = 0;
    this._lowestY = -1;
    this._fillQueue();
  }

  reset() {
    this._initialize();
    this.state = 'playing';
    this._spawn(this._takeNext());
    this._emit('start');
    return this;
  }

  get gravityMs() {
    return Math.max(65, 900 * Math.pow(0.8, this.level - 1));
  }

  _emit(type, detail = {}) {
    this.onEvent({ type, ...detail });
  }

  _fillQueue() {
    while (this.next.length < 5) {
      if (!this._bag.length) {
        this._bag = [...TYPES];
        for (let i = this._bag.length - 1; i > 0; i--) {
          const j = Math.min(i, Math.max(0, Math.floor(this.random() * (i + 1))));
          [this._bag[i], this._bag[j]] = [this._bag[j], this._bag[i]];
        }
      }
      this.next.push(this._bag.pop());
    }
  }

  _takeNext() {
    const type = this.next.shift();
    this._fillQueue();
    return type;
  }

  _spawn(type) {
    const matrix = copyMatrix(SHAPES[type]);
    this.active = {
      type,
      matrix,
      x: Math.floor((COLS - matrix.length) / 2),
      y: type === 'O' ? 0 : -1,
      rotation: 0,
    };
    this._fallTime = 0;
    this._lockTime = 0;
    this._lockResets = 0;
    this._lowestY = this.active.y;
    if (!this._fits(matrix, this.active.x, this.active.y)) {
      this.state = 'over';
      this.active = null;
      return false;
    }
    return true;
  }

  _fits(matrix, x, y) {
    for (let row = 0; row < matrix.length; row++) {
      for (let col = 0; col < matrix[row].length; col++) {
        if (!matrix[row][col]) continue;
        const bx = x + col;
        const by = y + row;
        if (bx < 0 || bx >= COLS || by >= ROWS) return false;
        if (by >= 0 && this.board[by][bx]) return false;
      }
    }
    return true;
  }

  _grounded() {
    return !this._fits(this.active.matrix, this.active.x, this.active.y + 1);
  }

  _afterAdjustment(wasGrounded) {
    if (wasGrounded && this._lockResets < MAX_LOCK_RESETS) {
      this._lockTime = 0;
      this._lockResets++;
    }
    this._afterDescent();
  }

  _afterDescent() {
    // A new lowest position receives a full delay even after the move limit.
    if (this.active.y > this._lowestY) {
      this._lowestY = this.active.y;
      this._lockTime = 0;
    }
  }

  move(dx) {
    if (this.state !== 'playing' || !Number.isFinite(dx) || !dx) return false;
    dx = Math.sign(dx);
    const piece = this.active;
    if (!this._fits(piece.matrix, piece.x + dx, piece.y)) return false;
    const wasGrounded = this._grounded();
    piece.x += dx;
    this._afterAdjustment(wasGrounded);
    this._emit('move', { dx });
    return true;
  }

  rotate(direction = 1) {
    if (this.state !== 'playing' || !Number.isFinite(direction) || !direction) return false;
    direction = Math.sign(direction);
    const piece = this.active;
    const rotation = (piece.rotation + (direction > 0 ? 1 : 3)) % 4;
    const matrix = rotateMatrix(piece.matrix, direction);
    const kicks = piece.type === 'O' ? [[0, 0]]
      : (piece.type === 'I' ? I_KICKS : KICKS)[`${piece.rotation}>${rotation}`];
    const wasGrounded = this._grounded();
    for (const [dx, dy] of kicks) {
      if (!this._fits(matrix, piece.x + dx, piece.y + dy)) continue;
      piece.matrix = matrix;
      piece.x += dx;
      piece.y += dy;
      piece.rotation = rotation;
      this._afterAdjustment(wasGrounded);
      this._emit('rotate', { direction, dx, dy });
      return true;
    }
    return false;
  }

  softDrop() {
    if (this.state !== 'playing') return false;
    const piece = this.active;
    if (!this._fits(piece.matrix, piece.x, piece.y + 1)) return false;
    piece.y++;
    this.score++;
    this._fallTime = 0;
    this._afterDescent();
    this._emit('drop', { distance: 1, hard: false });
    return true;
  }

  ghostY() {
    if (!this.active) return null;
    let y = this.active.y;
    while (this._fits(this.active.matrix, this.active.x, y + 1)) y++;
    return y;
  }

  hardDrop() {
    if (this.state !== 'playing') return false;
    const y = this.ghostY();
    const distance = y - this.active.y;
    this.active.y = y;
    this.score += distance * 2;
    this._emit('drop', { distance, hard: true });
    this._lock();
    return true;
  }

  hold() {
    if (this.state !== 'playing' || !this.canHold) return false;
    const type = this.active.type;
    const nextType = this.held || this._takeNext();
    this.held = type;
    this.canHold = false;
    const spawned = this._spawn(nextType);
    this._emit('hold', { held: type });
    if (!spawned) this._emit('over', { reason: 'block-out' });
    return true;
  }

  _lock() {
    const piece = this.active;
    const cells = [];
    for (let y = 0; y < piece.matrix.length; y++) {
      for (let x = 0; x < piece.matrix[y].length; x++) {
        if (piece.matrix[y][x]) cells.push({ x: piece.x + x, y: piece.y + y, type: piece.type });
      }
    }
    for (const cell of cells) {
      if (cell.y >= 0) this.board[cell.y][cell.x] = cell.type;
    }
    if (cells.some(cell => cell.y < 0)) {
      this.state = 'over';
      this.active = null;
      this._emit('lock', { cells });
      this._emit('over', { reason: 'lock-out' });
      return;
    }

    const rows = [];
    for (let y = 0; y < ROWS; y++) {
      if (this.board[y].every(Boolean)) rows.push(y);
    }
    let points = 0;
    if (rows.length) {
      this.combo++;
      points = CLEAR_POINTS[rows.length] * this.level + this.combo * 50 * this.level;
      this.score += points;
      this.lines += rows.length;
      this.level = Math.floor(this.lines / 10) + 1;
      this.board = this.board.filter((_, y) => !rows.includes(y));
      while (this.board.length < ROWS) this.board.unshift(Array(COLS).fill(null));
    } else {
      this.combo = -1;
    }
    this.canHold = true;
    const spawned = this._spawn(this._takeNext());
    this._emit('lock', { cells });
    if (rows.length) this._emit('clear', { rows, count: rows.length, points, combo: this.combo });
    if (!spawned) this._emit('over', { reason: 'block-out' });
  }

  tick(dtMs) {
    if (this.state !== 'playing' || !Number.isFinite(dtMs) || dtMs <= 0) return;
    let remaining = dtMs;
    // Consume the interval in gravity/lock events so results do not depend on fps.
    while (remaining > 0 && this.state === 'playing') {
      if (this._grounded()) {
        const step = Math.min(remaining, Math.max(0, LOCK_DELAY - this._lockTime));
        this._lockTime += step;
        this._fallTime = 0;
        this.elapsed += step;
        remaining -= step;
        if (this._lockTime >= LOCK_DELAY) this._lock();
      } else {
        const step = Math.min(remaining, Math.max(0, this.gravityMs - this._fallTime));
        this._fallTime += step;
        this.elapsed += step;
        remaining -= step;
        if (this._fallTime >= this.gravityMs) {
          this._fallTime = 0;
          this.active.y++;
          this._afterDescent();
        }
      }
    }
  }

  pause() {
    if (this.state !== 'playing') return false;
    this.state = 'paused';
    this._emit('pause');
    return true;
  }

  resume() {
    if (this.state !== 'paused') return false;
    this.state = 'playing';
    this._emit('resume');
    return true;
  }
}
