import { Tetris } from './engine.js';
import { Renderer } from './renderer.js';
import { AirControls } from './camera.js';

const $ = id => document.getElementById(id);
const format = (value, length = 2) => String(value).padStart(length, '0');
const read = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, String(value)); } catch { /* Storage can be disabled. */ } };
let best = Math.max(0, Number(read('air-tetris-best-v2', 0)) || 0);
let soundEnabled = read('air-tetris-sound-v2', 'false') === 'true';
let audioContext, cameraState = 'off', tracked = false, lastSeen = 0, handHasControlled = false;
let overlayMode = 'idle', pauseReason = '', previousTime = 0, secretTimer, uiKey = '';
const heldInputs = new Map();
const renderer = new Renderer($('board'), $('hold-canvas'), $('next-canvas'));
const game = new Tetris({ onEvent: event => {
  renderer.event(event);
  if (event.type === 'clear') {
    const labels = ['', 'NICE LINE', 'DOUBLE', 'TRIPLE', 'TETRIS!'];
    toast(`${labels[event.count]} +${event.points}`);
    announce(`消除 ${event.count} 行，获得 ${event.points} 分。`);
    tone(event.count === 4 ? 'tetris' : 'clear');
  } else if (event.type === 'drop' && event.hard) tone('drop');
  else if (event.type === 'rotate' || event.type === 'hold') tone('rotate');
  else if (event.type === 'over') { heldInputs.clear(); tone('over'); announce(`游戏结束，得分 ${game.score}。`); }
  if (['start', 'pause', 'resume', 'over'].includes(event.type)) updateUI();
} });

function unlockAudio() {
  if (!soundEnabled) return;
  try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume().catch(() => {}); } catch { /* Audio is optional. */ }
}
function tone(name) {
  if (!soundEnabled || !audioContext || audioContext.state !== 'running') return;
  const notes = { rotate: [370], drop: [130, 90], clear: [523, 659, 784], tetris: [523, 659, 784, 1047], over: [330, 262, 196] }[name] || [];
  notes.forEach((frequency, i) => {
    const at = audioContext.currentTime + i * .065;
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.055, at + .008); gain.gain.exponentialRampToValueAtTime(.001, at + .13);
    oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(at); oscillator.stop(at + .15);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
}
function announce(text) { $('announcement').textContent = text; }
function toast(text) { const el = $('board-toast'); el.textContent = text; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
function buttonLabel(button, text, icon = 'arrow') { button.replaceChildren(document.createTextNode(`${text} `)); const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#i-${icon}`); svg.append(use); button.append(svg); }
function setOverlay(mode) {
  const changed = mode !== overlayMode;
  overlayMode = mode;
  $('board-overlay').hidden = mode === 'playing';
  if (mode === 'playing') return;
  const data = {
    idle: ['FIND YOUR FLOW', '好好玩一会儿。', '旋转、落下、消除。\n熟悉的快乐，全新的手感。', '开始游戏', '键盘 / 触屏直接玩 · 手势可随时开启'],
    paused: ['TAKE A BREATH', '停一停，也很好。', pauseReason || '方块在这里等你。\n准备好了，就继续吧。', '继续游戏', '按 P / ESC 也可以继续'],
    over: ['ONE MORE ROUND?', '每一局，都是新开始。', `本局 ${game.score.toLocaleString()} 分 · 消除 ${game.lines} 行\n${game.score > 0 && game.score >= best ? '新的个人最佳，做得漂亮。' : '下一次，会更有默契。'}`, '再玩一局', '最好的下一步，就是再来一次'],
    restart: ['A FRESH START', '重新来一局？', '当前进度将重新开始。\n你的最高分会一直保留。', '重新开始', '也可以继续刚才的节奏'],
  }[mode];
  if (!data) return;
  $('overlay-eyebrow').textContent = data[0]; $('overlay-title').textContent = data[1];
  $('overlay-description').textContent = data[2]; $('overlay-description').style.whiteSpace = 'pre-line';
  buttonLabel($('start-button'), data[3]); $('overlay-footnote').textContent = data[4];
  $('overlay-secondary').hidden = mode !== 'restart';
  if (changed && mode === 'over') $('start-button').focus({ preventScroll: true });
}
function updateUI() {
  if (game.score > best) { best = game.score; save('air-tetris-best-v2', best); }
  const mode = overlayMode === 'restart' && game.state === 'paused' ? 'restart' : game.state;
  const key = `${game.score}/${game.lines}/${game.level}/${mode}/${game.held}/${game.canHold}/${cameraState}/${pauseReason}`;
  if (key !== uiKey) {
    uiKey = key;
    $('score').textContent = format(game.score, 6); $('best').textContent = format(best, 6);
    $('level').textContent = format(game.level); $('lines').textContent = format(game.lines);
    $('level-progress').style.width = `${(game.lines % 10) * 10}%`;
    $('level-note').textContent = `再消除 ${10 - game.lines % 10} 行，升至下一级`;
    $('hold-empty').hidden = Boolean(game.held); $('hold-button').disabled = game.state !== 'playing' || !game.canHold;
    $('pause-button').disabled = !['playing', 'paused'].includes(game.state);
    $('restart-button').disabled = game.state === 'idle';
    const paused = game.state === 'paused';
    $('pause-button').setAttribute('aria-label', paused ? '继续游戏' : '暂停游戏');
    $('pause-button').title = paused ? '继续（P）' : '暂停（P）';
    $('pause-button').querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
    const states = { idle: '准备就绪', playing: cameraState === 'ready' ? '隔空进行中' : '找到你的节奏', paused: '暂停片刻', over: '本局已结束' };
    $('game-state').replaceChildren(); const dot = document.createElement('i'); dot.className = 'live-dot'; $('game-state').append(dot, ` ${states[game.state]}`);
    document.querySelectorAll('[data-action]').forEach(button => { button.disabled = game.state !== 'playing'; });
    setOverlay(mode);
  }
  const seconds = Math.floor(game.elapsed / 1000);
  $('timer').textContent = `${format(Math.floor(seconds / 60))}:${format(seconds % 60)}`;
}
function start() {
  heldInputs.clear(); pauseReason = ''; overlayMode = 'playing';
  $('secret').hidden = true; clearTimeout(secretTimer);
  handHasControlled = false; lastSeen = performance.now();
  game.reset(); unlockAudio(); updateUI(); $('start-button').blur();
  if (matchMedia('(max-width: 800px)').matches) {
    document.querySelector('.play-column').scrollIntoView({ behavior: renderer.reducedMotion ? 'instant' : 'smooth', block: 'start' });
  }
}
function pause(reason = '') {
  if (game.state !== 'playing') return;
  heldInputs.clear(); pauseReason = reason; game.pause(); updateUI();
}
function resume() {
  if (game.state !== 'paused') return;
  $('secret').hidden = true; clearTimeout(secretTimer);
  heldInputs.clear(); pauseReason = ''; overlayMode = 'playing'; handHasControlled = false; lastSeen = performance.now();
  game.resume(); unlockAudio(); updateUI(); $('start-button').blur();
}
function togglePause() { if (game.state === 'playing') pause(); else if (game.state === 'paused') resume(); }
function act(action, source = 'keyboard') {
  if (game.state !== 'playing' || !$('secret').hidden) return;
  if (source === 'gesture') handHasControlled = true;
  else handHasControlled = false;
  if (action === 'left') game.move(-1);
  if (action === 'right') game.move(1);
  if (action === 'rotate') game.rotate();
  if (action === 'counter') game.rotate(-1);
  if (action === 'soft') game.softDrop();
  if (action === 'drop') game.hardDrop();
  if (action === 'hold') game.hold();
  updateUI();
}
$('start-button').addEventListener('click', () => game.state === 'paused' && overlayMode !== 'restart' ? resume() : start());
$('overlay-secondary').addEventListener('click', resume);
$('pause-button').addEventListener('click', togglePause);
$('restart-button').addEventListener('click', () => {
  if (game.state === 'over') { start(); return; }
  pause(); overlayMode = 'restart'; uiKey = ''; updateUI(); $('start-button').focus({ preventScroll: true });
});
$('hold-button').addEventListener('click', () => act('hold'));
function updateSound() { $('sound-button').setAttribute('aria-pressed', String(soundEnabled)); const label = soundEnabled ? '关闭音效' : '开启音效'; $('sound-button').setAttribute('aria-label', label); $('sound-button').title = label; $('sound-button').querySelector('use').setAttribute('href', soundEnabled ? '#i-sound' : '#i-mute'); }
$('sound-button').addEventListener('click', () => { soundEnabled = !soundEnabled; save('air-tetris-sound-v2', soundEnabled); updateSound(); unlockAudio(); tone('rotate'); });

const keyMap = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowDown: 'soft', KeyS: 'soft', ArrowUp: 'rotate', KeyW: 'rotate', KeyX: 'rotate', KeyZ: 'counter', Space: 'drop', KeyC: 'hold', ShiftLeft: 'hold', ShiftRight: 'hold' };
window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
  if (event.code === 'Escape' || event.code === 'KeyP') { event.preventDefault(); if (!event.repeat) togglePause(); return; }
  if (event.code === 'Enter' && (game.state === 'idle' || game.state === 'over') && event.target.tagName !== 'BUTTON') { event.preventDefault(); if (!event.repeat) start(); return; }
  const action = keyMap[event.code];
  if (!action || game.state !== 'playing') return;
  // Space keeps its standard activation behavior on focused buttons.
  if (event.code === 'Space' && event.target.closest('button, a')) return;
  event.preventDefault(); if (event.repeat || heldInputs.has(event.code)) return;
  unlockAudio(); act(action);
  if (['left', 'right', 'soft'].includes(action)) heldInputs.set(event.code, { action, next: performance.now() + (action === 'soft' ? 50 : 160) });
});
window.addEventListener('keyup', event => { heldInputs.delete(event.code); });
for (const button of document.querySelectorAll('[data-action]')) {
  const action = button.dataset.action;
  button.addEventListener('pointerdown', event => {
    event.preventDefault(); if (button.disabled) return;
    button.setPointerCapture(event.pointerId); unlockAudio(); act(action, 'touch');
    if (['left', 'right', 'soft'].includes(action)) heldInputs.set(`pointer-${event.pointerId}`, { action, next: performance.now() + (action === 'soft' ? 50 : 160) });
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, event => heldInputs.delete(`pointer-${event.pointerId}`));
  button.addEventListener('click', event => { if (event.detail === 0) act(action, 'touch'); });
}

const air = new AirControls({ video: $('video'), canvas: $('hand-canvas'),
  onAction: action => act(action, 'gesture'),
  onStatus: ({ state, message }) => {
    const wasReady = cameraState === 'ready'; cameraState = state;
    $('camera-status').textContent = message; $('camera-status').classList.toggle('error', state === 'error');
    $('camera-preview').classList.toggle('active', state === 'ready'); $('camera-placeholder').hidden = state === 'ready';
    $('camera-badge').textContent = state === 'ready' ? 'AIR CONNECTED' : state === 'loading' ? 'CONNECTING' : 'CAMERA OFF';
    $('camera-button').querySelector('span').textContent = state === 'loading' ? '取消加载' : state === 'ready' ? '关闭手势控制' : state === 'error' ? '重新开启手势' : '开启手势控制';
    $('camera-button').querySelector('.button-plus').textContent = ['loading', 'ready'].includes(state) ? '−' : '+';
    if (state !== 'ready') { tracked = false; if (wasReady && handHasControlled && game.state === 'playing') pause('手势控制已断开。\n可以重新开启，或用键盘继续。'); handHasControlled = false; }
    updateUI();
  },
  onTracking: ({ present, label, progress }) => {
    tracked = present;
    if (present) lastSeen = performance.now();
    $('tracking-progress').style.width = `${Math.max(0, Math.min(1, progress || 0)) * 100}%`;
    if (cameraState === 'ready') { $('camera-status').textContent = label; $('camera-badge').textContent = present ? 'HAND DETECTED' : 'FIND YOUR HAND'; }
  },
  onSecret: () => {
    if (!$('secret').hidden) return;
    if (game.state === 'playing') pause('留一点心动，再继续。');
    $('secret').hidden = false; tone('tetris');
    clearTimeout(secretTimer); secretTimer = setTimeout(() => { $('secret').hidden = true; }, 4200);
  },
});
$('camera-button').addEventListener('click', async () => {
  if (cameraState === 'loading' || cameraState === 'ready') { air.stop(); return; }
  if (game.state === 'playing') pause('先把手放进画面，熟悉一下操作。\n准备好了，点击继续游戏。');
  try { await air.start(); } catch { /* onStatus explains the error and offers retry. */ }
});
function leavePage() { heldInputs.clear(); pause('离开了一小会儿，已为你暂停。'); if (cameraState === 'ready' || cameraState === 'loading') air.stop(); }
window.addEventListener('blur', () => { heldInputs.clear(); pause('窗口失去焦点，已为你暂停。'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) leavePage(); });
window.addEventListener('pagehide', leavePage);
function frame(now) {
  const dt = previousTime ? Math.min(now - previousTime, 100) : 0; previousTime = now;
  for (const input of heldInputs.values()) if (now >= input.next && game.state === 'playing') { act(input.action); input.next = now + (input.action === 'soft' ? 40 : 75); }
  if (cameraState === 'ready' && handHasControlled && !tracked && now - lastSeen > 1500) pause('暂时看不到你的手，已自动暂停。\n回到画面后，点击继续。');
  game.tick(dt); renderer.draw(game, dt); updateUI(); requestAnimationFrame(frame);
}
updateSound(); updateUI(); requestAnimationFrame(frame);
