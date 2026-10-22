/* Project Nexus — environment: terrain, sky, day/night, water, scatter.
   One deterministic height function feeds BOTH the visual mesh and the
   physics collider, so what you see is exactly what you collide with. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* deterministic value noise (shared everywhere; seeded, stable) */
function hash(ix, iz) { let n = ix * 374761393 + iz * 668265263; n = (n ^ (n >> 13)) * 1274126177; return ((n ^ (n >> 16)) >>> 0) / 4294967295; }
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
function fbm(x, z, oct) { let v = 0, amp = 0.5, f = 1; for (let i = 0; i < oct; i++) { v += amp * vnoise(x * f, z * f); amp *= 0.5; f *= 2.03; } return v; }

export const WORLD_R = 105;
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  let h = fbm(x * 0.012 + 7.3, z * 0.012 + 2.9, 4) * 13 - 2.2;
  h += fbm(x * 0.055 + 1.7, z * 0.055 + 8.4, 3) * 1.7;
  const plateau = THREE.MathUtils.smoothstep(16 - r, 0, 14); // 1 near spawn → 0 away
  h = THREE.MathUtils.lerp(h, 2.6, plateau * 0.92);
  const fall = THREE.MathUtils.smoothstep(r, 78, 108);
  h = THREE.MathUtils.lerp(h, -4.5, fall);
  return h;
}

const SKY_KEYS = [ // hour, top, horizon, sun, sunI, hemiI, fog
  [0.0, 0x0a1430, 0x1a2745, 0x8fa8ff, 0.0, 0.24],
  [5.0, 0x0e1838, 0x2a3c5c, 0xffb37a, 0.05, 0.26],
  [7.0, 0x3f7fd0, 0xffc490, 0xffd9a8, 1.15, 0.5],
  [12.0, 0x2f7fe0, 0xbfe3f2, 0xfff2d8, 1.9, 0.85],
  [17.0, 0x3574c8, 0xffc98f, 0xffe0b0, 1.5, 0.65],
  [19.5, 0x1c2a5e, 0xff8a4a, 0xff9a55, 0.55, 0.38],
  [21.0, 0x0b1633, 0x1c2c4d, 0x8fa8ff, 0.0, 0.25],
  [24.0, 0x0a1430, 0x1a2745, 0x8fa8ff, 0.0, 0.24],
];
/* dynamic weather: the sky's mood, eased continuously between states.
   wet drives rain + fog, cloud greys the sky and dims the sun, wind
   pushes the clouds and slants the rain. Storm adds lightning. */
const WEATHER_STATES = {
  clear:  { wet: 0,    cloud: 0.06, wind: 0.15 },
  cloudy: { wet: 0,    cloud: 0.8,  wind: 0.4 },
  rain:   { wet: 0.7,  cloud: 0.92, wind: 0.55 },
  storm:  { wet: 1,    cloud: 1,    wind: 1 },
};
const GREY_TOP = new THREE.Color(0x5f7185), GREY_HOR = new THREE.Color(0x93a7ba), FLASH_C = new THREE.Color(0xe8f1ff);

function keyLerp(h) {
  let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) if (h >= SKY_KEYS[i][0] && h <= SKY_KEYS[i + 1][0]) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
  const t = (h - a[0]) / Math.max(0.0001, b[0] - a[0]);
  const C = i => new THREE.Color(a[i]).lerp(new THREE.Color(b[i]), t);
  return { top: C(1), horizon: C(2), sun: C(3), sunI: a[4] + (b[4] - a[4]) * t, hemiI: a[5] + (b[5] - a[5]) * t };
}

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    /* image-based lighting: a neutral studio environment baked to a PMREM
       gives every standard material believable reflections (the Lumen-stand-in) */
    if (renderer) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = 0.32;
    }
    this.timeOfDay = 10.5;
    this.autoCycle = false;
    this.cycleSpeed = 24 / 240; // full day in 4 minutes when auto

    /* terrain */
    const SEG = 128, SIZE = 240;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cSand = new THREE.Color(0xd9bd7f), cGrass = new THREE.Color(0x55a047), cGrass2 = new THREE.Color(0x7fbc52),
      cRock = new THREE.Color(0x8d8578), cSnow = new THREE.Color(0xf4f7f7), tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = heightAt(x, z);
      pos.setY(i, h);
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i), ny = nrm.getY(i);
      const vary = fbm(x * 0.09 + 3, z * 0.09 + 9, 2);
      if (h < 0.75) tmp.copy(cSand);
      else if (ny < 0.78) tmp.copy(cRock);
      else if (h > 10.2) tmp.copy(cSnow);
      else tmp.copy(cGrass).lerp(cGrass2, vary);
      if (ny < 0.86 && h >= 0.75 && h <= 10.2) tmp.lerp(cRock, (0.86 - ny) * 5);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // subtle procedural ground detail so flat grass doesn't read as plastic
    const gc = document.createElement('canvas'); gc.width = gc.height = 256;
    const gg = gc.getContext('2d');
    gg.fillStyle = '#cfcfcf'; gg.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5200; i++) {
      const v = 165 + (Math.random() * 90) | 0;
      gg.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      gg.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 1 + Math.random() * 2);
    }
    const gtex = new THREE.CanvasTexture(gc);
    gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping; gtex.repeat.set(46, 46);
    gtex.colorSpace = THREE.SRGBColorSpace;
    const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: gtex, roughness: 0.96, metalness: 0 });
    this.terrain = new THREE.Mesh(geo, terrainMat);
    this.terrain.receiveShadow = true;
    scene.add(this.terrain);
    this.terrainData = {
      vertices: new Float32Array(pos.array),
      indices: new Uint32Array(geo.index.array),
    };

    /* water */
    this.water = new THREE.Mesh(
      new THREE.CircleGeometry(420, 48),
      new THREE.MeshStandardMaterial({ color: 0x1c6db4, transparent: true, opacity: 0.88, roughness: 0.12, metalness: 0.35 })
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0;
    scene.add(this.water);

    /* sky dome */
    this.skyUniforms = {
      topColor: { value: new THREE.Color(0x2f7fe0) },
      horizonColor: { value: new THREE.Color(0xbfe3f2) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color(0xfff2d8) },
      sunI: { value: 1 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(820, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, uniforms: this.skyUniforms,
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec3 vDir; uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunI;
          void main(){
            float h = clamp(vDir.y, -0.08, 1.0);
            vec3 col = mix(horizonColor, topColor, pow(max(h, 0.0), 0.55));
            float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
            col += sunColor * (pow(s, 350.0) * 1.6 + pow(s, 18.0) * 0.28) * sunI;
            gl_FragColor = vec4(col, 1.0);
          }`,
      })
    );
    sky.renderOrder = -10;
    scene.add(sky);

    /* stars */
    const starGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(700 * 3);
    for (let i = 0; i < 700; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(790);
      if (v.y < 20) v.y = Math.abs(v.y) + 20;
      sp.set([v.x, v.y, v.z], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfdcff, size: 2.3, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
    scene.add(this.stars);

    /* lights */
    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -55; this.sun.shadow.camera.right = 55;
    this.sun.shadow.camera.top = 55; this.sun.shadow.camera.bottom = -55;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 320;
    this.sun.shadow.bias = -0.0006;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfdcff, 0x51683f, 0.8);
    scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xbfe3f2, 90, 700);

    /* clouds: merged-puff groups drifting */
    this.clouds = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92 });
    this.cloudMat = cm;
    for (let i = 0; i < 13; i++) {
      const g = new THREE.Group();
      const n = 3 + (hash(i, 7) * 3 | 0);
      for (let j = 0; j < n; j++) {
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + hash(i, j) * 5, 1), cm);
        s.position.set(j * 4.5 - n * 2, hash(j, i) * 1.6, hash(i * 3, j) * 5 - 2.5);
        s.scale.y = 0.55;
        g.add(s);
      }
      g.position.set(hash(i, 1) * 480 - 240, 55 + hash(i, 2) * 30, hash(i, 3) * 480 - 240);
      const sc = 1.4 + hash(i, 4) * 1.8; g.scale.setScalar(sc);
      this.clouds.add(g);
    }
    scene.add(this.clouds);

    /* scatter: instanced trees + rocks (positions exported for colliders) */
    this.scatter = [];
    const trunkG = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 7);
    const canG = new THREE.IcosahedronGeometry(1.9, 1);
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 1 });
    const canM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const spots = [];
    let guard = 0;
    while (spots.length < 130 && guard++ < 3000) {
      const a = Math.random() * Math.PI * 2, r = 17 + Math.random() * 76;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, h = heightAt(x, z);
      if (h < 0.9 || h > 7.6) continue;
      if (Math.abs(heightAt(x + 1.6, z) - h) > 1.1) continue;
      spots.push({ x, z, h, s: 0.8 + Math.random() * 0.9, rot: Math.random() * Math.PI * 2 });
    }
    const trunks = new THREE.InstancedMesh(trunkG, trunkM, spots.length);
    const cans = new THREE.InstancedMesh(canG, canM, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
    spots.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot);
      m4.compose(new THREE.Vector3(p.x, p.h + 1.1 * p.s, p.z), q, sc.set(p.s, p.s, p.s));
      trunks.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(p.x, p.h + (2.4 + 1.3) * p.s, p.z), q, sc.set(p.s, p.s * 1.15, p.s));
      cans.setMatrixAt(i, m4);
      cans.setColorAt(i, new THREE.Color().setHSL(0.29 + Math.random() * 0.06, 0.5, 0.3 + Math.random() * 0.14));
      this.scatter.push({ x: p.x, z: p.z, r: 0.55 * p.s, kind: 'tree' });
    });
    trunks.castShadow = true; cans.castShadow = true;
    scene.add(trunks); scene.add(cans);

    const rockG = new THREE.IcosahedronGeometry(1, 1);
    const rockM = new THREE.MeshStandardMaterial({ color: 0x8d8578, roughness: 1, flatShading: true });
    const rocks = new THREE.InstancedMesh(rockG, rockM, 70);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 84;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, h = heightAt(x, z), s = 0.5 + Math.random() * 1.9;
      q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 3, Math.random()));
      m4.compose(new THREE.Vector3(x, h + s * 0.25, z), q, sc.set(s, s * 0.75, s));
      rocks.setMatrixAt(i, m4);
      if (h > 0.4) this.scatter.push({ x, z, r: s * 0.9, kind: 'rock' });
    }
    rocks.castShadow = true; rocks.receiveShadow = true;
    scene.add(rocks);

    /* foliage (Nanite / World Partition stand-ins): ~1500 instanced grass
       tufts in 8 sector chunks. Each chunk streams by distance from the
       camera focus — walk away and it unmounts. Tufts sway in the wind via
       a vertex-shader patch whose strength follows the weather's wind. */
    this.grassChunks = [];
    this.grassCull = 78;
    {
      const tuft = new THREE.ConeGeometry(0.16, 0.55, 5);
      tuft.translate(0, 0.27, 0);
      const gm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
      gm.onBeforeCompile = sh => {
        sh.uniforms.uTime = { value: 0 };
        sh.uniforms.uWindAmp = { value: 0.15 };
        sh.vertexShader = 'uniform float uTime; uniform float uWindAmp;\n' + sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec4 gIp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            float gBend = pow(clamp(position.y / 0.55, 0.0, 1.0), 2.0);
            float gSway = sin(uTime * 1.7 + gIp.x * 0.35 + gIp.z * 0.45) * 0.055 + sin(uTime * 3.3 + gIp.z * 0.8) * 0.02;
            transformed.x += gSway * gBend * (0.5 + uWindAmp * 1.6);
            transformed.z += gSway * 0.6 * gBend * (0.5 + uWindAmp * 1.6);
          #endif`
        );
        this._grassShader = sh;
      };
      const sectors = Array.from({ length: 8 }, () => []);
      let guard2 = 0;
      while (sectors.flat().length < 1500 && guard2++ < 9000) {
        const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 88;
        const x = Math.cos(a) * r, z = Math.sin(a) * r, h = heightAt(x, z);
        if (h < 0.9 || h > 7.6) continue;
        if (Math.abs(heightAt(x + 1.2, z) - h) > 0.9) continue;
        if (this.scatter.some(s2 => Math.abs(s2.x - x) < 1.1 && Math.abs(s2.z - z) < 1.1)) continue;
        const sec = ((Math.atan2(z, x) + Math.PI) / (Math.PI * 2) * 8 | 0) % 8;
        sectors[sec].push({ x, z, h });
      }
      const m4b = new THREE.Matrix4(), qb = new THREE.Quaternion(), upB = new THREE.Vector3(0, 1, 0), scB = new THREE.Vector3();
      sectors.forEach(list => {
        if (!list.length) return;
        const im = new THREE.InstancedMesh(tuft, gm, list.length);
        let cx = 0, cz = 0;
        list.forEach((p, i) => {
          qb.setFromAxisAngle(upB, Math.random() * Math.PI * 2);
          const s = 0.75 + Math.random() * 1.1;
          m4b.compose(new THREE.Vector3(p.x, p.h, p.z), qb, scB.set(s, s * (0.8 + Math.random() * 0.7), s));
          im.setMatrixAt(i, m4b);
          im.setColorAt(i, new THREE.Color().setHSL(0.26 + Math.random() * 0.07, 0.55, 0.3 + Math.random() * 0.16));
          cx += p.x; cz += p.z;
        });
        im.receiveShadow = true;
        scene.add(im);
        this.grassChunks.push({ mesh: im, cx: cx / list.length, cz: cz / list.length });
      });
    }

    this.weather = {
      mode: 'auto', state: 'clear',
      wet: 0, cloud: 0.06, wind: 0.15,
      t: { ...WEATHER_STATES.clear }, timer: 70,
      flash: 0, flashTimer: 6 + Math.random() * 8,
    };
    /* storm front: a localized wall of weather that visibly sweeps across the
       island (rather than the whole sky fading at once). frontProx (0..1) is
       how overhead it is; it adds wet/cloud/wind on top of the base weather.
       effWet/effCloud/effWind are the final values every system should read. */
    this.front = { active: false, x: 0, dir: 1, speed: 13, peak: 0, manual: false };
    this.frontProx = 0;
    this.effWet = 0; this.effCloud = 0.06; this.effWind = 0.15;
    this.lowFx = false;      // set by the governor (POTATO tier)
    this.focusX = 0; this.focusZ = 0; // camera focus, for front proximity + motes
    this._fxErr = '';        // first trapped render-system error (surfaces in HUD/debug)
    this._buildCloudBank();
    this._buildGlint();
    this.sfx = null; // wired by main.js (thunder)
    this.update(0);
  }

  setLowFx(v) { this.lowFx = !!v; }

  /* "Summon storm": a dark front rolls in from the horizon, passes overhead
     (rain + wind scale with its proximity, thunder cracks), then moves on.
     speed override is a test hook (headless rigs dilate sim time). */
  summonStorm(manual = true, speed = 0) {
    const f = this.front, w = this.weather;
    f.dir = Math.random() < 0.5 ? 1 : -1;
    f.x = -f.dir * 520;
    f.speed = speed > 0 ? speed : 11 + Math.random() * 5;
    f.peak = 0; f.active = true; f.manual = manual;
    if (manual) w.mode = 'manual';
    w.state = 'storm';
    // the storm arrives WITH the front — the sky underneath just gets cloudy
    w.t = { ...WEATHER_STATES.cloudy };
  }

  _frontTrap(name, fn) {
    try { fn(); } catch (e) {
      if (!this._fxErr) this._fxErr = name + ': ' + (e && e.message ? e.message : e);
    }
  }

  /* shader cloud bank: the visible wall of the approaching front */
  _buildCloudBank() {
    this.bankUniforms = {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uSeed: { value: Math.random() * 100 },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: this.bankUniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        varying vec2 vUv; uniform float uTime, uIntensity, uSeed;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
        float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); a *= 0.5; p *= 2.13; } return v; }
        void main(){
          vec2 p = vec2(vUv.x * 14.0 + uTime * 0.010, vUv.y * 5.0);
          float n = fbm(p);
          float body = smoothstep(0.30, 0.72, n + (1.0 - vUv.y) * 0.30);
          float edge = smoothstep(0.0, 0.20, vUv.y) * (1.0 - smoothstep(0.70, 1.0, vUv.y));
          float a = body * edge * uIntensity;
          vec3 dark = vec3(0.09, 0.11, 0.16);
          vec3 mid  = vec3(0.22, 0.25, 0.32);
          vec3 col = mix(dark, mid, vUv.y * 0.8 + n * 0.25);
          col += vec3(0.50, 0.42, 0.46) * smoothstep(0.62, 1.0, vUv.y) * 0.35; // lit top rim
          gl_FragColor = vec4(col, a * 0.96);
        }`,
    });
    this.bank = new THREE.Mesh(new THREE.PlaneGeometry(1150, 260), mat);
    this.bank.renderOrder = -5;
    this.bank.frustumCulled = false;
    this.bank.visible = false;
    this.bank.rotation.y = Math.PI / 2; // wall faces along the x-axis of travel
    this.scene.add(this.bank);
  }

  /* water glint: additive sun/moon specular sparkle + fresnel sheen */
  _buildGlint() {
    this.glintUniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xfff2d8) },
      uGlint: { value: 0.5 },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: this.glintUniforms,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `
        varying vec3 vW; uniform float uTime, uGlint; uniform vec3 uSunDir, uSunColor;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
        void main(){
          vec2 p = vW.xz * 0.35;
          float n = vnoise(p + uTime * 0.25) * 0.6 + vnoise(p * 2.7 - uTime * 0.18) * 0.4;
          float sparkle = pow(smoothstep(0.68, 1.0, n), 2.0);
          vec3 vd = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(vd.y, 0.0), 2.0);
          vec2 sunXZ = normalize(uSunDir.xz + vec2(1e-4, 0.0));
          vec2 viewXZ = normalize(vd.xz + vec2(1e-4, 0.0));
          float align = pow(max(dot(sunXZ, -viewXZ), 0.0), 5.0); // glitter path toward the sun/moon
          vec3 col = uSunColor * (sparkle * (0.25 + 2.2 * align) + fres * 0.12) * uGlint;
          float a = clamp(sparkle * (0.3 + align) + fres * 0.35, 0.0, 1.0) * uGlint;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.glint = new THREE.Mesh(new THREE.CircleGeometry(420, 48), mat);
    this.glint.rotation.x = -Math.PI / 2;
    this.glint.position.y = 0.04; // just above the water; splashes fly above it
    this.glint.renderOrder = 2;
    this.scene.add(this.glint);
  }

  setWeather(name) {
    const w = this.weather;
    // a manual weather pick dismisses any travelling front
    this.front.active = false; this.front.peak = 0; this.frontProx = 0;
    if (name === 'auto') { w.mode = 'auto'; w.timer = Math.min(w.timer, 3); return; }
    if (!WEATHER_STATES[name]) return;
    w.mode = 'manual'; w.state = name; w.t = { ...WEATHER_STATES[name] };
  }

  _updateWeather(dt) {
    const w = this.weather;
    if (w.mode === 'auto') {
      w.timer -= dt;
      if (w.timer <= 0) {
        const bag = ['clear', 'clear', 'clear', 'cloudy', 'cloudy', 'rain', 'rain', 'storm'];
        let next = bag[Math.random() * bag.length | 0];
        if (next === w.state) next = next === 'clear' ? 'cloudy' : 'clear';
        if (next === 'storm') {
          // auto weather doesn't just fade to storm — it sends a front through
          this.summonStorm(false);
        } else {
          w.state = next; w.t = { ...WEATHER_STATES[next] };
        }
        w.timer = 80 + Math.random() * 90;
      }
    }
    const k = Math.min(1, dt / 11); // ~11s ease between moods
    w.wet += (w.t.wet - w.wet) * k;
    w.cloud += (w.t.cloud - w.cloud) * k;
    w.wind += (w.t.wind - w.wind) * k;
    /* lightning: only when the sky is truly loaded (effective values, so a
       passing storm front cracks thunder too, not just the global mood) */
    if (this.effWet > 0.8 && this.effCloud > 0.9) {
      w.flashTimer -= dt;
      if (w.flashTimer <= 0) {
        w.flash = 1;
        w.flashTimer = 5 + Math.random() * 9;
        if (this.sfx) { const s = this.sfx, d = 350 + Math.random() * 900; setTimeout(() => s.thunder(), d); }
      }
    }
    w.flash = Math.max(0, w.flash - dt * 1.7);
  }

  setTime(h) { this.timeOfDay = ((h % 24) + 24) % 24; }

  /* the front travels along x; proximity is measured against the camera focus */
  _updateFront(dt) {
    const f = this.front;
    if (f.active) {
      f.x += f.dir * f.speed * dt;
      f.peak = Math.min(1, f.peak + dt / 6);
      const dx = Math.abs(f.x - this.focusX);
      this.frontProx = THREE.MathUtils.clamp(1 - dx / 300, 0, 1) * f.peak;
      if ((f.dir > 0 && f.x > 560) || (f.dir < 0 && f.x < -560)) {
        f.active = false;
        if (this.weather.state === 'storm') { // the storm has passed: settle back to cloudy
          this.weather.state = 'cloudy';
          this.weather.t = { ...WEATHER_STATES.cloudy };
        }
      }
    } else {
      f.peak = Math.max(0, f.peak - dt / 8);
      this.frontProx *= Math.max(0, 1 - dt / 4);
    }
  }

  _updateBank(dt) {
    const f = this.front;
    this._bankT = (this._bankT || 0) + dt;
    if (!f.active && f.peak < 0.02) { this.bank.visible = false; return; }
    this.bank.visible = true;
    this.bank.position.set(f.x, 130, this.focusZ);
    const dx = Math.abs(f.x - this.focusX);
    const nearFade = THREE.MathUtils.smoothstep(dx, 15, 70); // inside it: the sky itself is the storm
    const farFade = 1 - THREE.MathUtils.smoothstep(dx, 620, 800);
    const prox = THREE.MathUtils.clamp(1 - dx / 300, 0, 1);
    this.bankUniforms.uIntensity.value = f.peak * (0.45 + 0.55 * Math.min(1, prox * 1.6)) * nearFade * farFade;
    this.bankUniforms.uTime.value = this._bankT;
  }

  _updateGlint(dt, cloud) {
    const u = this.glintUniforms;
    u.uTime.value += dt;
    u.uSunDir.value.copy(this.skyUniforms.sunDir.value);
    u.uSunColor.value.copy(this.skyUniforms.sunColor.value);
    u.uGlint.value = (0.22 + this.skyUniforms.sunI.value * 0.6) * (1 - cloud * 0.62) * (this.lowFx ? 0.55 : 1);
  }

  update(dt) {
    if (this.autoCycle) this.timeOfDay = (this.timeOfDay + dt * this.cycleSpeed) % 24;
    this._updateFront(dt);
    if (dt > 0) this._updateWeather(dt);
    const w = this.weather;
    /* effective weather: the base mood plus the travelling front's local
       contribution — every downstream system reads these, not w.* */
    const fp = this.frontProx;
    const wet = Math.min(1, w.wet + fp);
    const cloud = Math.min(1, w.cloud + Math.min(1, fp * 1.5) * 0.5);
    const wind = w.wind + fp * 1.35;
    this.effWet = wet; this.effCloud = cloud; this.effWind = wind;
    const h = this.timeOfDay;
    const k = keyLerp(h);
    this.daylight = THREE.MathUtils.clamp(k.sunI / 1.9, 0, 1);
    if (cloud > 0.01) { k.top.lerp(GREY_TOP, cloud * 0.6); k.horizon.lerp(GREY_HOR, cloud * 0.55); }
    const sunMul = 1 - 0.78 * cloud;
    this.scene.environmentIntensity = (0.05 + Math.min(0.3, k.sunI * 0.15)) * (1 - 0.3 * cloud) + w.flash * 0.25;
    const ang = ((h - 6) / 12) * Math.PI; // sunrise 6h, sunset 18h
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.55, Math.sin(ang), 0.38).normalize();
    this.skyUniforms.topColor.value.copy(k.top);
    this.skyUniforms.horizonColor.value.copy(k.horizon);
    this.hemi.intensity = k.hemiI * (1 - 0.3 * cloud) + w.flash * 1.7;
    if (k.sunI > 0.1) {
      this.skyUniforms.sunDir.value.copy(sunDir);
      this.skyUniforms.sunColor.value.copy(k.sun);
      this.skyUniforms.sunI.value = 1;
      this.sun.position.copy(sunDir).multiplyScalar(150);
      this.sun.color.copy(k.sun);
      this.sun.intensity = k.sunI * sunMul + w.flash * 0.8;
    } else {
      // night: the key light becomes the moon — pale, dim, still casts shadows,
      // and the sky shader draws its disc from the same direction
      const mAng = ((h + 6) / 12) * Math.PI;
      const moonDir = new THREE.Vector3(Math.cos(mAng) * 0.42, Math.max(0.18, Math.sin(mAng)), 0.3).normalize();
      this.skyUniforms.sunDir.value.copy(moonDir);
      this.skyUniforms.sunColor.value.set(0xdce8ff);
      this.skyUniforms.sunI.value = 0.8;
      this.sun.position.copy(moonDir).multiplyScalar(150);
      this.sun.color.set(0xaec6ff);
      this.sun.intensity = 0.3 * (1 - 0.4 * cloud);
    }
    this.scene.fog.color.copy(k.horizon);
    if (w.flash > 0.02) this.scene.fog.color.lerp(FLASH_C, w.flash * 0.45);
    const fDens = Math.max(cloud, wet);
    this.scene.fog.near = 90 - 56 * fDens;
    this.scene.fog.far = 700 - 520 * fDens;
    this.stars.material.opacity = THREE.MathUtils.clamp(1 - k.sunI * 1.4, 0, 0.9) * (1 - cloud);
    this.cloudMat.color.setScalar(1 - cloud * 0.52);
    this.cloudMat.opacity = 0.92 + cloud * 0.07;
    for (const c of this.clouds.children) {
      c.position.x += dt * (0.7 + wind * 3.4);
      if (c.position.x > 280) c.position.x = -280;
    }
    if (this.water) this.water.material.opacity = 0.82 + Math.sin(performance.now() / 900) * 0.04;
    /* foliage streaming: unmount chunks far from the camera focus */
    if (this.grassChunks) {
      for (const ch of this.grassChunks) {
        ch.mesh.visible = Math.hypot(ch.cx - this.focusX, ch.cz - this.focusZ) < (this.lowFx ? Math.min(52, this.grassCull) : this.grassCull);
      }
      if (this._grassShader) {
        this._grassShader.uniforms.uTime.value += dt;
        this._grassShader.uniforms.uWindAmp.value = wind;
      }
    }
    /* new render systems ride behind seatbelts: an exception here must never
       freeze the canvas while the HUD keeps ticking (the .30 lesson) */
    this._frontTrap('bank', () => this._updateBank(dt));
    this._frontTrap('glint', () => this._updateGlint(dt, cloud));
  }

  /* keep the shadow camera centred on the action (+ remember the focus for
     front proximity and the mote field) */
  followShadows(target) {
    this.focusX = target.x; this.focusZ = target.z;
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).add(new THREE.Vector3().copy(this.skyUniforms.sunDir.value).multiplyScalar(150));
  }
}
