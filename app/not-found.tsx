import Link from "next/link";
import { ArrowLeft, Radar } from "lucide-react";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <span className="not-found-mark">
        <Radar size={22} />
      </span>
      <p className="section-eyebrow">FAULTLINE / ROUTE NOT FOUND</p>
      <h1>We lost this signal.</h1>
      <p>The requested observatory channel is not part of this workspace.</p>
      <Link className="button button-primary" href="/">
        <ArrowLeft size={15} />
        Back to overview
      </Link>
    </main>
  );
}
