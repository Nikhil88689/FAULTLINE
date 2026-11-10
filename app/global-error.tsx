"use client";

export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#05060a",
          color: "#eef5fb",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ maxWidth: 480, textAlign: "center" }}>
            <p style={{ color: "#50dceb", fontSize: 11, letterSpacing: 3 }}>
              FAULTLINE / GLOBAL RECOVERY
            </p>
            <h1 style={{ fontSize: 32 }}>The signal dropped.</h1>
            <p style={{ color: "#9aa9bb", lineHeight: 1.7 }}>
              The application shell encountered an unrecoverable error.
            </p>
            <button
              onClick={unstable_retry}
              style={{
                marginTop: 18,
                padding: "11px 16px",
                color: "#061015",
                background: "#50dceb",
                border: 0,
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Reload workspace
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
