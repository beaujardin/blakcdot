import type { FaceBox, Keyframe, MediaMeta, MaskStyle } from "../types";
import { renderFrame } from "./render";
import { interpolateBoxes } from "./processing";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Impossible de charger l'image"));
    img.src = url;
  });
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
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

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}

function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "";
}

export async function exportImage(
  objectUrl: string,
  meta: MediaMeta,
  boxes: FaceBox[],
  style: MaskStyle
): Promise<Blob> {
  const img = await loadImage(objectUrl);
  const canvas = document.createElement("canvas");
  const source = document.createElement("canvas");
  source.width = meta.width;
  source.height = meta.height;
  source.getContext("2d")!.drawImage(img, 0, 0, meta.width, meta.height);
  renderFrame(canvas, source, {
    boxes,
    style,
    width: meta.width,
    height: meta.height,
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Export échoué"))),
      "image/png"
    );
  });
}

export async function exportVideo(
  objectUrl: string,
  meta: MediaMeta,
  keyframes: Keyframe[],
  style: MaskStyle,
  onProgress: (fraction: number, message: string) => void
): Promise<Blob> {
  const video = await loadVideo(objectUrl);
  const fps = meta.fps;
  const duration = meta.duration;

  const canvas = document.createElement("canvas");
  canvas.width = meta.width;
  canvas.height = meta.height;
  const source = document.createElement("canvas");
  source.width = meta.width;
  source.height = meta.height;
  const sctx = source.getContext("2d")!;

  const mime = pickMimeType();
  const stream = canvas.captureStream(fps);
  const recorder = mime
    ? new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 8_000_000,
      })
    : new MediaRecorder(stream);

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime || "video/webm" });
      resolve(blob);
    };
    recorder.onerror = () => reject(new Error("Enregistrement échoué"));
  });

  const totalFrames = Math.max(1, Math.floor(duration * fps));
  recorder.start(200);

  await seekTo(video, 0);
  const t0 = performance.now();

  for (let i = 0; i <= totalFrames; i++) {
    const time = Math.min(duration, i / fps);
    await seekTo(video, time);
    sctx.drawImage(video, 0, 0, meta.width, meta.height);
    const boxes = boxesAtTime(keyframes, time);
    renderFrame(canvas, source, {
      boxes,
      style,
      width: meta.width,
      height: meta.height,
    });
    onProgress(i / totalFrames, `Encodage image ${i}/${totalFrames}`);
    // Pace to real-time so captureStream samples every frame exactly once.
    const target = ((i + 1) / fps) * 1000;
    const elapsed = performance.now() - t0;
    const wait = target - elapsed;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  recorder.stop();
  return stopped;
}

function boxesAtTime(keyframes: Keyframe[], time: number): FaceBox[] {
  if (keyframes.length === 0) return [];
  let prev: Keyframe | null = null;
  let next: Keyframe | null = null;
  for (const k of keyframes) {
    if (k.time <= time) prev = k;
    if (k.time >= time && !next) next = k;
  }
  return interpolateBoxes(prev, next, time);
}
