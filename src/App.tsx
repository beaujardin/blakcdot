import { useCallback, useState } from "react";
import type { FaceBox, Keyframe, MaskStyle, MediaMeta } from "./types";
import { analyzeFile } from "./lib/processing";
import { exportImage, exportVideo } from "./lib/export";
import UploadScreen from "./components/UploadScreen";
import EditorScreen from "./components/EditorScreen";
import ProgressOverlay from "./components/ProgressOverlay";

type Stage = "upload" | "processing" | "editing" | "exporting";

interface Project {
  file: File;
  objectUrl: string;
  meta: MediaMeta;
  keyframes: Keyframe[];
}

export default function App() {
  const [stage, setStage] = useState<Stage>("upload");
  const [project, setProject] = useState<Project | null>(null);
  const [progress, setProgress] = useState({ fraction: 0, message: "" });
  const [defaultFps, setDefaultFps] = useState(6);

  const handleFile = useCallback(async (file: File) => {
    setStage("processing");
    setProgress({ fraction: 0, message: "Initialisation…" });
    try {
      const res = await analyzeFile(file, {
        fps: defaultFps,
        onProgress: (fraction, message) => setProgress({ fraction, message }),
      });
      const objectUrl = URL.createObjectURL(file);
      setProject({ file, objectUrl, meta: res.meta, keyframes: res.keyframes });
      setStage("editing");
    } catch (err) {
      console.error(err);
      alert(
        "Une erreur est survenue pendant l'analyse. Essayez avec un autre fichier."
      );
      setStage("upload");
    }
  }, [defaultFps]);

  const handleExport = useCallback(
    async (keyframes: Keyframe[], style: MaskStyle) => {
      if (!project) return;
      setStage("exporting");
      setProgress({ fraction: 0, message: "Préparation…" });
      try {
        let blob: Blob;
        let ext: string;
        if (project.meta.kind === "image") {
          const boxes: FaceBox[] = keyframes[0]?.boxes ?? [];
          blob = await exportImage(project.objectUrl, project.meta, boxes, style);
          ext = "png";
        } else {
          blob = await exportVideo(
            project.objectUrl,
            project.meta,
            keyframes,
            style,
            (fraction, message) => setProgress({ fraction, message })
          );
          ext = "webm";
        }
        const base = project.file.name.replace(/\.[^.]+$/, "");
        const a = document.createElement("a");
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = `${base}_anonymise.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        setStage("editing");
      } catch (err) {
        console.error(err);
        alert("L'export a échoué. Réessayez.");
        setStage("editing");
      }
    },
    [project]
  );

  const handleReset = useCallback(() => {
    if (project) URL.revokeObjectURL(project.objectUrl);
    setProject(null);
    setStage("upload");
  }, [project]);

  return (
    <div className="app">
      {stage === "upload" && (
        <UploadScreen
          onFile={handleFile}
          fps={defaultFps}
          onFpsChange={setDefaultFps}
        />
      )}
      {stage === "processing" && (
        <ProgressOverlay
          fraction={progress.fraction}
          message={progress.message}
          title="Analyse en cours"
        />
      )}
      {stage === "editing" && project && (
        <EditorScreen
          project={project}
          onExport={handleExport}
          onReset={handleReset}
        />
      )}
      {stage === "exporting" && (
        <ProgressOverlay
          fraction={progress.fraction}
          message={progress.message}
          title="Encodage de l'export"
        />
      )}
    </div>
  );
}
