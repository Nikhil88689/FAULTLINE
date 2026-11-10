"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { pageEnter } from "@/animations/variants";

export function PageTransition({ pathname, children }: { pathname: string; children: ReactNode }) {
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        className="route-transition"
        variants={pageEnter}
        initial={reducedMotion ? false : "initial"}
        animate="enter"
        exit={reducedMotion ? undefined : "exit"}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
