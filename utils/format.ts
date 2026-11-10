export function formatLatency(value: number): string {
  return value < 1000 ? Math.round(value) + " ms" : (value / 1000).toFixed(2) + " s";
}

export function formatUptime(value: number): string {
  return value.toFixed(2) + "%";
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));
}
