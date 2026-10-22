/* Project Nexus — environment: terrain, sky, day/night, water, scatter.
   One deterministic height function feeds BOTH the visual mesh and the
   physics collider, so what you see is exactly what you collide with. */
import * as THREE from 'three';

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
function keyLerp(h) {
  let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) if (h >= SKY_KEYS[i][0] && h <= SKY_KEYS[i + 1][0]) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
  const t = (h - a[0]) / Math.max(0.0001, b[0] - a[0]);
  const C = i => new THREE.Color(a[i]).lerp(new THREE.Color(b[i]), t);
  return { top: C(1), horizon: C(2), sun: C(3), sunI: a[4] + (b[4] - a[4]) * t, hemiI: a[5] + (b[5] - a[5]) * t };
}

export class Environment {
  constructor(scene) {
    this.scene = scene;
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

    this.update(0);
  }

  setTime(h) { this.timeOfDay = ((h % 24) + 24) % 24; }

  update(dt) {
    if (this.autoCycle) this.timeOfDay = (this.timeOfDay + dt * this.cycleSpeed) % 24;
    const h = this.timeOfDay;
    const k = keyLerp(h);
    const ang = ((h - 6) / 12) * Math.PI; // sunrise 6h, sunset 18h
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.55, Math.sin(ang), 0.38).normalize();
    this.skyUniforms.topColor.value.copy(k.top);
    this.skyUniforms.horizonColor.value.copy(k.horizon);
    this.hemi.intensity = k.hemiI;
    if (k.sunI > 0.1) {
      this.skyUniforms.sunDir.value.copy(sunDir);
      this.skyUniforms.sunColor.value.copy(k.sun);
      this.skyUniforms.sunI.value = 1;
      this.sun.position.copy(sunDir).multiplyScalar(150);
      this.sun.color.copy(k.sun);
      this.sun.intensity = k.sunI;
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
      this.sun.intensity = 0.3;
    }
    this.scene.fog.color.copy(k.horizon);
    this.stars.material.opacity = THREE.MathUtils.clamp(1 - k.sunI * 1.4, 0, 0.9);
    for (const c of this.clouds.children) {
      c.position.x += dt * 0.7;
      if (c.position.x > 280) c.position.x = -280;
    }
    if (this.water) this.water.material.opacity = 0.82 + Math.sin(performance.now() / 900) * 0.04;
  }

  /* keep the shadow camera centred on the action */
  followShadows(target) {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).add(new THREE.Vector3().copy(this.skyUniforms.sunDir.value).multiplyScalar(150));
  }
}
