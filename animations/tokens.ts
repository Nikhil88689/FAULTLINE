export const motionDuration = {
  instant: 0.12,
  fast: 0.18,
  control: 0.24,
  panel: 0.34,
  content: 0.46,
  scene: 0.68,
  magneticReturn: 0.58,
} as const;

export const motionEase = {
  standard: [0.22, 1, 0.36, 1],
  entrance: [0.16, 1, 0.3, 1],
  exit: [0.7, 0, 0.84, 0],
  linear: [0, 0, 1, 1],
} as const;

export const motionStagger = {
  compact: 0.035,
  content: 0.07,
} as const;
