import type { Variants } from "motion/react";
import { motionDuration, motionEase, motionStagger } from "@/animations/tokens";

export const riseIn: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: motionDuration.content, ease: motionEase.entrance },
  },
};

export const cascadeIn: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: motionStagger.content, delayChildren: 0.04 },
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: motionDuration.panel, ease: motionEase.standard },
  },
};

export const pageEnter: Variants = {
  initial: { opacity: 0, y: 8 },
  enter: {
    opacity: 1,
    y: 0,
    transition: { duration: motionDuration.panel, ease: motionEase.entrance },
  },
  exit: { opacity: 0, y: -5, transition: { duration: motionDuration.fast, ease: motionEase.exit } },
};
