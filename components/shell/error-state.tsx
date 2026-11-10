import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

export function ErrorState({
  reset,
  title = "Signal interrupted",
}: {
  reset: () => void;
  title?: string;
}) {
  return (
    <section className="error-state" role="alert">
      <span className="error-icon">
        <AlertTriangle size={19} />
      </span>
      <p className="section-eyebrow">FAULTLINE / RECOVERY</p>
      <h1>{title}</h1>
      <p className="error-copy">
        This view could not be assembled. Your workspace is still available.
      </p>
      <div className="error-actions">
        <button className="button button-primary" type="button" onClick={reset}>
          <RotateCcw size={15} />
          Try again
        </button>
        <Link className="button button-secondary" href="/">
          Return to overview
        </Link>
      </div>
    </section>
  );
}
