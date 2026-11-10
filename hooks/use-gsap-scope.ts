"use client";

import { useLayoutEffect, type RefObject } from "react";
import { gsap } from "gsap";

export function useGsapScope<T extends HTMLElement>(scope: RefObject<T | null>) {
  useLayoutEffect(() => {
    const element = scope.current;
    if (!element) return;

    const context = gsap.context(() => {
      gsap.to("[data-ambient-orb]", {
        x: 18,
        y: -14,
        scale: 1.08,
        duration: 7,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        stagger: { each: 1.2, from: "random" },
      });
      gsap.to("[data-ambient-beam]", {
        backgroundPosition: "180% 0",
        duration: 8,
        ease: "none",
        repeat: -1,
      });
    }, element);

    return () => context.revert();
  }, [scope]);
}
