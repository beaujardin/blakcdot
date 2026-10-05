import type { FaceBox, Keyframe, MediaMeta } from "../types";
import { detectFaces, expandBox } from "./faceDetection";

let idCounter = 0;
export function newId(): string {
  idCounter += 1;
  return `b${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

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

function drawToCanvas(
  video: HTMLVideoElement,
  width: number,
  height: number
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(video, 0, 0, width, height);
  return c;
}

function makeThumb(source: HTMLCanvasElement, maxW = 120): string {
  const scale = maxW / source.width;
  const c = document.createElement("canvas");
  c.width = maxW;
  c.height = Math.round(source.height * scale);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

async function detectOnCanvas(
  canvas: HTMLCanvasElement
): Promise<FaceBox[]> {
  const faces = await detectFaces(canvas, canvas.width, canvas.height);
  return faces.map((f) => {
    const e = expandBox(f, 0.18);
    return {
      id: newId(),
      x: e.x,
      y: e.y,
      w: e.w,
      h: e.h,
      source: "auto" as const,
    };
  });
}

export interface AnalyzeOptions {
  fps: number;
  onProgress: (fraction: number, message: string) => void;
}

export interface AnalyzeResult {
  meta: MediaMeta;
  keyframes: Keyframe[];
}

export async function analyzeFile(
  file: File,
  opts: AnalyzeOptions
): Promise<AnalyzeResult> {
  const url = URL.createObjectURL(file);
  const kind = file.type.startsWith("video") ? "video" : "image";

  if (kind === "image") {
    opts.onProgress(0.05, "Chargement de l'image…");
    const img = await loadImage(url);
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    opts.onProgress(0.5, "Détection des visages…");
    const boxes = await detectOnCanvas(canvas);
    const kf: Keyframe = { time: 0, boxes, thumb: makeThumb(canvas) };
    return {
      meta: {
        kind,
        width,
        height,
        duration: 0,
        fps: 1,
        name: file.name,
      },
      keyframes: [kf],
    };
  }

  opts.onProgress(0.05, "Chargement de la vidéo…");
  const video = await loadVideo(url);
  const width = video.videoWidth;
  const height = video.videoHeight;
  const duration = video.duration || 0;
  const fps = Math.max(1, Math.min(opts.fps, 60));

  const times: number[] = [];
  for (let t = 0; t < duration; t += 1 / fps) {
    times.push(t);
  }
  if (times.length === 0) times.push(0);

  const keyframes: Keyframe[] = [];
  for (let i = 0; i < times.length; i++) {
    const time = times[i];
    const progress = 0.1 + 0.85 * (i / times.length);
    opts.onProgress(progress, `Analyse image ${i + 1}/${times.length}`);
    await seekTo(video, time);
    const canvas = drawToCanvas(video, width, height);
    const boxes = await detectOnCanvas(canvas);
    keyframes.push({ time, boxes, thumb: makeThumb(canvas) });
  }

  URL.revokeObjectURL(url);

  return {
    meta: { kind, width, height, duration, fps, name: file.name },
    keyframes,
  };
}

/** Linear interpolation of boxes between two keyframes. */
export function interpolateBoxes(
  prev: Keyframe | null,
  next: Keyframe | null,
  time: number
): FaceBox[] {
  if (!prev && !next) return [];
  if (!prev) return next!.boxes.map((b) => ({ ...b }));
  if (!next) return prev.boxes.map((b) => ({ ...b }));
  if (next === prev || next.time === prev.time)
    return prev.boxes.map((b) => ({ ...b }));

  const t = (time - prev.time) / (next.time - prev.time);
  const clampT = Math.max(0, Math.min(1, t));

  const result: FaceBox[] = [];
  const matched = new Set<string>();

  for (const pb of prev.boxes) {
    // find nearest box in next by center distance
    let best: FaceBox | null = null;
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
        x: pb.x + (best.x - pb.x) * clampT,
        y: pb.y + (best.y - pb.y) * clampT,
        w: pb.w + (best.w - pb.w) * clampT,
        h: pb.h + (best.h - pb.h) * clampT,
        source: pb.source,
      });
    } else if (clampT < 0.5) {
      result.push({ ...pb });
    }
  }

  if (clampT >= 0.5) {
    for (const nb of next.boxes) {
      if (!matched.has(nb.id)) result.push({ ...nb });
    }
  }

  return result;
}
