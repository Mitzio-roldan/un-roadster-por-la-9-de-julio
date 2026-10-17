import { ACESFilmicToneMapping, Mesh, PCFShadowMap, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { CONFIG, type QualityLevel } from '../config';
import { clamp, damp } from '../core/math';
import { ensureAtmosphere } from '../core/shaderPatch';
import { Atmosphere } from '../fx/atmosphere';
import { CameraRig } from '../fx/CameraRig';
import { Particles } from '../fx/Particles';
import { PostFX } from '../fx/PostFX';
import { Player } from '../entities/Player';
import { Traffic } from '../entities/Traffic';
import { Input, type ControlState } from '../input/Input';
import { PHYSICS_DT } from '../physics/accel';
import { clearEvents, makeEvents, type DriveInput } from '../physics/VehiclePhysics';
import { World } from '../world/World';
import { chunkIndexAt, chunkInfo, LANES } from '../world/layout';
import { setMaxAnisotropy } from '../world/textures';
import type { StaticBox } from '../world/colliders';
import { Score } from './Score';
import { Quality } from './Quality';
import { AudioEngine } from '../audio/AudioEngine';
import { HUD } from '../ui/HUD';
import { Menus } from '../ui/Menus';
import { TouchControls } from '../input/Touch';
import { isTouchDevice, vibrate } from '../ui/device';

export type GameState = 'menu' | 'playing' | 'paused' | 'crashing' | 'gameover';

/** Carril de largada: centro del tercer carril de la calzada principal derecha. */
const START_LANE = LANES.find((l) => l.kind === 'main' && l.dir === -1 && l.order === 2)!;
const START_Z = -55;

/**
 * Orquestador del juego: renderer, mundo, jugador, tránsito, cámara, FX,
 * audio, HUD y menús. Física a paso fijo (1/120 s) con escala de tiempo
 * para cámara lenta (ápice del giro, choques).
 */
export class Game {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly atmosphere: Atmosphere;
  readonly world: World;
  readonly player: Player;
  readonly traffic: Traffic;
  readonly rig: CameraRig;
  readonly input = new Input();
  readonly fxAdd = new Particles(2600, true);
  readonly fxAlpha = new Particles(1400, false);
  readonly post: PostFX;
  readonly score = new Score();
  readonly quality: Quality;
  readonly audio = new AudioEngine();
  readonly hud: HUD;
  readonly menus: Menus;
  readonly touch: TouchControls;

  state: GameState = 'menu';
  night = false;
  /** Reloj de juego (afectado por cámara lenta) y real. */
  gameTime = 0;
  private realTime = 0;
  private timeScale = 1;
  private slowMo = 0;
  private slowMoScale = 1;
  private acc = 0;
  private last = 0;
  private sizeW = 0;
  private sizeH = 0;
  private crashTimer = 0;
  private readonly ev = makeEvents();
  private readonly statics: StaticBox[] = [];
  private readonly drive: DriveInput = { throttle: 0, brake: 0, steer: 0, boost: false };
  private spinCleanTimer = -1;
  private spinPerfectPending = false;
  private checkpoint: { z: number; score: number; distance: number } | null = null;
  private checkpointUsed = false;
  private lastObeliscoZ = Number.NaN;
  private readonly debug = new URLSearchParams(location.search);

  constructor(container: HTMLElement) {
    this.quality = new Quality(isTouchDevice());
    const preset = this.quality.preset;
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: this.debug.has('shot') });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.domElement.className = 'game';
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);
    setMaxAnisotropy(this.renderer);

    this.atmosphere = new Atmosphere(this.scene, this.renderer);
    this.world = new World(this.scene);
    this.scene.add(this.fxAdd.points, this.fxAlpha.points);
    this.player = new Player(this.scene, this.fxAdd, this.fxAlpha, preset.physicalPaint);
    this.traffic = new Traffic(this.scene);
    this.rig = new CameraRig(innerWidth / innerHeight);
    this.post = new PostFX(this.renderer, this.scene, this.rig.camera);

    this.hud = new HUD(container);
    this.touch = new TouchControls(container);
    this.input.touch = this.touch;
    this.menus = new Menus(container, {
      onPlay: () => this.startRun(false),
      onRetry: () => this.startRun(false),
      onContinue: () => this.startRun(true),
      onResume: () => this.setPaused(false),
      onQuit: () => this.toMenu(),
      onToggleNight: () => this.setNight(!this.night),
      onToggleMute: () => this.audio.setMuted(!this.audio.muted),
      onQuality: (q) => this.applyQuality(q),
      onPause: () => this.setPaused(true),
      getState: () => ({ night: this.night, muted: this.audio.muted, quality: this.quality.choice }),
    });

    this.applyQuality(this.quality.choice, false);
    this.setNight(this.debug.has('night'));
    this.resetRun();
    // Todos los materiales con la niebla atmosférica
    this.scene.traverse((o) => {
      if (o instanceof Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(ensureAtmosphere);
    });

    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.setPaused(true);
    });
    this.resize();
  }

  start(): void {
    this.toMenu();
    if (this.debug.has('play')) this.startRun(false);
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /* ------------------------------------------------------------------ */
  /* Estados                                                              */
  /* ------------------------------------------------------------------ */

  private resetRun(fromCheckpoint = false): void {
    const z = fromCheckpoint && this.checkpoint ? this.checkpoint.z : START_Z;
    this.player.reset(START_LANE.x, z, 0);
    this.score.setOrigin(-z);
    this.world.reset();
    this.world.update(z, -1, this.gameTime);
    this.traffic.reset();
    this.traffic.populate(z, this.score.distance);
    this.fxAdd.clear();
    this.fxAlpha.clear();
    this.rig.snap(this.player.physics);
    this.timeScale = 1;
    this.slowMo = 0;
    this.spinCleanTimer = -1;
    this.lastObeliscoZ = Number.NaN;
  }

  private toMenu(): void {
    this.state = 'menu';
    this.score.reset();
    this.checkpoint = null;
    this.checkpointUsed = false;
    this.resetRun();
    this.menus.show('menu');
    this.hud.setVisible(false);
    this.touch.setVisible(false);
    this.audio.setDriving(false);
  }

  private startRun(fromCheckpoint: boolean): void {
    this.audio.unlock();
    if (fromCheckpoint && this.checkpoint && !this.checkpointUsed) {
      this.checkpointUsed = true;
      this.score.restore(this.checkpoint.score, this.checkpoint.distance);
      this.resetRun(true);
    } else {
      this.score.reset();
      this.checkpoint = null;
      this.checkpointUsed = false;
      this.resetRun();
    }
    this.state = 'playing';
    this.menus.show(null);
    this.hud.setVisible(true);
    this.touch.setVisible(this.touch.enabled);
    this.audio.setDriving(true);
    this.renderer.domElement.focus();
  }

  private setPaused(p: boolean): void {
    if (p && this.state === 'playing') {
      this.state = 'paused';
      this.menus.show('pause');
      this.audio.setDriving(false);
      this.touch.setVisible(false);
    } else if (!p && this.state === 'paused') {
      this.state = 'playing';
      this.menus.show(null);
      this.audio.setDriving(true);
      this.touch.setVisible(this.touch.enabled);
      this.last = performance.now();
    }
  }

  private gameOver(): void {
    this.state = 'gameover';
    const best = this.score.commitBest();
    this.menus.showGameOver({
      score: Math.floor(this.score.points),
      best,
      newRecord: this.score.newRecord,
      distance: this.score.distance,
      maxKmh: this.player.physics.maxKmh,
      canContinue: !!this.checkpoint && !this.checkpointUsed,
    });
    this.hud.setVisible(false);
    this.touch.setVisible(false);
    this.audio.setDriving(false);
  }

  setNight(night: boolean): void {
    this.night = night;
    this.atmosphere.setNight(night);
    this.world.setNight(night);
    this.player.setNight(night);
    this.traffic.setNight(night);
    this.post.setNight(night);
    this.menus.refresh();
  }

  private applyQuality(q: QualityLevel | 'auto', save = true): void {
    this.quality.set(q, save);
    const p = this.quality.preset;
    this.atmosphere.setShadowMapSize(p.shadows);
    this.renderer.shadowMap.enabled = p.shadows > 0;
    this.post.configure(p);
    this.world.setViewChunks(p.chunksAhead);
    this.scene.traverse((o) => {
      if (o instanceof Mesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
    });
    this.resize();
    this.menus.refresh();
  }

  private resize(): void {
    // Algunos navegadores internos (p. ej. el de X) informan 0×0 al cargar y tardan en avisar el tamaño real
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    this.sizeW = innerWidth;
    this.sizeH = innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.quality.preset.pixelRatio) * this.quality.scale);
    this.renderer.setSize(w, h);
    this.post.setSize(w, h, this.renderer.getPixelRatio());
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.hud.layout(w, h);
  }

  /* ------------------------------------------------------------------ */
  /* Loop                                                                 */
  /* ------------------------------------------------------------------ */

  private frame(): void {
    const now = performance.now();
    const realDt = Math.min(1 / 15, (now - this.last) / 1000);
    this.last = now;
    this.realTime += realDt;
    if (innerWidth !== this.sizeW || innerHeight !== this.sizeH) this.resize();
    this.quality.sample(realDt, this.state === 'playing', () => this.resize(), (q) => this.applyQuality(q, false));

    const controls = this.input.poll();
    for (const a of this.input.drainActions()) this.handleAction(a);

    // Escala de tiempo (cámara lenta)
    if (this.slowMo > 0) this.slowMo -= realDt;
    const targetScale = this.slowMo > 0 ? this.slowMoScale : 1;
    this.timeScale = damp(this.timeScale, targetScale, this.slowMo > 0 ? 18 : 6, realDt);
    const dt = realDt * (this.state === 'paused' ? 0 : this.timeScale);
    this.gameTime += dt;

    switch (this.state) {
      case 'menu':
        this.updateMenu(realDt, dt);
        break;
      case 'playing':
        this.updatePlaying(dt, realDt, controls);
        break;
      case 'crashing':
        this.updateCrashing(dt, realDt);
        break;
      case 'gameover':
        this.updateCrashing(dt, realDt);
        break;
      case 'paused':
        break;
    }

    const ph = this.player.physics;
    const travelDir = Math.cos(ph.yaw) > -0.2 ? -1 : 1;
    this.world.update(ph.pos.z, travelDir, this.gameTime);
    this.atmosphere.update(this.realTime, ph.pos, this.rig.camera.position);
    const scale = (this.renderer.domElement.height / 2) / Math.tan((this.rig.camera.fov * Math.PI) / 360);
    this.fxAdd.setScale(scale);
    this.fxAlpha.setScale(scale);
    this.fxAdd.update(dt);
    this.fxAlpha.update(dt);
    this.post.render(realDt, {
      boost: import.meta.env.DEV && this.debug.has('og') ? 0.2 : this.player.boostVis,
      speedK: clamp(ph.speedKmh / CONFIG.car.normal.topSpeedKmh, 0, 1.2),
      time: this.realTime,
    });
  }

  private handleAction(a: string): void {
    switch (a) {
      case 'pause':
        if (this.state === 'playing') this.setPaused(true);
        else if (this.state === 'paused') this.setPaused(false);
        break;
      case 'camera':
        if (this.state === 'playing') this.rig.toggleMode();
        break;
      case 'mute':
        this.audio.setMuted(!this.audio.muted);
        this.menus.refresh();
        break;
      case 'night':
        this.setNight(!this.night);
        break;
      case 'confirm':
        if (this.state === 'menu' || this.state === 'gameover') this.startRun(false);
        break;
      case 'jump':
      case 'jumpDouble':
        if (this.state !== 'playing') break;
        this.doJump(a === 'jumpDouble');
        break;
    }
  }

  /** Salto simple o upgrade a salto con giro (ver DoubleTapDetector). */
  private doJump(double: boolean): void {
    const ph = this.player.physics;
    const air = this.player.air;
    const now = this.realTime;
    if (double && !ph.grounded) {
      if (ph.tryUpgradeToSpin(air, now, this.drive.steer)) {
        this.player.onJump(true);
        this.audio.jet(true);
        this.rig.addShake(0.15);
        vibrate([18, 30, 18]);
      }
      return;
    }
    if (ph.tryJump(air, now)) {
      this.player.onJump(false);
      this.audio.jet(false);
      vibrate(15);
    }
  }

  private updateMenu(realDt: number, dt: number): void {
    // El auto gira lentamente sobre la avenida; el tránsito sigue andando.
    const ph = this.player.physics;
    const carView = import.meta.env.DEV ? this.debug.get('carview') : null;
    if (carView === null) ph.yaw += realDt * 0.35;
    if (carView !== null && this.debug.has('boostfx')) ph.boosting = true;
    if (carView !== null && this.debug.has('og')) {
      // Escena para og-image.png: salto con giro + propulsores frente al Obelisco
      ph.pos.set(START_LANE.x - 4, 4.6, -330);
      ph.yaw = 0.08;
      ph.vel.set(0, 0, 0);
      ph.grounded = false;
      ph.jumpKind = 'jump';
      ph.spinAngle = 0;
      ph.boosting = true;
    }
    this.player.update(realDt, { throttle: 0, brake: 0, steer: 0, boost: false }, carView !== null && this.debug.has('boostfx'));
    this.traffic.update(dt, this.gameTime, ph, this.score.distance, this.night);
    this.rig.updateMenu(realDt, ph.pos, innerWidth, innerHeight);
    if (carView !== null) {
      // Vista de inspección del auto (solo desarrollo): ?carview=<ángulo en grados>
      this.menus.show(null);
      const cam = this.rig.camera;
      cam.clearViewOffset();
      const a = (Number(carView) * Math.PI) / 180;
      const r = Number(this.debug.get('r') ?? 6.5);
      cam.position.set(ph.pos.x + Math.sin(a) * r, Number(this.debug.get('h') ?? 1.5) + (this.debug.has('og') ? ph.pos.y : 0), ph.pos.z + Math.cos(a) * r);
      // sx/ly (solo og): corren el encuadre para dejar el auto a la derecha y arriba del título
      const sx = Number(this.debug.get('sx') ?? 0);
      const ly = Number(this.debug.get('ly') ?? 1.2);
      cam.lookAt(ph.pos.x - Math.cos(a) * sx, this.debug.has('og') ? ph.pos.y + ly : 0.5, ph.pos.z + Math.sin(a) * sx);
      cam.fov = 42;
      cam.updateProjectionMatrix();
    }
    this.audio.update(realDt, { kmh: 0, throttle: 0, boost: 0, air: false, nearLight: false });
  }

  private updatePlaying(dt: number, realDt: number, c: ControlState): void {
    const ph = this.player.physics;
    this.drive.throttle = c.throttle;
    this.drive.brake = c.brake;
    this.drive.steer = c.steer;
    this.drive.boost = c.boost;
    if (this.debug.has('auto')) this.autopilot();

    // Física a paso fijo
    clearEvents(this.ev);
    this.acc += dt;
    let steps = 0;
    while (this.acc >= PHYSICS_DT && steps < 12) {
      this.world.collidersNear(ph.pos.z, this.statics);
      ph.step(PHYSICS_DT, this.drive, this.player.air, this.statics, this.realTime, this.ev);
      this.acc -= PHYSICS_DT;
      steps++;
      if (this.state !== 'playing') break;
    }
    this.player.air.update(dt, ph.grounded && ph.speedKmh > 5 && !ph.boosting);

    // Tránsito + colisiones con vehículos
    this.traffic.update(dt, this.gameTime, ph, this.score.distance, this.night);
    const hit = this.traffic.collide(ph, this.score);
    if (hit) this.onVehicleHit(hit.impact, hit.crash, hit.x, hit.y, hit.z, hit.nx, hit.nz, hit.roof);
    for (const h of this.traffic.drainHorns()) this.audio.horn(h.type, h.distance);
    for (const n of this.traffic.drainNearMisses()) {
      const pts = this.score.nearMiss(n.over);
      this.hud.popup(n.over ? `¡POR ENCIMA! +${pts}` : `CASI +${pts}`, n.over ? 'cyan' : 'white');
      this.audio.whoosh();
    }

    this.handlePhysicsEvents();

    // Puntaje por distancia (solo avanzando hacia −Z)
    this.score.advance(-ph.pos.z, ph.speedKmh, dt);
    this.checkObelisco();

    this.player.update(dt, this.drive, true);
    this.rig.update(realDt, ph, this.player.boostVis, ph.jumpKind === 'spin');

    // Audio y HUD
    const info = chunkInfo(chunkIndexAt(ph.pos.z));
    this.audio.update(realDt, {
      kmh: ph.speedKmh,
      throttle: Math.max(this.drive.throttle, ph.boosting ? 1 : 0),
      boost: this.player.boostVis,
      air: !ph.grounded,
      nearLight: this.traffic.nearRedLight(ph.pos.z),
    });
    this.hud.update({
      kmh: ph.speedKmh,
      boost: ph.boosting,
      tanks: [this.player.air.tank(0), this.player.air.tank(1)],
      airFail: this.realTime - this.player.air.failAt < 0.9,
      time: this.realTime,
      distance: this.score.distance,
      points: this.score.points,
      mult: this.score.mult,
      best: this.score.best,
      street: this.streetLabel(info.index),
    });
  }

  /** Nombre de la calle que se está por cruzar (o cruzando). */
  private streetLabel(currentIdx: number): string {
    const z = this.player.physics.pos.z;
    const cur = chunkInfo(currentIdx);
    if (z <= cur.z0 + 2 && z >= cur.zCrossEnd - 6) return cur.streetName;
    const next = chunkInfo(currentIdx + 1);
    if (z - next.z0 < 90) return next.streetName;
    return '';
  }

  private handlePhysicsEvents(): void {
    const ev = this.ev;
    const ph = this.player.physics;
    if (ev.spinApex) {
      // Cámara lenta breve en el punto más alto del giro
      this.slowMo = CONFIG.jump.slowMoSeconds;
      this.slowMoScale = CONFIG.jump.slowMoScale;
    }
    if (ev.landed) {
      this.player.onLand(ev.landingSpeed, ev.spinLanded);
      this.rig.addShake(CONFIG.camera.shake.landing * Math.min(1.5, ev.landingSpeed / 15));
      this.audio.land(ev.landingSpeed);
      vibrate(ev.spinLanded ? 40 : 20);
      if (ev.spinLanded) {
        this.spinPerfectPending = ev.spinPerfect;
        this.spinCleanTimer = CONFIG.jump.cleanLandingWindow;
      }
    }
    if (this.spinCleanTimer >= 0) {
      this.spinCleanTimer -= PHYSICS_DT;
      if (this.spinCleanTimer < 0 && this.spinPerfectPending) {
        const pts = this.score.perfectSpin();
        this.hud.popup(`¡GIRO PERFECTO! +${pts}`, 'orange', true);
        this.audio.bonus();
      }
    }
    if (ev.wallImpact > 0.5) {
      const crashSpeed = ev.wallKind === 'monument' ? 8 : CONFIG.collision.wallCrashSpeed;
      const p = ph.pos;
      this.onWallHit(ev.wallImpact, ev.wallImpact > crashSpeed, p.x - ev.wallNormal.x * 1.0, 0.4, p.z - ev.wallNormal.z * 2.0, ev.wallNormal.x, ev.wallNormal.z);
    }
  }

  private onWallHit(impact: number, crash: boolean, x: number, y: number, z: number, nx: number, nz: number): void {
    this.player.sparks(x, y, z, nx, nz, Math.min(60, 6 + impact * 2.5));
    if (crash) return this.crash(impact);
    this.spinPerfectPending = false;
    if (impact > 2.5) {
      this.score.scrape();
      this.rig.addShake(CONFIG.camera.shake.scrape);
      this.audio.scrape(impact);
      vibrate(12);
    }
  }

  private onVehicleHit(impact: number, crash: boolean, x: number, y: number, z: number, nx: number, nz: number, roof: boolean): void {
    if (roof) {
      const pts = this.score.roofBounce();
      this.hud.popup(`¡REBOTE EN EL TECHO! +${pts}`, 'cyan');
      this.audio.land(8);
      this.player.onLand(4, false);
      return;
    }
    this.player.sparks(x, y, z, nx, nz, Math.min(80, 10 + impact * 3));
    this.spinPerfectPending = false;
    if (crash) return this.crash(impact);
    this.score.scrape();
    this.rig.addShake(CONFIG.camera.shake.scrape);
    this.audio.scrape(impact);
    this.hud.popup('ROCE', 'red');
    vibrate(25);
  }

  private crash(impact: number): void {
    if (this.state !== 'playing') return;
    this.state = 'crashing';
    this.crashTimer = CONFIG.collision.crashSlowMoSeconds;
    this.slowMo = CONFIG.collision.crashSlowMoSeconds;
    this.slowMoScale = CONFIG.collision.crashSlowMoScale;
    this.rig.addShake(CONFIG.camera.shake.crash);
    this.audio.crash();
    vibrate([60, 40, 120]);
    // Rebote y trompo
    const ph = this.player.physics;
    ph.vel.multiplyScalar(-0.25);
    ph.vel.y = Math.min(6, 2 + impact * 0.12);
    ph.grounded = false;
    ph.yawRate = (Math.random() < 0.5 ? -1 : 1) * (3 + impact * 0.05);
    this.player.sparks(ph.pos.x, 0.6, ph.pos.z, 0, 0, 90);
    this.hud.setVisible(false);
    this.touch.setVisible(false);
  }

  private updateCrashing(dt: number, realDt: number): void {
    const ph = this.player.physics;
    // Simulación simple del auto rebotando
    ph.vel.y -= CONFIG.jump.gravity * dt;
    ph.pos.addScaledVector(ph.vel, dt);
    ph.yaw += ph.yawRate * dt;
    ph.yawRate *= Math.exp(-1.5 * dt);
    if (ph.pos.y < 0) {
      ph.pos.y = 0;
      ph.vel.y *= -0.3;
      ph.vel.x *= 0.9;
      ph.vel.z *= 0.9;
    }
    this.player.update(dt, { throttle: 0, brake: 1, steer: 0, boost: false }, false);
    this.traffic.update(dt, this.gameTime, ph, this.score.distance, this.night);
    this.rig.updateCrash(realDt, ph.pos);
    this.audio.update(realDt, { kmh: 0, throttle: 0, boost: 0, air: false, nearLight: false });
    if (this.state === 'crashing') {
      this.crashTimer -= realDt;
      if (this.crashTimer <= 0) this.gameOver();
    }
  }

  /** Obelisco: bonus al pasarlo y checkpoint para "Continuar". */
  private checkObelisco(): void {
    const oz = this.world.obelisco.z;
    if (oz === null) return;
    const pz = this.player.physics.pos.z;
    if (pz < oz && pz > oz - 40 && this.lastObeliscoZ !== oz) {
      this.lastObeliscoZ = oz;
      const pts = this.score.checkpoint();
      this.checkpoint = { z: oz - 30, score: this.score.points, distance: this.score.distance };
      this.player.air.level = this.player.air.capacity;
      this.hud.popup(`OBELISCO · CHECKPOINT +${pts}`, 'orange', true);
      this.audio.bonus();
      vibrate([20, 40, 20]);
    }
  }

  /** Piloto automático de depuración (?auto): acelera y esquiva canteros. */
  private autopilot(): void {
    const ph = this.player.physics;
    const targetX = START_LANE.x;
    const err = targetX - ph.pos.x;
    const yawErr = -ph.yaw;
    this.drive.throttle = 1;
    this.drive.steer = clamp(err * 0.08 - yawErr * 2.5, -1, 1);
    this.drive.boost = this.debug.has('boost');
  }
}
