/**
 * Detección de doble pulsación (Espacio o botón SALTO).
 *
 * Cada pulsación se informa al instante (sin esperar a ver si viene otra):
 * - la primera devuelve `false` → el juego hace el salto simple YA;
 * - si llega otra dentro de `windowMs`, devuelve `true` → el juego convierte
 *   ese salto en salto con giro. Así no hay latencia de entrada.
 * Tras un doble, se reinicia para que un triple toque no cuente como otro doble.
 */
export class DoubleTapDetector {
  private last = -Infinity;
  constructor(private readonly windowMs: number) {}

  press(nowMs: number): boolean {
    const isDouble = nowMs - this.last <= this.windowMs;
    this.last = isDouble ? -Infinity : nowMs;
    return isDouble;
  }
}
