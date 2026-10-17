import {
  BackSide,
  BoxGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  CircleGeometry,
  Object3D,
  PMREMGenerator,
  Scene,
  ShaderChunk,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { CONFIG } from '../config';

/**
 * Atmósfera: cielo con gradiente + sol, niebla que toma el color del cielo en
 * la dirección de la vista (así los edificios lejanos se funden con el
 * horizonte), luces (hemisférica + sol con sombras que siguen al jugador) y
 * mapa de entorno PMREM generado desde el mismo cielo para los reflejos.
 */

/** Uniforms compartidos por TODOS los materiales (inyectados en shaderPatch). */
export const atmosphereUniforms = {
  uFogSunDir: { value: new Vector3(0, 0.3, -1).normalize() },
  uFogSunColor: { value: new Color(0, 0, 0) },
};

/** Debe coincidir con el término de brillo del sol en el shader del cielo. */
const GLOW_POW = '6.0';

// Reemplazo global de los chunks de niebla de Three: color dependiente de la dirección.
ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogView;
#endif`;
ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogView = mvPosition.xyz;
#endif`;
ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 uFogSunDir;
  uniform vec3 uFogSunColor;
  varying float vFogDepth;
  varying vec3 vFogView;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 fogDirW = normalize( ( vec4( vFogView, 0.0 ) * viewMatrix ).xyz );
  float fogSun = pow( max( dot( fogDirW, uFogSunDir ), 0.0 ), ${GLOW_POW} );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor + uFogSunColor * fogSun, fogFactor );
#endif`;

interface SkyPreset {
  zenith: string;
  horizon: string;
  sunColor: string;
  glow: number;
  sunDir: [number, number, number];
  sunSize: number;
  cloudLit: string;
  cloudDark: string;
  lightColor: string;
  lightIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fogDensity: number;
  exposure: number;
  envIntensity: number;
  night: number;
}

const PRESETS: Record<'day' | 'night', SkyPreset> = {
  // Atardecer dorado de octubre: sol bajo, adelante a la izquierda.
  day: {
    zenith: '#4b70a8',
    horizon: '#f1b27f',
    sunColor: '#ffc887',
    glow: 0.5,
    sunDir: [-0.26, 0.3, -0.92],
    sunSize: 0.03,
    cloudLit: '#ffd2a6',
    cloudDark: '#9b7a8f',
    lightColor: '#ffcd94',
    lightIntensity: 3.1,
    hemiSky: '#c4d2ff',
    hemiGround: '#8c6a52',
    hemiIntensity: 0.85,
    fogDensity: CONFIG.world.fogDensityDay,
    exposure: 0.88,
    envIntensity: 0.75,
    night: 0,
  },
  night: {
    zenith: '#050916',
    horizon: '#2b2440',
    sunColor: '#7d8fd6',
    glow: 0.18,
    sunDir: [0.35, 0.55, -0.75],
    sunSize: 0.014,
    cloudLit: '#3a3555',
    cloudDark: '#141526',
    lightColor: '#8fa6ff',
    lightIntensity: 0.32,
    hemiSky: '#3a4475',
    hemiGround: '#20160f',
    hemiIntensity: 0.55,
    fogDensity: CONFIG.world.fogDensityNight,
    exposure: 1.1,
    envIntensity: 0.55,
    night: 1,
  },
};

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w; // siempre en el plano lejano
}`;

const skyFragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform float uGlow;
uniform float uSunSize;
uniform float uNight;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  float sd = max(dot(d, uSunDir), 0.0);
  // Brillo del sol (mismo término que la niebla) + halo + disco.
  col += uSunColor * uGlow * pow(sd, ${GLOW_POW});
  col += uSunColor * pow(sd, 120.0) * 1.4;
  float disc = smoothstep(cos(uSunSize), cos(uSunSize * 0.7), sd);
  col += uSunColor * disc * mix(14.0, 2.5, uNight);

  // Nubes estiradas, iluminadas por el sol bajo.
  if (h > 0.0) {
    vec2 cp = d.xz / (h + 0.1) * 0.9 + vec2(uTime * 0.0035, 0.0);
    float c = fbm(cp * vec2(0.7, 2.6));
    float mask = smoothstep(0.52, 0.82, c) * smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.32, 0.7, h));
    vec3 cc = mix(uCloudDark, uCloudLit, clamp(pow(sd, 3.0) * 1.2 + 0.25 * (1.0 - h), 0.0, 1.0));
    col = mix(col, cc, mask * 0.8);

    // Estrellas de noche.
    if (uNight > 0.5) {
      vec2 sp = d.xz / (h + 0.25) * 140.0;
      vec2 cell = floor(sp);
      float r = hash(cell);
      float star = step(0.985, r) * smoothstep(0.35, 0.0, length(fract(sp) - 0.5));
      float tw = 0.6 + 0.4 * sin(uTime * 3.0 + r * 60.0);
      col += vec3(star * tw * smoothstep(0.08, 0.4, h) * (1.0 - mask));
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Atmosphere {
  readonly sky: Mesh;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly fog: FogExp2;
  night = false;
  private readonly skyMat: ShaderMaterial;
  private readonly sunDir = new Vector3();
  private envTarget: { texture: Texture; dispose(): void } | null = null;
  private readonly pmrem: PMREMGenerator;
  private preset: SkyPreset = PRESETS.day;

  constructor(
    private readonly scene: Scene,
    private readonly renderer: WebGLRenderer,
  ) {
    this.skyMat = new ShaderMaterial({
      uniforms: {
        uZenith: { value: new Color() },
        uHorizon: { value: new Color() },
        uSunColor: { value: new Color() },
        uSunDir: { value: new Vector3() },
        uCloudLit: { value: new Color() },
        uCloudDark: { value: new Color() },
        uGlow: { value: 1 },
        uSunSize: { value: 0.03 },
        uNight: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new Mesh(new SphereGeometry(2000, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    // Se dibuja DESPUÉS de lo opaco (z = w → solo donde no hay nada): ahorra fill-rate.
    this.sky.renderOrder = 1000;
    scene.add(this.sky);

    this.fog = new FogExp2(0xffffff, 0.002);
    scene.fog = this.fog;

    this.hemi = new HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);

    this.sun = new DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    cam.left = -75;
    cam.right = 75;
    cam.top = 75;
    cam.bottom = -75;
    cam.near = 1;
    cam.far = 520;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.5;
    this.sun.shadow.mapSize.set(2048, 2048);
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.pmrem = new PMREMGenerator(renderer);
    this.setNight(false);
  }

  get settings(): Readonly<SkyPreset> {
    return this.preset;
  }

  /** Cambia entre atardecer y noche (regenera el mapa de entorno). */
  setNight(night: boolean): void {
    this.night = night;
    const p = (this.preset = night ? PRESETS.night : PRESETS.day);
    const u = this.skyMat.uniforms;
    (u.uZenith.value as Color).set(p.zenith);
    (u.uHorizon.value as Color).set(p.horizon);
    (u.uSunColor.value as Color).set(p.sunColor);
    (u.uCloudLit.value as Color).set(p.cloudLit);
    (u.uCloudDark.value as Color).set(p.cloudDark);
    u.uGlow.value = p.glow;
    u.uSunSize.value = p.sunSize;
    u.uNight.value = p.night;
    this.sunDir.set(...p.sunDir).normalize();
    (u.uSunDir.value as Vector3).copy(this.sunDir);

    atmosphereUniforms.uFogSunDir.value.copy(this.sunDir);
    atmosphereUniforms.uFogSunColor.value.set(p.sunColor).multiplyScalar(p.glow);
    this.fog.color.set(p.horizon);
    this.fog.density = p.fogDensity;

    this.sun.color.set(p.lightColor);
    this.sun.intensity = p.lightIntensity;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.renderer.toneMappingExposure = p.exposure;
    this.buildEnvironment();
  }

  /** Mapa de entorno PMREM: cielo + suelo oscuro + siluetas de edificios. */
  private buildEnvironment(): void {
    const envScene = new Scene();
    const sky = new Mesh(new SphereGeometry(50, 32, 16), this.skyMat);
    envScene.add(sky);
    const ground = new Mesh(new CircleGeometry(48, 24), new MeshBasicMaterial({ color: this.night ? 0x06070a : 0x2a2622 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.5;
    envScene.add(ground);
    const boxGeo = new BoxGeometry(1, 1, 1);
    const holder = new Object3D();
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      // Dejamos libre la dirección del eje de la avenida para que se vea el horizonte.
      if (Math.abs(Math.sin(a)) < 0.25) continue;
      const lit = this.night ? new Color().setHSL(0.09, 0.6, 0.12 + (i % 3) * 0.05) : new Color(0x4a4448).multiplyScalar(0.7 + (i % 4) * 0.12);
      const m = new Mesh(boxGeo, new MeshBasicMaterial({ color: lit }));
      m.position.set(Math.cos(a) * 40, 4 + (i % 5) * 2.5, Math.sin(a) * 40);
      m.scale.set(9, 14 + (i % 5) * 5, 9);
      m.lookAt(0, m.position.y, 0);
      holder.add(m);
    }
    envScene.add(holder);
    const rt = this.pmrem.fromScene(envScene, 0.03, 0.1, 120);
    this.envTarget?.dispose();
    this.envTarget = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = this.preset.envIntensity;
    envScene.traverse((o) => {
      if (o instanceof Mesh && o !== sky) {
        o.geometry.dispose();
        (o.material as MeshBasicMaterial).dispose();
      }
    });
    sky.geometry.dispose();
  }

  setShadowMapSize(size: number): void {
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  private readonly tmp = new Vector3();
  private readonly right = new Vector3();
  private readonly upv = new Vector3();

  /** El cielo sigue a la cámara y la caja de sombras sigue al jugador (con snap a texel). */
  update(time: number, focus: Vector3, cameraPos: Vector3): void {
    this.skyMat.uniforms.uTime.value = time;
    this.sky.position.copy(cameraPos);

    const cam = this.sun.shadow.camera;
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    // Base del espacio de luz para hacer "snap" y evitar el parpadeo de sombras.
    this.right.set(0, 1, 0).cross(this.sunDir).normalize();
    this.upv.copy(this.sunDir).cross(this.right).normalize();
    const rx = Math.round(focus.dot(this.right) / texel) * texel;
    const uy = Math.round(focus.dot(this.upv) / texel) * texel;
    const d = focus.dot(this.sunDir);
    this.tmp.copy(this.right).multiplyScalar(rx).addScaledVector(this.upv, uy).addScaledVector(this.sunDir, d);
    this.sun.target.position.copy(this.tmp);
    this.sun.position.copy(this.tmp).addScaledVector(this.sunDir, 260);
    this.sun.target.updateMatrixWorld();
  }
}
