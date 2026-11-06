// Camera + MediaPipe hand tracking (runs in the browser on the GPU).
import { FilesetResolver, HandLandmarker, FaceLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const REMOTE_FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';
const REMOTE_MODEL ='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

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

  /** Face tracking for the "3D window" effect - loaded only when first switched on. */
  async initFace() {
    if (this.face) return;
    this.fileset = this.fileset || await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    let lastErr;
    for (const delegate of ['GPU', 'CPU']) {
      for (const path of ['models/face_landmarker.task', REMOTE_FACE_MODEL]) {
        try {
          this.face = await FaceLandmarker.createFromOptions(this.fileset, {
            baseOptions: { modelAssetPath: path, delegate }, runningMode: 'VIDEO', numFaces: 1,
          });
          return;
        } catch (e) { lastErr = e; }
      }
    }
    throw lastErr || new Error('Could not load the face model');
  }

  detectFace(nowMs) {
    if (!this.face || !this.cameraOk || this.video.readyState < 2) return null;
    if (this.video.currentTime === this.lastFaceTime) return null;
    this.lastFaceTime = this.video.currentTime;
    return this.face.detectForVideo(this.video, nowMs);
  }

  async initModel() {
    const fileset = this.fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
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
    const t0 = performance.now();
    const r = this.landmarker.detectForVideo(this.video, nowMs);
    // diagnostics: tracking rate (results per second) and how long detection takes
    this.detectMs = (this.detectMs || 0) * 0.9 + (performance.now() - t0) * 0.1;
    this._count = (this._count || 0) + 1;
    if (!this._rateT) this._rateT = nowMs;
    if (nowMs - this._rateT >= 1000) { this.trackRate = Math.round(this._count * 1000 / (nowMs - this._rateT)); this._count = 0; this._rateT = nowMs; }
    return r;
  }
}

const dist = (a, b, vw, vh) => Math.hypot((a.x - b.x) * vw, (a.y - b.y) * vh);
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Turns 21 raw landmarks into the features the interaction code needs.
 * Screen positions come from the 2-D image landmarks (raw, un-mirrored video space).
 * Hand SHAPE (which fingers are out, pinch, thumb trigger, pointing direction) is measured in 3-D,
 * using MediaPipe's real-world landmarks when available - so a finger pointing straight at the
 * camera still counts as extended.
 */
export function analyzeHand(lm, vw, vh, world = null) {
  const P = world && world.length === 21
    ? world
    : lm.map((p) => ({ x: p.x * vw, y: p.y * vh, z: p.z * vw }));     // fallback: image coords + relative depth
  const palm3 = Math.max(1e-6, d3(P[0], P[9]));                       // wrist -> middle knuckle (3-D)
  const pinchRatio = d3(P[4], P[8]) / palm3;                          // thumb tip <-> index tip
  const indexReach = d3(P[0], P[8]) / palm3;                          // how far the index tip is from the wrist
  const extended = [[6, 8], [10, 12], [14, 16], [18, 20]].map(
    ([pip, tip]) => d3(P[0], P[tip]) > d3(P[0], P[pip]) * 1.15);
  const avg = (ids) => ({ x: ids.reduce((s, i) => s + lm[i].x, 0) / ids.length, y: ids.reduce((s, i) => s + lm[i].y, 0) / ids.length });
  // angle of the wrist->middle-knuckle line on screen (mirrored, y up): twisting the hand changes it
  const roll = Math.atan2(-(lm[9].y - lm[0].y) * vh, -(lm[9].x - lm[0].x) * vw);
  // finger gun: index out, other three curled. The thumb is the "hammer":
  // up = cocked (far from the index knuckle), down = fire (resting against the index).
  const gunPose = extended[0] && !extended[1] && !extended[2] && !extended[3];
  const thumbRatio = Math.min(d3(P[4], P[5]), d3(P[4], P[6])) / palm3;
  // 3-D pointing direction of the index finger (knuckle -> tip), unit length
  const dx = P[8].x - P[5].x, dy = P[8].y - P[5].y, dz = P[8].z - P[5].z;
  const dl = Math.hypot(dx, dy, dz) || 1;
  const pointDir = { x: dx / dl, y: dy / dl, z: dz / dl };
  return {
    lm,
    palmSize: Math.max(1, dist(lm[0], lm[9], vw, vh)) / vh,          // 2-D on purpose: drives depth
    pinchRatio,
    indexReach,
    extended,
    pinch: avg([4, 8]),
    palmCenter: avg([0, 5, 9, 13, 17]),
    roll,
    gunPose,
    thumbRatio,
    pointDir,
  };
}

export const HAND_CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10],
  [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
