import type { FaceBox, MaskStyle } from "../types";

export interface DrawOptions {
  boxes: FaceBox[];
  style: MaskStyle;
  width: number;
  height: number;
  /** draw selection highlight (no actual mask) for editing */
  preview?: boolean;
  selectedId?: string | null;
}

function boxRect(b: FaceBox, width: number, height: number) {
  return {
    x: b.x * width,
    y: b.y * height,
    w: b.w * width,
    h: b.h * height,
  };
}

/** Draw masks onto ctx. `source` is the canvas already containing the frame. */
export function drawMasks(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  opts: DrawOptions
) {
  const { boxes, style, width, height, preview } = opts;

  for (const b of boxes) {
    const r = boxRect(b, width, height);
    if (r.w <= 1 || r.h <= 1) continue;

    if (preview) {
      ctx.strokeStyle = b.id === opts.selectedId ? "#8b7bff" : "rgba(255,255,255,0.85)";
      ctx.lineWidth = b.id === opts.selectedId ? 3 : 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
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
      tmp
        .getContext("2d")!
        .drawImage(source, r.x, r.y, r.w, r.h, 0, 0, tmp.width, tmp.height);
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
      tmp
        .getContext("2d")!
        .drawImage(source, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  }
}

/** Fill an entire frame canvas with the source content + masks. */
export function renderFrame(
  canvas: HTMLCanvasElement,
  source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement,
  opts: DrawOptions
) {
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, opts.width, opts.height);
  drawMasks(ctx, canvas, opts);
}
