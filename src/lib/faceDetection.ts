import * as faceapi from "@vladmandic/face-api";

let readyPromise: Promise<void> | null = null;

export interface DetectedFace {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

export function ensureFaceModel(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = faceapi.nets.tinyFaceDetector.loadFromUri(
    `${import.meta.env.BASE_URL}models`
  );
  return readyPromise;
}

const opts = () =>
  new faceapi.TinyFaceDetectorOptions({
    inputSize: 384,
    scoreThreshold: 0.35,
  });

export async function detectFaces(
  source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
  width: number,
  height: number
): Promise<DetectedFace[]> {
  await ensureFaceModel();
  const detections = await faceapi.detectAllFaces(source, opts());
  const isImage = source instanceof HTMLImageElement;
  const scaleX = isImage ? source.naturalWidth || width : width;
  const scaleY = isImage ? source.naturalHeight || height : height;
  return detections
    .map((d) => {
      const { x, y, width: w, height: h } = d.box;
      return {
        x: x / scaleX,
        y: y / scaleY,
        w: w / scaleX,
        h: h / scaleY,
        score: d.score,
      };
    })
    .filter((f) => f.w > 0 && f.h > 0);
}

/** Expand a normalized box by a margin (all directions) and clamp to [0,1]. */
export function expandBox(
  b: { x: number; y: number; w: number; h: number },
  margin: number
): { x: number; y: number; w: number; h: number } {
  const mx = b.w * margin;
  const my = b.h * margin;
  const x = Math.max(0, b.x - mx);
  const y = Math.max(0, b.y - my);
  const right = Math.min(1, b.x + b.w + mx);
  const bottom = Math.min(1, b.y + b.h + my);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}
