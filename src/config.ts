/**
 * Un Roadster por la 9 de Julio — configuración central.
 *
 * TODAS las constantes de juego viven acá: aceleración, velocidades, consumo de
 * aire, tiempos de doble pulsación, tránsito, cámara, puntaje y calidad.
 * Unidades: metros, segundos, radianes (salvo que el nombre diga km/h o ms).
 */

/** Conversión km/h → m/s. */
export const KMH = 1 / 3.6;

export const CONFIG = {
  car: {
    /**
     * Especificaciones de referencia del reveal del 15/10/2026 para un
     * hiperdeportivo eléctrico de esta clase. La curva de aceleración es
     * a(v) = A0 · (1 − (v / vmax)^k). A0 se calibra al arrancar para que el
     * 0–97 km/h coincida exactamente con `zeroTo97Seconds`
     * (ver physics/accel.ts y `npm run check:accel`).
     */
    normal: { zeroTo97Seconds: 1.6, topSpeedKmh: 330, curveExponent: 2.4 },
    boost: { zeroTo97Seconds: 0.775, topSpeedKmh: 375, curveExponent: 2.4 },
    /** Desaceleración de freno (m/s²). */
    brakeDecel: 26,
    reverseAccel: 7,
    reverseMaxKmh: 45,
    /** Resistencia al rodar (m/s²) y arrastre aerodinámico (·v²) al soltar el acelerador. */
    rollingResistance: 0.35,
    aeroDrag: 0.00055,
    wheelBase: 2.7,
    steer: {
      /** Ángulo máximo de dirección a baja y a alta velocidad (progresivo). */
      maxAngleLow: 0.58,
      maxAngleHigh: 0.05,
      fadeSpeedKmh: 240,
      /** Velocidad del volante y de retorno al centro (fracción del ángulo máximo por segundo). */
      rate: 3.8,
      returnRate: 7,
    },
    /** Tope de aceleración lateral (m/s²): limita el yaw a alta velocidad. */
    maxLateralAccel: 16,
    /** Agarre lateral: más bajo a alta velocidad para un derrape leve. */
    grip: { low: 10, high: 3.4, driftStartKmh: 130, driftFullKmh: 300 },
    yawResponse: 9,
    /** Medidas visuales (m). */
    size: { length: 4.6, width: 2.06, height: 1.12 },
    /** Semiejes de la caja de colisión (m). */
    collisionHalf: { x: 1.0, z: 2.25, height: 1.15 },
    /** Alerón activo: altura y ángulo máximos. */
    wing: { startKmh: 90, fullKmh: 260, maxLift: 0.22, maxAngle: 0.22, airBrakeAngle: 0.75 },
  },

  /** Salto y salto con giro (propulsores inferiores). */
  jump: {
    gravity: 24,
    /** Altura del salto simple (m): supera colectivos (~3,2 m). */
    height: 4.6,
    /** Altura del salto con giro (m). */
    spinHeight: 9.5,
    /** Ventana de doble pulsación de Espacio. */
    doubleTapMs: 300,
    /** Control de yaw en el aire (rad/s a dirección completa). */
    airSteer: 0.8,
    /** El giro de 360° se completa en esta fracción del tiempo de vuelo. */
    spinCompleteFraction: 0.86,
    /** Cámara lenta en el punto más alto del giro (tiempo real). */
    slowMoScale: 0.3,
    slowMoSeconds: 0.6,
    /** Margen de "aterrizaje limpio" sin choques ni roces (s). */
    cleanLandingWindow: 0.6,
    /** Duración visible de los chorros inferiores al despegar (s). */
    jetTime: 0.35,
  },

  /** Tanques de aire comprimido (2 barras en el HUD). */
  air: {
    tanks: 2,
    perTank: 1,
    jumpCost: 0.45,
    /** Costo adicional al convertir el salto en salto con giro. */
    spinExtraCost: 0.6,
    boostDrainPerSec: 0.42,
    minToBoost: 0.08,
    rechargeIdlePerSec: 0.06,
    rechargeRollingPerSec: 0.15,
    /** Pausa de recarga tras usar aire (s). */
    rechargeDelay: 0.7,
  },

  camera: {
    near: 0.1,
    far: 2600,
    baseFov: 60,
    /** FOV extra a velocidad máxima y con propulsores. */
    speedFov: 14,
    boostFov: 13,
    chase: {
      distance: 6.4,
      height: 2.05,
      lookAhead: 7,
      lookHeight: 0.85,
      posLag: 9,
      heightLag: 5,
      yawLag: 4.6,
      /** Retroceso de cámara a alta velocidad. */
      speedPull: 1.2,
    },
    hood: { y: 1.02, z: -0.65, fov: 72 },
    spin: { pullBack: 5.5, raise: 2.4 },
    shake: { boost: 0.06, landing: 0.35, crash: 0.9, scrape: 0.25 },
  },

  world: {
    /** Largo de una cuadra (cruce incluido). */
    blockLength: 130,
    chunksAhead: 8,
    chunksBehind: 2,
    crosswalkWidth: 4,
    stopLineGap: 1.2,
    /** Ancho de calzada de calles transversales. */
    avenueCrossWidth: 17,
    streetCrossWidth: 11,
    /** Corte de cuadras: distancia lateral máxima jugable en las calles transversales. */
    crossStreetLimit: 58,
    /** Hasta dónde se generan edificios/calle transversal hacia los costados. */
    sideExtent: 260,
    fogDensityDay: 0.0017,
    fogDensityNight: 0.0026,
  },

  /**
   * Corte transversal de la avenida (medio perfil; se espeja en x < 0).
   * x > 0: sentido hacia −Z (el del jugador). Mano derecha, como en Argentina.
   */
  layout: {
    islandHalf: 5,
    busLaneWidth: 3.5,
    busLanes: 2,
    sepInner: 5,
    mainLaneWidth: 3.3,
    mainLanes: 5,
    sepOuter: 6.5,
    lateralLaneWidth: 3.2,
    lateralLanes: 3,
    sidewalk: 6,
    buildingGap: 0.4,
  },

  /**
   * Secuencia de calles transversales (de sur a norte). Se repite en orden.
   * `avenue` = calzada más ancha. El Obelisco está en Av. Corrientes.
   */
  streets: [
    { name: 'Bartolomé Mitre', avenue: false },
    { name: 'Tte. Gral. J. D. Perón', avenue: false },
    { name: 'Sarmiento', avenue: false },
    { name: 'Av. Corrientes', avenue: true },
    { name: 'Lavalle', avenue: false },
    { name: 'Tucumán', avenue: false },
    { name: 'Viamonte', avenue: false },
    { name: 'Av. Córdoba', avenue: true },
    { name: 'Av. Belgrano', avenue: true },
    { name: 'Moreno', avenue: false },
    { name: 'Alsina', avenue: false },
    { name: 'Hipólito Yrigoyen', avenue: false },
    { name: 'Av. de Mayo', avenue: true },
    { name: 'Av. Rivadavia', avenue: true },
  ],
  obeliscoStreet: 'Av. Corrientes',
  /** El Obelisco se ubica en la isla central, pasando el cruce (m). */
  obeliscoOffset: 32,

  trafficLights: {
    avenueGreen: 16,
    yellow: 3,
    allRed: 1.5,
    crossGreen: 11,
  },

  traffic: {
    capacity: { car: 72, taxi: 40, bus: 30, moto: 26, van: 22 },
    /** Probabilidad relativa de cada tipo en carriles generales. */
    mix: { car: 0.42, taxi: 0.26, bus: 0.12, moto: 0.11, van: 0.09 },
    /** Vehículos por km por carril: crece con la distancia recorrida. */
    densityStart: 5,
    densityMax: 15,
    densityRampMeters: 16000,
    spawnAheadMin: 600,
    spawnAheadMax: 860,
    despawnBehind: 170,
    despawnAhead: 980,
    /** Intelligent Driver Model. */
    idm: { s0: 2.6, T: 1.1, a: 2.2, b: 3.2, maxBrake: 9 },
    laneChange: { blinkerTime: 1.4, duration: 2.4, minInterval: 7, chancePerSec: 0.05, noChangeNearCross: 35 },
    cross: { spawnX: 220, intervalMin: 2.2, intervalMax: 5.5, activeAhead: 720, activeBehind: 120 },
    hornChancePerSec: 0.03,
  },

  collision: {
    /** Velocidad normal (m/s) contra muros/canteros que provoca choque fuerte. */
    wallCrashSpeed: 17,
    /** Velocidad relativa normal contra vehículos que provoca choque fuerte. */
    vehicleCrashSpeed: 12.5,
    scrapeSpeedLoss: 0.22,
    crashSlowMoScale: 0.22,
    crashSlowMoSeconds: 1.0,
    /** Rebote al caer sobre un techo. */
    roofBounce: 7,
  },

  score: {
    perMeterBase: 0.5,
    perMeterSpeedDivKmh: 150,
    nearMissDistance: 1.25,
    nearMissMinKmh: 90,
    nearMissPoints: 250,
    jumpOverPoints: 400,
    roofBouncePoints: 600,
    perfectSpinPoints: 1500,
    checkpointPoints: 3000,
    multMax: 8,
    multNearMiss: 0.25,
    multJumpOver: 0.25,
    multSpin: 0.5,
    multDecayDelay: 6,
    multDecayPerSec: 0.08,
  },

  /** Presets de calidad. "auto" arranca según el dispositivo y baja si faltan FPS. */
  quality: {
    high: { pixelRatio: 2, shadows: 2048, msaa: 4, bloom: true, fxaa: false, physicalPaint: true, chunksAhead: 8 },
    medium: { pixelRatio: 1.5, shadows: 1024, msaa: 0, bloom: true, fxaa: true, physicalPaint: true, chunksAhead: 7 },
    low: { pixelRatio: 1, shadows: 0, msaa: 0, bloom: false, fxaa: true, physicalPaint: false, chunksAhead: 6 },
    autoSampleSeconds: 1.5,
    autoMinFpsDesktop: 52,
    autoMinFpsMobile: 30,
    /** Resolución mínima de la escala dinámica (fracción del pixel ratio). */
    minRenderScale: 0.6,
  },

  /** Modelo .glb opcional para reemplazar el auto procedural (ver entities/models.ts). */
  models: {
    playerCarUrl: '' as string,
  },

  share: {
    hashtags: 'UnRoadsterPorLa9DeJulio',
  },
} as const;

export type QualityLevel = 'high' | 'medium' | 'low';
export type QualityPreset = (typeof CONFIG.quality)[QualityLevel];
