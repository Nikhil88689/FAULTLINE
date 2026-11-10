"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { riseIn } from "@/animations/variants";

export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={riseIn}
      initial={reducedMotion ? false : "hidden"}
      whileInView="visible"
      viewport={{ once: true, amount: 0.16, margin: "0px 0px -36px 0px" }}
      transition={{ delay: reducedMotion ? 0 : delay }}
    >
      {children}
    </motion.div>
  );
}
