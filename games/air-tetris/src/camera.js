import { GestureInterpreter } from './gesture.js';

// Pin the script and its WASM/model files to the same known version.
const HANDS_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/';
const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
let handsScript;

function loadHands() {
  if (typeof globalThis.Hands === 'function') return Promise.resolve(globalThis.Hands);
  if (handsScript) return handsScript;
  handsScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const finish = error => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      if (error) { script.remove(); reject(error); }
      else resolve(globalThis.Hands);
    };
    const timer = setTimeout(() => finish(new Error('手势组件加载超时，请检查网络后重试')), 20000);
    script.src = `${HANDS_BASE}hands.js`;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => finish(typeof globalThis.Hands === 'function' ? null : new Error('手势组件未能初始化，请重试'));
    script.onerror = () => finish(new Error('无法下载手势组件，请检查网络后重试'));
    document.head.appendChild(script);
  }).catch(error => { handsScript = null; throw error; });
  return handsScript;
}

function abortError() { return new DOMException('摄像头启动已取消', 'AbortError'); }

function bounded(promise, signal, ms, message) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (fn, value) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      fn(value);
    };
    const abort = () => finish(reject, abortError());
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(reject, new Error(message)), ms);
    // Attach handlers even when already aborted: late rejections stay handled.
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
    if (signal.aborted) abort();
  });
}

function readableError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') return '摄像头权限未开启，可以授权后重试，或继续用键盘游玩';
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return '没有找到摄像头，可以继续用键盘游玩';
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') return '摄像头正被其他应用占用，请关闭占用后重试';
  if (error?.name === 'SecurityError') return '浏览器限制了摄像头访问，请在 HTTPS 页面中打开';
  if (/^[\u4e00-\u9fff]/.test(error?.message || '')) return error.message;
  return '手势识别暂时不可用，请重试，或继续用键盘游玩';
}

export class AirControls {
  constructor({ video, canvas, onAction = () => {}, onStatus = () => {}, onTracking = () => {}, onSecret = () => {} }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onAction = onAction;
    this.onStatus = onStatus;
    this.onTracking = onTracking;
    this.onSecret = onSecret;
    this.interpreter = new GestureInterpreter();
    this.session = null;
  }

  get active() { return Boolean(this.session?.active); }

  start() {
    if (this.session) return this.session.promise;
    const session = { controller: new AbortController(), active: false, frame: null, hands: null, stream: null, pendingSend: null, lastFrame: 0, lastVideoTime: -1, lastResult: 0 };
    this.session = session;
    this.onStatus({ state: 'loading', message: '正在开启摄像头…' });
    session.promise = this._start(session);
    return session.promise;
  }

  async _start(session) {
    const { signal } = session.controller;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器不支持摄像头，请使用 HTTPS 页面或键盘操作');
      // Request permission directly from the button gesture, before downloading ML.
      const streamRequest = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
      });
      streamRequest.then(stream => {
        if (signal.aborted || this.session !== session) stream.getTracks().forEach(track => track.stop());
      }, () => {});
      session.stream = await bounded(streamRequest, signal, 20000, '等待摄像头授权超时，请重新点击开启');
      session.onEnded = () => {
        session.disconnected = true;
        if (session.active) this._fail(session, new Error('摄像头已断开，可以重新开启或继续用键盘游玩'));
        else session.controller.abort();
      };
      session.stream.getVideoTracks().forEach(track => track.addEventListener('ended', session.onEnded));
      if (!session.stream.getVideoTracks().some(track => track.readyState === 'live')) {
        throw new Error('摄像头已断开，可以重新开启或继续用键盘游玩');
      }
      this.video.srcObject = session.stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await bounded(this.video.play(), signal, 10000, '摄像头画面未能播放，请重试');
      this.onStatus({ state: 'loading', message: '正在准备手势识别，首次加载需要一点时间…' });
      const Hands = await bounded(loadHands(), signal, 22000, '手势组件加载超时，请重试');
      if (this.session !== session || signal.aborted) throw abortError();
      session.hands = new Hands({ locateFile: file => `${HANDS_BASE}${file}` });
      session.hands.setOptions({ maxNumHands: 2, modelComplexity: 0, minDetectionConfidence: 0.7, minTrackingConfidence: 0.65 });
      session.hands.onResults(results => {
        if (this.session !== session || !session.active) return;
        session.lastResult = performance.now();
        const hands = results.multiHandLandmarks || [];
        const result = this.interpreter.update(hands, session.lastResult, (this.video.videoWidth || 640) / (this.video.videoHeight || 480), results.multiHandedness || []);
        this._draw(hands);
        this.onTracking(result.tracking);
        result.actions.forEach(action => this.onAction(action));
        if (result.secret) this.onSecret();
      });
      // The first send initializes WASM and the model, not merely the JS wrapper.
      session.pendingSend = session.hands.send({ image: this.video });
      await bounded(session.pendingSend, signal, 30000, '手势模型准备超时，请检查网络后重试');
      if (this.session !== session || signal.aborted) throw abortError();
      if (!session.stream.getVideoTracks().some(track => track.readyState === 'live')) {
        throw new Error('摄像头已断开，可以重新开启或继续用键盘游玩');
      }
      this.interpreter.reset();
      session.active = true;
      session.lastResult = performance.now();
      this.onStatus({ state: 'ready', message: '摄像头已就绪 · 把一只手放入画面' });
      session.frame = requestAnimationFrame(now => this._frame(session, now));
      return true;
    } catch (error) {
      if (this.session !== session || (signal.aborted && !session.disconnected)) return false;
      const message = session.disconnected ? '摄像头已断开，可以重新开启或继续用键盘游玩' : readableError(error);
      this._release(session);
      this.session = null;
      this.onTracking({ present: false, label: '手势已关闭', progress: 0, x: 0.5 });
      this.onStatus({ state: 'error', message });
      throw new Error(message);
    }
  }

  async _frame(session, now) {
    if (this.session !== session || !session.active) return;
    if (now - session.lastResult > 800) {
      this.interpreter.update([], now);
      this._draw([]);
      this.onTracking({ present: false, label: '等待摄像头画面…', progress: 0, x: 0.5 });
    }
    try {
      if (now - session.lastFrame >= 40 && this.video.readyState >= 2 && this.video.currentTime !== session.lastVideoTime) {
        session.lastFrame = now;
        session.lastVideoTime = this.video.currentTime;
        session.pendingSend = session.hands.send({ image: this.video });
        await bounded(session.pendingSend, session.controller.signal, 8000, '手势识别停止响应，请重新开启');
      }
      if (this.session === session && session.active) session.frame = requestAnimationFrame(time => this._frame(session, time));
    } catch (error) {
      if (this.session === session && !session.controller.signal.aborted) this._fail(session, error);
    }
  }

  _fail(session, error) {
    if (this.session !== session) return;
    this._release(session);
    this.session = null;
    this.onTracking({ present: false, label: '手势已关闭', progress: 0, x: 0.5 });
    this.onStatus({ state: 'error', message: readableError(error) });
  }

  stop() {
    const session = this.session;
    this.session = null;
    if (session) this._release(session);
    this.interpreter.reset();
    this._draw([]);
    this.onTracking({ present: false, label: '摄像头未开启', progress: 0, x: 0.5 });
    this.onStatus({ state: 'off', message: '摄像头已关闭 · 随时可用键盘游玩' });
  }

  _release(session) {
    session.active = false;
    session.controller.abort();
    if (session.frame !== null) cancelAnimationFrame(session.frame);
    session.stream?.getTracks().forEach(track => {
      if (session.onEnded) track.removeEventListener('ended', session.onEnded);
      track.stop();
    });
    if (this.video.srcObject === session.stream) {
      this.video.pause();
      this.video.srcObject = null;
    }
    // Avoid deleting a WASM graph while an asynchronous send is using it.
    if (session.hands) Promise.resolve(session.pendingSend).catch(() => {}).then(() => session.hands.close()).catch(() => {});
    this._draw([]);
  }

  _draw(hands) {
    const { canvas, ctx } = this;
    if (!ctx) return;
    const width = canvas.clientWidth || 320, height = canvas.clientHeight || 240;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const vw = this.video.videoWidth || 640, vh = this.video.videoHeight || 480;
    // Match object-fit: contain on the mirrored <video>, including letterboxing.
    const scale = Math.min(width / vw, height / vh);
    const dw = vw * scale, dh = vh * scale, ox = (width - dw) / 2, oy = (height - dh) / 2;
    const point = p => [ox + (1 - p.x) * dw, oy + p.y * dh];
    for (const landmarks of hands) {
      if (landmarks.length !== 21) continue;
      ctx.strokeStyle = 'rgba(165, 229, 206, .85)';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      CONNECTIONS.forEach(([a, b]) => { ctx.moveTo(...point(landmarks[a])); ctx.lineTo(...point(landmarks[b])); });
      ctx.stroke();
      landmarks.forEach((p, i) => {
        ctx.fillStyle = i === 4 || i === 8 ? '#f2b991' : '#d4f0e5';
        ctx.beginPath();
        ctx.arc(...point(p), i === 4 || i === 8 ? 4 : 2.1, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
}
