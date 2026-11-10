"use client";

import { useSyncExternalStore } from "react";
import { observatorySimulation } from "@/simulation/observatory-store";

export function useObservatorySimulation() {
  return useSyncExternalStore(
    observatorySimulation.subscribe,
    observatorySimulation.getSnapshot,
    observatorySimulation.getServerSnapshot,
  );
}
