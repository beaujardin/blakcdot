interface Props {
  fraction: number;
  message: string;
  title: string;
}

export default function ProgressOverlay({ fraction, message, title }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div className="progress-wrap">
      <div className="progress-card">
        <div className="spinner" />
        <h2 className="progress-title">{title}</h2>
        <p className="progress-msg">{message}</p>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="progress-pct">{pct}%</div>
      </div>
    </div>
  );
}
