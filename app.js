/* ============================================================
   Masque — Anonymisation de visages
   Vanilla JS, 100 % local. Aucune dépendance serveur.
   ============================================================ */

"use strict";

/* ------------------------------------------------------------
   Constantes
   ------------------------------------------------------------ */
const MODEL_URI = "models";
const ACCEPT = "image/*,video/*";
const MAX_HISTORY = 60;
const HANDLE_RADIUS = 11;
const MIN_BOX = 0.02;

/* ------------------------------------------------------------
   Références DOM
   ------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);

const views = {
  upload: $("view-upload"),
  processing: $("view-processing"),
  editor: $("view-editor"),
};

const el = {
  dropzone: $("dropzone"),
  fileInput: $("file-input"),
  dzError: $("dz-error"),
  fpsChips: document.querySelectorAll(".fps-control .chip"),
  progressTitle: $("progress-title"),
  progressMsg: $("progress-msg"),
  progressFill: $("progress-fill"),
  progressPct: $("progress-pct"),
  baseCanvas: $("base-canvas"),
  overlayCanvas: $("overlay-canvas"),
  canvasWrap: $("canvas-wrap"),
  emptyHint: $("empty-hint"),
  faceCount: $("face-count"),
  btnAdd: $("btn-add"),
  btnDelete: $("btn-delete"),
  btnClear: $("btn-clear"),
  btnApplyAll: $("btn-apply-all"),
  btnNew: $("btn-new"),
  btnExport: $("btn-export"),
  timeline: $("timeline"),
  timelineScroll: $("timeline-scroll"),
  timelineInfo: $("timeline-info"),
  formatSection: $("format-section"),
  styleChips: document.querySelectorAll('.editor-actions [data-style]'),
  formatChips: document.querySelectorAll('[data-format]'),
};

/* ------------------------------------------------------------
   État
   ------------------------------------------------------------ */
const state = {
  stage: "upload", // upload | processing | editing | exporting
  file: null,
  objectUrl: null,
  meta: { kind: "image", width: 0, height: 0, duration: 0, fps: 1, name: "" },
  keyframes: [], // [{ time, boxes, thumb }]
  current: 0,
  selectedId: null,
  style: "box", // box | blur | pixelate
  format: "png", // png | jpeg
  fps: 6,
  mediaEl: null, // HTMLImageElement | HTMLVideoElement
  ready: false,
};

let idCounter = 0;
const history = { undo: [], redo: [] };

/* ------------------------------------------------------------
   Utilitaires
   ------------------------------------------------------------ */
function newId() {
  idCounter += 1;
  return `b${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function currentKeyframe() {
  const i = Math.min(state.current, state.keyframes.length - 1);
  return state.keyframes[i];
}

function snapshot() {
  history.undo.push(clone(state.keyframes));
  if (history.undo.length > MAX_HISTORY) history.undo.shift();
  history.redo = [];
}

function restore(list) {
  state.keyframes = list;
  state.selectedId = null;
  renderAll();
}

function undo() {
  if (!history.undo.length) return;
  history.redo.push(clone(state.keyframes));
  restore(history.undo.pop());
}

function redo() {
  if (!history.redo.length) return;
  history.undo.push(clone(state.keyframes));
  restore(history.redo.pop());
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Impossible de charger l'image"));
    img.src = url;
  });
}

function loadVideo(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(new Error("Impossible de charger la vidéo"));
    v.src = url;
  });
}

function seekTo(video, time) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001) return resolve();
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}

function drawToCanvas(source, width, height) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  c.getContext("2d").drawImage(source, 0, 0, width, height);
  return c;
}

function makeThumb(source, maxW = 120) {
  const scale = maxW / source.width;
  const c = document.createElement("canvas");
  c.width = maxW;
  c.height = Math.max(1, Math.round(source.height * scale));
  c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

function setStage(stage) {
  state.stage = stage;
  for (const key of Object.keys(views)) {
    views[key].hidden = key !== stage;
  }
}

function setProgress(fraction, message) {
  const pct = Math.round(clamp(fraction, 0, 1) * 100);
  el.progressFill.style.width = `${pct}%`;
  el.progressPct.textContent = `${pct} %`;
  el.progressMsg.textContent = message;
}

function setProgressTitle(title) {
  el.progressTitle.textContent = title;
}

/* ------------------------------------------------------------
   Détection de visages (face-api.js)
   ------------------------------------------------------------ */
const faceapi = window.faceapi;
let modelPromise = null;

function ensureModel() {
  if (modelPromise) return modelPromise;
  modelPromise = faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URI);
  return modelPromise;
}

async function detectFaces(canvas) {
  await ensureModel();
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 416,
    scoreThreshold: 0.3,
  });
  const detections = await faceapi.detectAllFaces(canvas, options);
  const w = canvas.width;
  const h = canvas.height;
  return detections
    .map((d) => ({
      x: d.box.x / w,
      y: d.box.y / h,
      w: d.box.width / w,
      h: d.box.height / h,
      score: d.score,
    }))
    .filter((f) => f.w > 0 && f.h > 0);
}

function expandBox(b, margin) {
  const mx = b.w * margin;
  const my = b.h * margin;
  const x = Math.max(0, b.x - mx);
  const y = Math.max(0, b.y - my);
  const right = Math.min(1, b.x + b.w + mx);
  const bottom = Math.min(1, b.y + b.h + my);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/* ------------------------------------------------------------
   Analyse d'un fichier
   ------------------------------------------------------------ */
async function analyzeFile(file) {
  const url = URL.createObjectURL(file);
  const kind = file.type.startsWith("video") ? "video" : "image";

  if (kind === "image") {
    setProgress(0.05, "Chargement de l'image…");
    const img = await loadImage(url);
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const canvas = drawToCanvas(img, width, height);
    setProgress(0.45, "Détection des visages…");
    const faces = await detectFaces(canvas);
    const boxes = faces.map((f) => {
      const e = expandBox(f, 0.16);
      return { id: newId(), x: e.x, y: e.y, w: e.w, h: e.h, source: "auto" };
    });
    URL.revokeObjectURL(url);
    return {
      meta: { kind, width, height, duration: 0, fps: 1, name: file.name },
      keyframes: [{ time: 0, boxes, thumb: makeThumb(canvas) }],
    };
  }

  setProgress(0.04, "Chargement de la vidéo…");
  const video = await loadVideo(url);
  const width = video.videoWidth;
  const height = video.videoHeight;
  const duration = video.duration || 0;
  const fps = Math.max(1, Math.min(state.fps, 60));

  const times = [];
  for (let t = 0; t < duration; t += 1 / fps) times.push(t);
  if (!times.length) times.push(0);

  setProgress(0.08, "Détection des visages…");

  const keyframes = [];
  for (let i = 0; i < times.length; i++) {
    const time = times[i];
    setProgress(
      0.08 + 0.88 * (i / times.length),
      `Analyse de l'image ${i + 1} / ${times.length}`
    );
    await seekTo(video, time);
    const canvas = drawToCanvas(video, width, height);
    const faces = await detectFaces(canvas);
    const boxes = faces.map((f) => {
      const e = expandBox(f, 0.16);
      return { id: newId(), x: e.x, y: e.y, w: e.w, h: e.h, source: "auto" };
    });
    keyframes.push({ time, boxes, thumb: makeThumb(canvas) });
  }

  URL.revokeObjectURL(url);

  return {
    meta: { kind, width, height, duration, fps, name: file.name },
    keyframes,
  };
}

/* ------------------------------------------------------------
   Interpolation entre images clés
   ------------------------------------------------------------ */
function interpolateBoxes(prev, next, time) {
  if (!prev && !next) return [];
  if (!prev) return next.boxes.map((b) => ({ ...b }));
  if (!next) return prev.boxes.map((b) => ({ ...b }));
  if (next === prev || next.time === prev.time) return prev.boxes.map((b) => ({ ...b }));

  const t = clamp((time - prev.time) / (next.time - prev.time), 0, 1);
  const result = [];
  const matched = new Set();

  for (const pb of prev.boxes) {
    let best = null;
    let bestDist = Infinity;
    for (const nb of next.boxes) {
      if (matched.has(nb.id)) continue;
      const d =
        Math.abs(pb.x + pb.w / 2 - (nb.x + nb.w / 2)) +
        Math.abs(pb.y + pb.h / 2 - (nb.y + nb.h / 2));
      if (d < bestDist) {
        bestDist = d;
        best = nb;
      }
    }
    if (best) {
      matched.add(best.id);
      result.push({
        id: pb.id,
        x: pb.x + (best.x - pb.x) * t,
        y: pb.y + (best.y - pb.y) * t,
        w: pb.w + (best.w - pb.w) * t,
        h: pb.h + (best.h - pb.h) * t,
        source: pb.source,
      });
    } else if (t < 0.5) {
      result.push({ ...pb });
    }
  }
  if (t >= 0.5) {
    for (const nb of next.boxes) {
      if (!matched.has(nb.id)) result.push({ ...nb });
    }
  }
  return result;
}

function boxesAtTime(time) {
  if (!state.keyframes.length) return [];
  let prev = null;
  let next = null;
  for (const k of state.keyframes) {
    if (k.time <= time) prev = k;
    if (k.time >= time && !next) next = k;
  }
  return interpolateBoxes(prev, next, time);
}

/* ------------------------------------------------------------
   Rendu (masques)
   ------------------------------------------------------------ */
function drawMasks(ctx, source, boxes, style, width, height, preview, selectedId) {
  for (const b of boxes) {
    const r = {
      x: b.x * width,
      y: b.y * height,
      w: b.w * width,
      h: b.h * height,
    };
    if (r.w <= 1 || r.h <= 1) continue;

    if (preview) {
      const selected = b.id === selectedId;
      ctx.strokeStyle = selected ? "#8b7dff" : "rgba(255,255,255,0.85)";
      ctx.lineWidth = selected ? 3 : 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
      if (selected) drawHandles(ctx, r);
      continue;
    }

    if (style === "box") {
      ctx.fillStyle = "#000";
      ctx.fillRect(r.x, r.y, r.w, r.h);
    } else if (style === "blur") {
      const blur = Math.max(4, Math.round(Math.min(r.w, r.h) / 14));
      const tmp = document.createElement("canvas");
      tmp.width = Math.max(1, Math.round(r.w));
      tmp.height = Math.max(1, Math.round(r.h));
      tmp.getContext("2d").drawImage(source, r.x, r.y, r.w, r.h, 0, 0, tmp.width, tmp.height);
      ctx.save();
      ctx.filter = `blur(${blur}px)`;
      ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, r.x, r.y, r.w, r.h);
      ctx.restore();
    } else if (style === "pixelate") {
      const cell = Math.max(5, Math.round(Math.min(r.w, r.h) / 15));
      const sw = Math.max(2, Math.round(r.w / cell));
      const sh = Math.max(2, Math.round(r.h / cell));
      const tmp = document.createElement("canvas");
      tmp.width = sw;
      tmp.height = sh;
      tmp.getContext("2d").drawImage(source, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  }
}

function drawHandles(ctx, r) {
  const anchors = [
    [r.x, r.y],
    [r.x + r.w / 2, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h / 2],
    [r.x + r.w, r.y + r.h],
    [r.x + r.w / 2, r.y + r.h],
    [r.x, r.y + r.h],
    [r.x, r.y + r.h / 2],
  ];
  ctx.fillStyle = "#8b7dff";
  ctx.strokeStyle = "#0a0a0e";
  ctx.lineWidth = 1.5;
  for (const [hx, hy] of anchors) {
    ctx.beginPath();
    ctx.rect(hx - 4, hy - 4, 8, 8);
    ctx.fill();
    ctx.stroke();
  }
}

function renderFrame(canvas, source, boxes, style, width, height) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, width, height);
  drawMasks(ctx, canvas, boxes, style, width, height, false, null);
}

/* ------------------------------------------------------------
   Éditeur — rendu
   ------------------------------------------------------------ */
function renderBase() {
  const canvas = el.baseCanvas;
  const { width, height } = state.meta;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!state.mediaEl) return;

  if (state.mediaEl instanceof HTMLVideoElement) {
    const kf = currentKeyframe();
    const time = kf ? kf.time : 0;
    const onSeeked = () => {
      ctx.drawImage(state.mediaEl, 0, 0, width, height);
      drawOverlay();
    };
    state.mediaEl.addEventListener("seeked", onSeeked, { once: true });
    state.mediaEl.currentTime = time;
    if (Math.abs(state.mediaEl.currentTime - time) < 0.001) {
      state.mediaEl.removeEventListener("seeked", onSeeked);
      ctx.drawImage(state.mediaEl, 0, 0, width, height);
      drawOverlay();
    }
  } else {
    ctx.drawImage(state.mediaEl, 0, 0, width, height);
    drawOverlay();
  }
}

function drawOverlay() {
  const canvas = el.overlayCanvas;
  const { width, height } = state.meta;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);

  const kf = currentKeyframe();
  if (!kf) return;
  drawMasks(ctx, canvas, kf.boxes, state.style, width, height, true, state.selectedId);

  el.emptyHint.hidden = kf.boxes.length !== 0;
}

function renderAll() {
  renderBase();
  updatePanel();
  renderTimeline();
}

function updatePanel() {
  const kf = currentKeyframe();
  const count = kf ? kf.boxes.length : 0;
  el.faceCount.textContent = String(count);
  el.btnDelete.disabled = !state.selectedId;
}

/* ------------------------------------------------------------
   Timeline
   ------------------------------------------------------------ */
function renderTimeline() {
  const isVideo = state.meta.kind === "video";
  el.timeline.hidden = !isVideo;
  document.querySelectorAll("[data-video-only]").forEach((n) => (n.hidden = !isVideo));
  el.formatSection.hidden = isVideo;
  if (!isVideo) return;

  el.timelineScroll.innerHTML = "";
  state.keyframes.forEach((kf, i) => {
    const btn = document.createElement("button");
    btn.className = `frame-thumb${i === state.current ? " active" : ""}`;
    btn.type = "button";
    btn.title = `${kf.time.toFixed(2)} s`;
    btn.innerHTML = kf.thumb
      ? `<img src="${kf.thumb}" alt="" /><span class="thumb-time">${kf.time.toFixed(1)}s</span>`
      : `<span class="frame-thumb empty"></span>`;
    btn.addEventListener("click", () => {
      state.current = i;
      state.selectedId = null;
      renderAll();
    });
    el.timelineScroll.appendChild(btn);
  });

  el.timelineInfo.textContent =
    `${state.meta.name} · ${state.meta.duration.toFixed(1)} s · ` +
    `${state.keyframes.length} images analysées · ${state.meta.width}×${state.meta.height}`;
}

/* ------------------------------------------------------------
   Mutations des masques
   ------------------------------------------------------------ */
function mutateBoxes(fn) {
  snapshot();
  state.keyframes = state.keyframes.map((k, i) =>
    i === state.current ? { ...k, boxes: fn(k.boxes) } : k
  );
  renderAll();
}

function addBox() {
  const box = { id: newId(), x: 0.3, y: 0.25, w: 0.4, h: 0.5, source: "manual" };
  mutateBoxes((boxes) => [...boxes, box]);
  state.selectedId = box.id;
  renderAll();
}

function deleteSelected() {
  if (!state.selectedId) return;
  mutateBoxes((boxes) => boxes.filter((b) => b.id !== state.selectedId));
  state.selectedId = null;
  renderAll();
}

function clearAll() {
  mutateBoxes(() => []);
  state.selectedId = null;
  renderAll();
}

function applyToAll() {
  const kf = currentKeyframe();
  if (!kf) return;
  snapshot();
  const boxes = clone(kf.boxes);
  state.keyframes = state.keyframes.map((k) => ({ ...k, boxes: clone(boxes) }));
  renderAll();
}

function updateBox(boxId, next) {
  state.keyframes = state.keyframes.map((k, i) =>
    i === state.current
      ? { ...k, boxes: k.boxes.map((b) => (b.id === boxId ? next : b)) }
      : k
  );
  drawOverlay();
}

/* ------------------------------------------------------------
   Interactions pointeur
   ------------------------------------------------------------ */
const interaction = { type: null, boxId: null, startPx: 0, startPy: 0, startBox: null };

function moveBox(b, dx, dy) {
  return { ...b, x: clamp(b.x + dx, 0, 1 - b.w), y: clamp(b.y + dy, 0, 1 - b.h) };
}

function resizeBox(b, dir, dx, dy) {
  let { x, y, w, h } = b;
  if (dir.includes("w")) {
    const nx = clamp(x + dx, 0, x + w - MIN_BOX);
    w = x + w - nx;
    x = nx;
  }
  if (dir.includes("e")) w = clamp(w + dx, MIN_BOX, 1 - x);
  if (dir.includes("n")) {
    const ny = clamp(y + dy, 0, y + h - MIN_BOX);
    h = y + h - ny;
    y = ny;
  }
  if (dir.includes("s")) h = clamp(h + dy, MIN_BOX, 1 - y);
  return { ...b, x, y, w, h };
}

function hitHandle(px, py, r) {
  const anchors = [
    ["nw", r.x, r.y],
    ["n", r.x + r.w / 2, r.y],
    ["ne", r.x + r.w, r.y],
    ["e", r.x + r.w, r.y + r.h / 2],
    ["se", r.x + r.w, r.y + r.h],
    ["s", r.x + r.w / 2, r.y + r.h],
    ["sw", r.x, r.y + r.h],
    ["w", r.x, r.y + r.h / 2],
  ];
  for (const [dir, ax, ay] of anchors) {
    if (Math.hypot(px - ax, py - ay) <= HANDLE_RADIUS) return dir;
  }
  return null;
}

function hitTest(px, py, rect) {
  const kf = currentKeyframe();
  if (!kf) return null;
  for (let i = kf.boxes.length - 1; i >= 0; i--) {
    const b = kf.boxes[i];
    const r = { x: b.x * rect.width, y: b.y * rect.height, w: b.w * rect.width, h: b.h * rect.height };
    const handle = hitHandle(px, py, r);
    if (handle) return { boxId: b.id, handle };
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      return { boxId: b.id, handle: null };
    }
  }
  return null;
}

function onPointerDown(e) {
  const canvas = el.overlayCanvas;
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const hit = hitTest(px, py, rect);

  if (hit) {
    const kf = currentKeyframe();
    const box = kf.boxes.find((b) => b.id === hit.boxId);
    if (!box) return;
    snapshot();
    state.selectedId = hit.boxId;
    interaction.type = hit.handle || "move";
    interaction.boxId = hit.boxId;
    interaction.startPx = px;
    interaction.startPy = py;
    interaction.startBox = { ...box };
    canvas.setPointerCapture(e.pointerId);
    drawOverlay();
    updatePanel();
  } else {
    state.selectedId = null;
    drawOverlay();
    updatePanel();
  }
}

function onPointerMove(e) {
  const inter = interaction;
  if (!inter.type) return;
  const canvas = el.overlayCanvas;
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const dx = (px - inter.startPx) / rect.width;
  const dy = (py - inter.startPy) / rect.height;
  const next =
    inter.type === "move"
      ? moveBox(inter.startBox, dx, dy)
      : resizeBox(inter.startBox, inter.type, dx, dy);
  updateBox(inter.boxId, next);
}

function onPointerUp(e) {
  interaction.type = null;
  interaction.boxId = null;
  interaction.startBox = null;
  el.overlayCanvas.releasePointerCapture(e.pointerId);
}

/* ------------------------------------------------------------
   Raccourcis clavier
   ------------------------------------------------------------ */
function onKeyDown(e) {
  if (state.stage !== "editing") return;
  const kf = currentKeyframe();
  if (!kf) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
    return;
  }
  if (e.key === "Escape") {
    state.selectedId = null;
    drawOverlay();
    updatePanel();
    return;
  }

  const step = e.shiftKey ? 0.02 : 0.005;

  const dirMove = (dx, dy) => {
    if (!state.selectedId) return;
    snapshot();
    state.keyframes = state.keyframes.map((k, i) =>
      i === state.current
        ? {
            ...k,
            boxes: k.boxes.map((b) => (b.id === state.selectedId ? moveBox(b, dx, dy) : b)),
          }
        : k
    );
    drawOverlay();
  };

  switch (e.key) {
    case "ArrowLeft":
      e.preventDefault();
      dirMove(-step, 0);
      break;
    case "ArrowRight":
      e.preventDefault();
      dirMove(step, 0);
      break;
    case "ArrowUp":
      e.preventDefault();
      dirMove(0, -step);
      break;
    case "ArrowDown":
      e.preventDefault();
      dirMove(0, step);
      break;
    case "Delete":
    case "Backspace":
      e.preventDefault();
      deleteSelected();
      break;
    case "+":
    case "=":
      e.preventDefault();
      addBox();
      break;
  }
}

/* ------------------------------------------------------------
   Export
   ------------------------------------------------------------ */
function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

async function exportImage() {
  const { meta } = state;
  const img = state.mediaEl;
  const canvas = document.createElement("canvas");
  const source = document.createElement("canvas");
  source.width = meta.width;
  source.height = meta.height;
  source.getContext("2d").drawImage(img, 0, 0, meta.width, meta.height);

  const kf = currentKeyframe();
  const boxes = kf ? kf.boxes : [];
  renderFrame(canvas, source, boxes, state.style, meta.width, meta.height);

  const mime = state.format === "jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export échoué"))), mime, 0.92)
  );
  return blob;
}

async function exportVideo(onProgress) {
  const { meta } = state;
  const video = state.mediaEl;
  const fps = meta.fps;

  const canvas = document.createElement("canvas");
  const source = document.createElement("canvas");
  source.width = meta.width;
  source.height = meta.height;
  const sctx = source.getContext("2d");

  const mime = pickMimeType();
  const stream = canvas.captureStream(fps);
  const recorder = mime
    ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
    : new MediaRecorder(stream);

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime || "video/webm" }));
    recorder.onerror = () => reject(new Error("Enregistrement échoué"));
  });

  const totalFrames = Math.max(1, Math.floor(meta.duration * fps));
  recorder.start(200);

  await seekTo(video, 0);
  const t0 = performance.now();

  for (let i = 0; i <= totalFrames; i++) {
    const time = Math.min(meta.duration, i / fps);
    await seekTo(video, time);
    sctx.drawImage(video, 0, 0, meta.width, meta.height);
    renderFrame(canvas, source, boxesAtTime(time), state.style, meta.width, meta.height);
    onProgress(i / totalFrames, `Encodage de l'image ${i} / ${totalFrames}`);
    const target = ((i + 1) / fps) * 1000;
    const elapsed = performance.now() - t0;
    const wait = target - elapsed;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  recorder.stop();
  return stopped;
}

async function doExport() {
  const { meta, file } = state;
  const base = (file.name || "fichier").replace(/\.[^.]+$/, "");

  el.btnExport.disabled = true;

  try {
    if (meta.kind === "image") {
      setStage("processing");
      setProgressTitle("Export en cours");
      setProgress(0.3, "Préparation de l'image…");
      const blob = await exportImage();
      setProgress(1, "Terminé");
      downloadBlob(blob, `${base}_masque.${state.format === "jpeg" ? "jpg" : "png"}`);
      setStage("editing");
    } else {
      setStage("processing");
      setProgressTitle("Encodage de l'export");
      setProgress(0, "Préparation…");
      const blob = await exportVideo((fraction, message) => setProgress(fraction, message));
      downloadBlob(blob, `${base}_masque.webm`);
      setStage("editing");
    }
  } catch (err) {
    console.error(err);
    alert("L'export a échoué. Essayez avec un autre format ou un autre fichier.");
    setStage("editing");
  } finally {
    el.btnExport.disabled = false;
  }
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------
   Gestion du fichier entrant
   ------------------------------------------------------------ */
async function handleFile(file) {
  el.dzError.hidden = true;
  if (!file) return;
  if (!file.type.startsWith("image") && !file.type.startsWith("video")) {
    el.dzError.textContent = "Format non pris en charge. Déposez une image ou une vidéo.";
    el.dzError.hidden = false;
    return;
  }

  setProgressTitle("Analyse en cours");
  setProgress(0, "Initialisation…");
  setStage("processing");

  try {
    const res = await analyzeFile(file);
    state.file = file;
    state.objectUrl = URL.createObjectURL(file);
    state.meta = res.meta;
    state.keyframes = res.keyframes;
    state.current = 0;
    state.selectedId = null;
    state.style = "box";
    state.format = "png";
    history.undo = [];
    history.redo = [];

    await loadMedia();
    setStage("editing");
    renderAll();
  } catch (err) {
    console.error(err);
    el.dzError.textContent = "Une erreur est survenue pendant l'analyse. Essayez un autre fichier.";
    el.dzError.hidden = false;
    setStage("upload");
  }
}

async function loadMedia() {
  const url = state.objectUrl;
  if (state.meta.kind === "video") {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    await new Promise((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("Impossible de charger la vidéo"));
      v.src = url;
    });
    state.mediaEl = v;
  } else {
    const img = await loadImage(url);
    state.mediaEl = img;
  }
  state.ready = true;
}

function resetToUpload() {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  if (state.mediaEl instanceof HTMLVideoElement) {
    state.mediaEl.pause();
    state.mediaEl.src = "";
  }
  state.file = null;
  state.objectUrl = null;
  state.mediaEl = null;
  state.ready = false;
  state.keyframes = [];
  state.current = 0;
  state.selectedId = null;
  history.undo = [];
  history.redo = [];
  setStage("upload");
}

/* ------------------------------------------------------------
   Câblage des événements
   ------------------------------------------------------------ */
function wireEvents() {
  // Dropzone
  el.dropzone.addEventListener("click", () => el.fileInput.click());
  el.dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") el.fileInput.click();
  });
  el.dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.dropzone.classList.add("dragging");
  });
  el.dropzone.addEventListener("dragleave", () => el.dropzone.classList.remove("dragging"));
  el.dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    el.dropzone.classList.remove("dragging");
    handleFile(e.dataTransfer.files && e.dataTransfer.files[0]);
  });
  el.fileInput.addEventListener("change", (e) => handleFile(e.target.files && e.target.files[0]));

  // Collage (Ctrl+V)
  document.addEventListener("paste", (e) => {
    if (state.stage !== "upload") return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image") || item.type.startsWith("video")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleFile(file);
          return;
        }
      }
    }
  });

  // FPS
  el.fpsChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      el.fpsChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.fps = parseInt(chip.dataset.fps, 10);
    });
  });

  // Style
  el.styleChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      el.styleChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.style = chip.dataset.style;
      drawOverlay();
    });
  });

  // Format
  el.formatChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      el.formatChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.format = chip.dataset.format;
    });
  });

  // Éditeur
  el.overlayCanvas.addEventListener("pointerdown", onPointerDown);
  el.overlayCanvas.addEventListener("pointermove", onPointerMove);
  el.overlayCanvas.addEventListener("pointerup", onPointerUp);
  el.overlayCanvas.addEventListener("pointercancel", onPointerUp);

  el.btnAdd.addEventListener("click", addBox);
  el.btnDelete.addEventListener("click", deleteSelected);
  el.btnClear.addEventListener("click", clearAll);
  el.btnApplyAll.addEventListener("click", applyToAll);
  el.btnNew.addEventListener("click", resetToUpload);
  el.btnExport.addEventListener("click", doExport);

  document.addEventListener("keydown", onKeyDown);
}

/* ------------------------------------------------------------
   Démarrage
   ------------------------------------------------------------ */
function init() {
  wireEvents();
  setStage("upload");
  // Pré-chauffage du modèle de détection en arrière-plan.
  if (faceapi && faceapi.nets) ensureModel().catch(() => {});
  // Cache hors ligne (progressive enhancement).
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

init();
