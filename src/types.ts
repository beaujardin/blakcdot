export type MaskStyle = "box" | "blur" | "pixelate";

export interface FaceBox {
  id: string;
  /** normalized 0..1 relative to media width */
  x: number;
  /** normalized 0..1 relative to media height */
  y: number;
  /** normalized 0..1 */
  w: number;
  /** normalized 0..1 */
  h: number;
  source: "auto" | "manual";
}

export interface Keyframe {
  /** time in seconds */
  time: number;
  boxes: FaceBox[];
  /** small preview data-url for the timeline */
  thumb?: string;
}

export interface MediaMeta {
  kind: "image" | "video";
  width: number;
  height: number;
  duration: number;
  fps: number;
  name: string;
}

export interface ProjectState {
  file: File;
  objectUrl: string;
  meta: MediaMeta;
  keyframes: Keyframe[];
  style: MaskStyle;
  /** whether to apply auto-detection result */
  showMasks: boolean;
}
