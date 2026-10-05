import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { FaceBox, Keyframe, MaskStyle, MediaMeta } from "../types";
import { newId } from "../lib/processing";
import { drawMasks } from "../lib/render";

interface Project {
  objectUrl: string;
  meta: MediaMeta;
  keyframes: Keyframe[];
  file: File;
}

interface Props {
  project: Project;
  onExport: (keyframes: Keyframe[], style: MaskStyle) => void;
  onReset: () => void;
}

type HandleDir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function moveBox(b: FaceBox, dx: number, dy: number): FaceBox {
  const x = clamp(b.x + dx, 0, 1 - b.w);
  const y = clamp(b.y + dy, 0, 1 - b.h);
  return { ...b, x, y };
}

function resizeBox(b: FaceBox, dir: HandleDir, dx: number, dy: number): FaceBox {
  const min = 0.02;
  let { x, y, w, h } = b;
  if (dir.includes("w")) {
    const nx = clamp(x + dx, 0, x + w - min);
    w = x + w - nx;
    x = nx;
  }
  if (dir.includes("e")) {
    w = clamp(w + dx, min, 1 - x);
  }
  if (dir.includes("n")) {
    const ny = clamp(y + dy, 0, y + h - min);
    h = y + h - ny;
    y = ny;
  }
  if (dir.includes("s")) {
    h = clamp(h + dy, min, 1 - y);
  }
  return { ...b, x, y, w, h };
}

export default function EditorScreen({ project, onExport, onReset }: Props) {
  const { meta, objectUrl, file } = project;
  const [keyframes, setKeyframes] = useState<Keyframe[]>(() =>
    project.keyframes.map((k) => ({ ...k, boxes: k.boxes.map((b) => ({ ...b })) }))
  );
  const [current, setCurrent] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [style, setStyle] = useState<MaskStyle>("box");
  const [mediaReady, setMediaReady] = useState(false);

  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const interaction = useRef<{
    type: "move" | HandleDir;
    boxId: string;
    startPx: number;
    startPy: number;
    startBox: FaceBox;
  } | null>(null);

  const currentKeyframe = keyframes[Math.min(current, keyframes.length - 1)];
  const isVideo = meta.kind === "video";

  // Load media element
  useEffect(() => {
    let disposed = false;
    if (isVideo) {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.onloadeddata = () => {
        if (!disposed) setMediaReady(true);
      };
      v.src = objectUrl;
      mediaRef.current = v;
      v.currentTime = 0;
    } else {
      const img = new Image();
      img.onload = () => {
        if (!disposed) setMediaReady(true);
      };
      img.src = objectUrl;
      mediaRef.current = img;
    }
    return () => {
      disposed = true;
      if (mediaRef.current instanceof HTMLVideoElement) {
        mediaRef.current.pause();
        mediaRef.current.src = "";
      }
      mediaRef.current = null;
    };
  }, [isVideo, objectUrl]);

  // Draw base frame whenever current frame or media readiness changes
  useEffect(() => {
    if (!mediaReady || !currentKeyframe) return;
    const canvas = baseRef.current;
    if (!canvas) return;
    canvas.width = meta.width;
    canvas.height = meta.height;
    const ctx = canvas.getContext("2d")!;
    const media = mediaRef.current;
    if (!media) return;

    const time = currentKeyframe.time;

    if (media instanceof HTMLVideoElement) {
      const onSeeked = () => {
        ctx.drawImage(media, 0, 0, meta.width, meta.height);
      };
      media.addEventListener("seeked", onSeeked, { once: true });
      media.currentTime = time;
      if (Math.abs(media.currentTime - time) < 0.001) {
        media.removeEventListener("seeked", onSeeked);
        ctx.drawImage(media, 0, 0, meta.width, meta.height);
      }
    } else {
      ctx.drawImage(media, 0, 0, meta.width, meta.height);
    }
  }, [mediaReady, current, currentKeyframe, meta.width, meta.height]);

  // Draw overlay (boxes) whenever boxes/selection change
  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    canvas.width = meta.width;
    canvas.height = meta.height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!currentKeyframe) return;
    drawMasks(ctx, canvas, {
      boxes: currentKeyframe.boxes,
      style,
      width: meta.width,
      height: meta.height,
      preview: true,
      selectedId,
    });
  }, [currentKeyframe, style, selectedId, meta.width, meta.height]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId) return;
      const step = e.shiftKey ? 0.02 : 0.005;
      const dir = (dx: number, dy: number) => {
        setKeyframes((prev) =>
          prev.map((k, i) =>
            i === current
              ? {
                  ...k,
                  boxes: k.boxes.map((b) =>
                    b.id === selectedId ? moveBox(b, dx, dy) : b
                  ),
                }
              : k
          )
        );
      };
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          dir(-step, 0);
          break;
        case "ArrowRight":
          e.preventDefault();
          dir(step, 0);
          break;
        case "ArrowUp":
          e.preventDefault();
          dir(0, -step);
          break;
        case "ArrowDown":
          e.preventDefault();
          dir(0, step);
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          deleteSelected();
          break;
        case "Escape":
          setSelectedId(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, current]);

  function updateBox(boxId: string, next: FaceBox) {
    setKeyframes((prev) =>
      prev.map((k, i) =>
        i === current
          ? { ...k, boxes: k.boxes.map((b) => (b.id === boxId ? next : b)) }
          : k
      )
    );
  }

  function deleteSelected() {
    if (!selectedId) return;
    setKeyframes((prev) =>
      prev.map((k, i) =>
        i === current
          ? { ...k, boxes: k.boxes.filter((b) => b.id !== selectedId) }
          : k
      )
    );
    setSelectedId(null);
  }

  function addBox() {
    const box: FaceBox = {
      id: newId(),
      x: 0.3,
      y: 0.25,
      w: 0.4,
      h: 0.5,
      source: "manual",
    };
    setKeyframes((prev) =>
      prev.map((k, i) =>
        i === current ? { ...k, boxes: [...k.boxes, box] } : k
      )
    );
    setSelectedId(box.id);
  }

  function hitTest(px: number, py: number, rect: DOMRect) {
    if (!currentKeyframe) return null;
    const boxes = currentKeyframe.boxes;
    // iterate reversed (topmost first)
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      const dx = b.x * rect.width;
      const dy = b.y * rect.height;
      const dw = b.w * rect.width;
      const dh = b.h * rect.height;
      const handle = hitHandle(px, py, dx, dy, dw, dh);
      if (handle) return { boxId: b.id, handle };
      if (px >= dx && px <= dx + dw && py >= dy && py <= dy + dh) {
        return { boxId: b.id, handle: null };
      }
    }
    return null;
  }

  function hitHandle(
    px: number,
    py: number,
    x: number,
    y: number,
    w: number,
    h: number
  ): HandleDir | null {
    const r = 12;
    const anchors: [HandleDir, number, number][] = [
      ["nw", x, y],
      ["n", x + w / 2, y],
      ["ne", x + w, y],
      ["e", x + w, y + h / 2],
      ["se", x + w, y + h],
      ["s", x + w / 2, y + h],
      ["sw", x, y + h],
      ["w", x, y + h / 2],
    ];
    for (const [dir, ax, ay] of anchors) {
      if (Math.hypot(px - ax, py - ay) <= r) return dir;
    }
    return null;
  }

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = overlayRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const hit = hitTest(px, py, rect);
      if (hit) {
        const box = currentKeyframe.boxes.find((b) => b.id === hit.boxId)!;
        setSelectedId(hit.boxId);
        interaction.current = {
          type: hit.handle ?? "move",
          boxId: hit.boxId,
          startPx: px,
          startPy: py,
          startBox: box,
        };
        canvas.setPointerCapture(e.pointerId);
      } else {
        setSelectedId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentKeyframe]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const inter = interaction.current;
      if (!inter) return;
      const canvas = overlayRef.current;
      if (!canvas) return;
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current]
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      interaction.current = null;
      overlayRef.current?.releasePointerCapture(e.pointerId);
    },
    []
  );

  const frames = useMemo(() => keyframes, [keyframes]);
  const faceCount = currentKeyframe?.boxes.length ?? 0;

  return (
    <div className="editor">
      <header className="topbar editor-top">
        <div className="brand">
          <span className="logo-dot" />
          <span className="brand-name">BlackDot</span>
        </div>
        <div className="editor-actions">
          <div className="style-group" role="group" aria-label="Style de masque">
            <button
              className={`chip ${style === "box" ? "active" : ""}`}
              onClick={() => setStyle("box")}
              type="button"
            >
              Carré
            </button>
            <button
              className={`chip ${style === "blur" ? "active" : ""}`}
              onClick={() => setStyle("blur")}
              type="button"
            >
              Flou
            </button>
            <button
              className={`chip ${style === "pixelate" ? "active" : ""}`}
              onClick={() => setStyle("pixelate")}
              type="button"
            >
              Pixel
            </button>
          </div>
          <button className="btn ghost" onClick={onReset} type="button">
            Nouveau fichier
          </button>
          <button className="btn primary" onClick={() => onExport(keyframes, style)} type="button">
            Télécharger
          </button>
        </div>
      </header>

      <div className="editor-body">
        <div className="canvas-zone">
          <div className="canvas-wrap">
            <canvas ref={baseRef} className="layer base" />
            <canvas
              ref={overlayRef}
              className="layer overlay"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          </div>
        </div>

        <aside className="panel">
          <div className="panel-section">
            <div className="panel-title">Visages détectés</div>
            <div className="face-count">
              <strong>{faceCount}</strong> sur cette image
            </div>
            <div className="panel-btns">
              <button className="btn small" onClick={addBox} type="button">
                + Ajouter un carré
              </button>
              <button
                className="btn small danger"
                onClick={deleteSelected}
                disabled={!selectedId}
                type="button"
              >
                Supprimer
              </button>
            </div>
            <p className="panel-hint">
              Cliquez sur un carré pour le sélectionner, glissez-le pour le
              déplacer, tirez ses poignées pour l'étirer dans tous les sens.
              Flèches = déplacer · Suppr = retirer.
            </p>
          </div>
        </aside>
      </div>

      {isVideo && (
        <div className="timeline">
          <div className="timeline-scroll">
            {frames.map((k, i) => (
              <button
                key={`${k.time}-${i}`}
                className={`frame-thumb ${i === current ? "active" : ""}`}
                onClick={() => {
                  setCurrent(i);
                  setSelectedId(null);
                }}
                type="button"
                title={`${k.time.toFixed(2)}s`}
              >
                {k.thumb ? <img src={k.thumb} alt="" /> : <span className="thumb-empty" />}
                <span className="thumb-time">{k.time.toFixed(1)}s</span>
              </button>
            ))}
          </div>
          <div className="timeline-info">
            {file.name} · {meta.duration.toFixed(1)}s · {keyframes.length} images
            analysées
          </div>
        </div>
      )}
    </div>
  );
}
