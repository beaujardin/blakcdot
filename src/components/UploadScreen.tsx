import { useCallback, useRef, useState } from "react";

interface Props {
  onFile: (file: File) => void;
  fps: number;
  onFpsChange: (fps: number) => void;
}

const ACCEPT = "image/*,video/*";

export default function UploadScreen({ onFile, fps, onFpsChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      setError(null);
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!file.type.startsWith("image") && !file.type.startsWith("video")) {
        setError("Format non supporté. Déposez une image ou une vidéo.");
        return;
      }
      onFile(file);
    },
    [onFile]
  );

  return (
    <div className="upload">
      <div className="aurora" aria-hidden />
      <header className="topbar">
        <div className="brand">
          <span className="logo-dot" />
          <span className="brand-name">BlackDot</span>
        </div>
        <span className="tagline">Anonymiseur de visages · 100% local</span>
      </header>

      <main className="upload-main">
        <div className="hero-copy">
          <h1 className="hero-title">
            Masquez les visages,
            <br />
            <span className="grad">image par image.</span>
          </h1>
          <p className="hero-sub">
            Détection automatique des visages, carrés noirs ajustables dans tous
            les sens, et export direct de votre photo ou vidéo. Rien ne quitte
            votre navigateur.
          </p>
        </div>

        <div
          className={`dropzone ${drag ? "dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
        >
          <div className="dz-icon">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none">
              <path
                d="M12 16V4m0 0L7 9m5-5 5 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <p className="dz-title">Glissez-déposez votre fichier ici</p>
          <p className="dz-sub">ou cliquez pour parcourir — image ou vidéo</p>
          {error && <p className="dz-error">{error}</p>}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        <div className="fps-row">
          <label className="fps-label" htmlFor="fps">
            Précision vidéo (images analysées par seconde)
          </label>
          <div className="fps-control">
            {[3, 6, 10, 15].map((v) => (
              <button
                key={v}
                className={`chip ${fps === v ? "active" : ""}`}
                onClick={() => onFpsChange(v)}
                type="button"
              >
                {v} i/s
              </button>
            ))}
          </div>
        </div>
      </main>

      <footer className="features">
        <Feature icon="◆" title="Détection auto" desc="Repère les visages tout seul" />
        <Feature icon="⤢" title="Ajustable" desc="Étirez chaque carré dans tous les sens" />
        <Feature icon="⇩" title="Export net" desc="Téléchargez photo ou vidéo" />
      </footer>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="feature">
      <span className="feature-icon">{icon}</span>
      <div>
        <div className="feature-title">{title}</div>
        <div className="feature-desc">{desc}</div>
      </div>
    </div>
  );
}
