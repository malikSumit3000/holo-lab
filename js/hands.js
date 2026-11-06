// Camera + MediaPipe hand tracking (runs in the browser on the GPU).
import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

export class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.delegate = null;
    this.stream = null;
    this.devices = [];
    this.currentId = null;
    this.currentLabel = '';
    this.lastVideoTime = -1;
    this.cameraOk = false;
  }

  async initModel() {
    const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    let lastErr;
    for (const delegate of ['GPU', 'CPU']) {
      for (const path of ['models/hand_landmarker.task', REMOTE_MODEL]) {
        try {
          this.landmarker = await HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: path, delegate },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.6,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
          this.delegate = delegate;
          return;
        } catch (e) { lastErr = e; }
      }
    }
    throw lastErr || new Error('Could not load the hand model');
  }

  async startCamera(deviceId = null) {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    const size = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } };
    const video = deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: 'user', ...size };
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    if (this.video.readyState < 2) await new Promise((r) => { this.video.onloadeddata = r; });
    const track = this.stream.getVideoTracks()[0];
    this.currentLabel = track.label || 'Camera';
    this.currentId = track.getSettings().deviceId;
    this.devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    this.cameraOk = true;
    this.lastVideoTime = -1;
  }

  /** Switch to the next camera (e.g. MacBook camera <-> iPhone Continuity Camera). */
  async nextCamera() {
    if (this.devices.length < 2) return null;
    const i = this.devices.findIndex((d) => d.deviceId === this.currentId);
    const next = this.devices[(i + 1) % this.devices.length];
    await this.startCamera(next.deviceId);
    return this.currentLabel;
  }

  /** Returns a new result only when the camera produced a new frame. */
  detect(nowMs) {
    if (!this.landmarker || !this.cameraOk || this.video.readyState < 2) return null;
    if (this.video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = this.video.currentTime;
    return this.landmarker.detectForVideo(this.video, nowMs);
  }
}

const dist = (a, b, vw, vh) => Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);

/**
 * Turns 21 raw landmarks into the features the interaction code needs.
 * Coordinates stay in raw (un-mirrored) video space; mirroring happens when mapping to screen.
 */
export function analyzeHand(lm, vw, vh) {
  const palm = Math.max(1, dist(lm[0], lm[9], vw, vh));            // wrist -> middle knuckle
  const pinchRatio = dist(lm[4], lm[8], vw, vh) / palm;              // thumb tip <-> index tip
  const indexReach = dist(lm[0], lm[8], vw, vh) / palm;              // how far the index tip is from the wrist
  const extended = [[6, 8], [10, 12], [14, 16], [18, 20]].map(
    ([pip, tip]) => dist(lm[0], lm[tip], vw, vh) > dist(lm[0], lm[pip], vw, vh) * 1.15);
  const avg = (ids) => ({ x: ids.reduce((s, i) => s + lm[i].x, 0) / ids.length, y: ids.reduce((s, i) => s + lm[i].y, 0) / ids.length });
  // angle of the wrist->middle-knuckle line on screen (mirrored, y up): twisting the hand changes it
  const roll = Math.atan2(-(lm[9].y - lm[0].y) * vh, -(lm[9].x - lm[0].x) * vw);
  return {
    lm,
    palmSize: palm / vh,
    pinchRatio,
    indexReach,
    extended,
    pinch: avg([4, 8]),
    palmCenter: avg([0, 5, 9, 13, 17]),
    roll,
  };
}

export const HAND_CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10],
  [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
