/* Project Nexus — core engine: renderer, fixed-timestep loop, perf, governor.
   Nexus law (from the Bloxtopia autopsy): simulation time is fixed-step and
   decoupled from rendering; weak devices shed effects, never time itself. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* Tasteful film grade: gentle vignette + animated grain. Runs in linear HDR
   before OutputPass (which does tonemap + sRGB). Kept subtle on purpose. */
const NexusGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.045 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 61.7) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float vig = 1.0 - uVignette * smoothstep(0.18, 0.72, dot(d, d) * 2.2);
      c.rgb *= vig;
      float g = hash(vUv * vec2(1920.0, 1080.0)) - 0.5;
      c.rgb += g * uGrain * (0.35 + 0.65 * (1.0 - clamp(dot(c.rgb, vec3(0.333)), 0.0, 1.0)));
      gl_FragColor = c;
    }
  `,
};

export const SIM_DT = 1 / 60;

export class Engine {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false; // composer renders several passes; accumulate across all of them
    this.basePixelRatio = Math.min(2, window.devicePixelRatio || 1);
    this.govFactor = 1;
    this.renderer.setPixelRatio(this.basePixelRatio);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 900);
    this.camera.position.set(0, 6, 12);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    /* ground-truth ambient occlusion (the Lumen stand-in's contact-shadow
       half): grounds every prop and tree in soft occlusion. Expensive, so
       the governor sheds it first and the settings panel can force it off. */
    this.ao = new GTAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
    this.ao.blendIntensity = 0.9;
    this.userAO = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.55, 0.85);
    this.film = new ShaderPass(NexusGradeShader);
    this.userFilm = true; // settings-panel toggle can flip this later (main.js)
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.ao);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.film);
    this.composer.addPass(new OutputPass());
    this.usePost = true;

    this.simTime = 0;
    this.acc = 0;
    this.lastT = performance.now();
    this.systems = [];      // { step(dt), render?(alpha, frameDt) }
    this.frame = { fps: 0, ms: 0, simMs: 0, calls: 0, tris: 0 };
    this._fpsAcc = 0; this._fpsN = 0; this._fpsT = 0;
    this._govT = 0; this._govGood = 0;
    this.onGovernor = null; // (factor, label) => {}
    this.paused = false;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  addSystem(sys) { this.systems.push(sys); return sys; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setPixelScale(scale) {
    this.userScale = scale;
    this.renderer.setPixelRatio(this.basePixelRatio * scale * this.govFactor);
    this.composer.setPixelRatio(this.basePixelRatio * scale * this.govFactor);
  }

  _govern(realFps) {
    if (realFps < 24 && this.govFactor > 0.5) {
      this.govFactor = Math.max(0.5, +(this.govFactor - 0.15).toFixed(2));
      this._govGood = 0;
      this.setPixelScale(this.userScale || 1);
      if (this.govFactor <= 0.85) this.ao.enabled = false;
      if (this.govFactor <= 0.65) { this.bloom.enabled = false; this.film.enabled = false; }
      if (this.onGovernor) this.onGovernor(this.govFactor, 'down');
    } else if (realFps > 50 && this.govFactor < 1) {
      if (++this._govGood >= 2) {
        this.govFactor = Math.min(1, +(this.govFactor + 0.1).toFixed(2));
        if (this.govFactor > 0.85 && this.userAO !== false) this.ao.enabled = true;
        if (this.govFactor > 0.65 && this.userBloom !== false) this.bloom.enabled = true;
        if (this.govFactor > 0.65 && this.userFilm !== false) this.film.enabled = true;
        this.setPixelScale(this.userScale || 1);
        if (this.onGovernor) this.onGovernor(this.govFactor, 'up');
        this._govGood = 0;
      }
    } else this._govGood = 0;
  }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      let rawDt = (now - this.lastT) / 1000;
      this.lastT = now;
      if (rawDt > 0.25) rawDt = 0.25; // tab-switch guard; sim steps are fixed anyway
      const t0 = performance.now();

      if (!this.paused) {
        /* render interpolation (build .33): sim systems snapshot their
           previous+current states around the substep batch; render systems
           then interpolate with alpha = acc/step so 60Hz sim looks smooth
           at any display rate. beginFrame resets per-frame step tracking. */
        for (const s of this.systems) if (s.beginFrame) s.beginFrame();
        this.acc += rawDt;
        let steps = 0;
        const simT0 = performance.now();
        while (this.acc >= SIM_DT && steps < 5) {
          for (const s of this.systems) if (s.step) s.step(SIM_DT);
          this.simTime += SIM_DT;
          this.acc -= SIM_DT;
          steps++;
        }
        if (steps === 5) this.acc = 0; // spiral-of-death guard
        this.frame.simMs = performance.now() - simT0;
        const alpha = this.acc / SIM_DT;
        this.lastAlpha = alpha;
        for (const s of this.systems) if (s.render) s.render(alpha, rawDt);
      }

      this.renderer.info.reset();
      if (this.usePost) {
        this.film.uniforms.uTime.value = this.simTime;
        this.composer.render();
      }
      else this.renderer.render(this.scene, this.camera);

      const ms = performance.now() - t0;
      this.frame.ms = ms;
      this._fpsAcc += rawDt; this._fpsN++; this._fpsT += rawDt;
      if (this._fpsAcc >= 0.5) {
        this.frame.fps = Math.round(this._fpsN / this._fpsAcc);
        this._fpsAcc = 0; this._fpsN = 0;
        const info = this.renderer.info;
        this.frame.calls = info.render.calls;
        this.frame.tris = info.render.triangles;
      }
      this._govFrames = (this._govFrames || 0) + 1;
      this._govT += rawDt;
      if (this._govT >= 2.5) {
        this._govern(this._govFrames / this._govT);
        this._govT = 0; this._govFrames = 0;
      }
    };
    loop();
  }
}
