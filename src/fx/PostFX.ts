import { HalfFloatType, Vector2, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { QualityPreset } from '../config';
import { damp } from '../core/math';

/**
 * Pase final en un único shader (barato en celulares):
 * FXAA opcional + desenfoque radial y líneas de velocidad con los
 * propulsores + viñeta leve. Trabaja sobre la imagen ya tonemapeada.
 */
const FinalShader = {
  name: 'NDJRFinal',
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new Vector2(1 / 1280, 1 / 720) },
    uFxaa: { value: 1 },
    uRadial: { value: 0 },
    uLines: { value: 0 },
    uVignette: { value: 0.32 },
    uTime: { value: 0 },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uFxaa;
    uniform float uRadial;
    uniform float uLines;
    uniform float uVignette;
    uniform float uTime;
    uniform float uAspect;
    varying vec2 vUv;

    vec3 fxaa(vec2 uv) {
      vec3 rgbNW = texture2D(tDiffuse, uv + vec2(-1.0, -1.0) * uTexel).rgb;
      vec3 rgbNE = texture2D(tDiffuse, uv + vec2(1.0, -1.0) * uTexel).rgb;
      vec3 rgbSW = texture2D(tDiffuse, uv + vec2(-1.0, 1.0) * uTexel).rgb;
      vec3 rgbSE = texture2D(tDiffuse, uv + vec2(1.0, 1.0) * uTexel).rgb;
      vec3 rgbM = texture2D(tDiffuse, uv).rgb;
      vec3 L = vec3(0.299, 0.587, 0.114);
      float lNW = dot(rgbNW, L); float lNE = dot(rgbNE, L); float lSW = dot(rgbSW, L); float lSE = dot(rgbSE, L); float lM = dot(rgbM, L);
      float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
      float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
      float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
      float rcpMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
      dir = clamp(dir * rcpMin, vec2(-8.0), vec2(8.0)) * uTexel;
      vec3 a = 0.5 * (texture2D(tDiffuse, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tDiffuse, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, uv - dir * 0.5).rgb + texture2D(tDiffuse, uv + dir * 0.5).rgb);
      float lB = dot(b, L);
      return (lB < lMin || lB > lMax) ? a : b;
    }

    float hash(float n) { return fract(sin(n) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec3 col = uFxaa > 0.5 ? fxaa(uv) : texture2D(tDiffuse, uv).rgb;
      vec2 c = uv - vec2(0.5, 0.52);
      float r = length(c * vec2(uAspect, 1.0));

      // Desenfoque radial (propulsores): más fuerte hacia los bordes
      if (uRadial > 0.002) {
        vec3 acc = col;
        float w = 1.0;
        for (int i = 1; i < 8; i++) {
          float k = float(i) / 8.0;
          acc += texture2D(tDiffuse, uv - c * k * uRadial * 0.12 * smoothstep(0.1, 0.6, r)).rgb;
          w += 1.0;
        }
        col = acc / w;
      }

      // Líneas de velocidad estilo anime en los bordes
      if (uLines > 0.002) {
        float ang = atan(c.y, c.x);
        float band = floor(ang * 60.0);
        float rnd = hash(band);
        float speed = 3.0 + rnd * 4.0;
        float seg = fract(r * 2.2 - uTime * speed + rnd * 10.0);
        float line = step(0.82, rnd) * smoothstep(0.0, 0.25, seg) * smoothstep(0.75, 0.25, seg);
        float thin = 1.0 - smoothstep(0.0, 0.45, abs(fract(ang * 60.0) - 0.5) * 2.0 - 0.5);
        col += vec3(0.8, 0.95, 1.0) * line * thin * smoothstep(0.35, 0.85, r) * uLines * 0.55;
      }

      // Viñeta
      col *= 1.0 - uVignette * smoothstep(0.45, 1.15, r);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export interface PostState {
  boost: number;
  speedK: number;
  time: number;
}

/**
 * Pipeline: Render (HDR, MSAA opcional) → Bloom → Output (ACES + sRGB) → Final.
 * En calidad baja se omite el bloom; el pase final siempre es uno solo.
 */
export class PostFX {
  private composer!: EffectComposer;
  private bloom: UnrealBloomPass | null = null;
  private final!: ShaderPass;
  private preset: QualityPreset | null = null;
  private night = false;
  private w = 1;
  private h = 1;
  private pr = 1;
  private radial = 0;
  private lines = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {}

  configure(p: QualityPreset): void {
    this.preset = p;
    this.composer?.dispose();
    this.bloom?.dispose();
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const rt = new WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: HalfFloatType, samples: p.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = null;
    if (p.bloom) {
      this.bloom = new UnrealBloomPass(new Vector2(Math.max(1, this.w), Math.max(1, this.h)), 0.4, 0.55, 0.9);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.setNight(this.night);
    this.setSize(this.w, this.h, this.pr);
  }

  setNight(night: boolean): void {
    this.night = night;
    if (!this.bloom) return;
    this.bloom.strength = night ? 0.85 : 0.24;
    this.bloom.threshold = night ? 0.62 : 1.0;
    this.bloom.radius = night ? 0.6 : 0.42;
  }

  setSize(w: number, h: number, pr: number): void {
    this.w = w;
    this.h = h;
    this.pr = pr;
    if (!this.composer) return;
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.final.uniforms.uTexel.value.set(1 / (w * pr), 1 / (h * pr));
    this.final.uniforms.uAspect.value = w / h;
  }

  render(dt: number, s: PostState): void {
    const u = this.final.uniforms;
    this.radial = damp(this.radial, s.boost * (0.4 + 0.6 * Math.min(1, s.speedK)), 6, dt);
    this.lines = damp(this.lines, Math.max(s.boost, Math.max(0, s.speedK - 0.75) * 2.2), 5, dt);
    u.uRadial.value = this.radial;
    u.uLines.value = this.lines;
    u.uTime.value = s.time;
    u.uFxaa.value = this.preset?.fxaa ? 1 : 0;
    this.composer.render(dt);
  }
}
