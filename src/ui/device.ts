/** Detección de dispositivo táctil y vibración (donde exista). */
export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

export function vibrate(pattern: number | number[]): void {
  try {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* no disponible (iOS) */
  }
}
