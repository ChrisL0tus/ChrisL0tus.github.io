export class CameraManager {
  constructor(videoEl, onResults) {
    this.video = videoEl;
    this.onResults = onResults;
  }

  async init() {
    this.hands = new Hands({
      locateFile: file =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    this.hands.setOptions({
      maxNumHands: 2,                  // both hands
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
    });

    this.hands.onResults(r => this.onResults(r));

    this.camera = new Camera(this.video, {
      onFrame: async () => { await this.hands.send({ image: this.video }); },
      width: 1280,
      height: 720,
    });

    await this.camera.start();
  }
}
