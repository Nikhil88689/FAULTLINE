"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/shell/error-state";

export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("FAULTLINE route boundary:", error);
  }, [error]);

  return <ErrorState reset={reset} />;
}
