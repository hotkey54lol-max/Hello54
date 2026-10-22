/* Project Nexus — ambient particles (the Niagara stand-in): one Points
   cloud that lives around the player and changes character with the light.
   Day: drifting pollen/dust motes catching the sun. Night: fireflies —
   green-gold, blinking, bobbing low over the grass. Rain washes them out. */
import * as THREE from 'three';

const N = 420;
const BOX = { x: 48, y: 13, z: 48 };
const C_DUST = new THREE.Color(0xffe9a8), C_LEAF = new THREE.Color(0x7fae5a), C_FLY = new THREE.Color(0xa8ff70);

export class Particles {
  constructor(scene) {
    this.off = new Float32Array(N * 3);   // home offsets inside the box
    this.phase = new Float32Array(N);
    this.leaf = new Uint8Array(N);        // ~1 in 4 motes is a leaf, not dust
    for (let i = 0; i < N; i++) {
      this.off.set([(Math.random() - 0.5) * BOX.x, Math.random() * BOX.y, (Math.random() - 0.5) * BOX.z], i * 3);
      this.phase[i] = Math.random() * Math.PI * 2;
      this.leaf[i] = Math.random() < 0.25 ? 1 : 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.geo = geo;
    this.mat = new THREE.PointsMaterial({
      size: 0.16, transparent: true, opacity: 0.35, vertexColors: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.mode = 'dust';
    this.lowFx = false;
    scene.add(this.points);
    this.t = 0;
  }

  /* POTATO tier: halve the particle count instead of dropping frames */
  setLowFx(v) {
    this.lowFx = !!v;
    this.geo.setDrawRange(0, this.lowFx ? (N / 2) | 0 : N);
  }

  /* daylight: 0 (deep night) .. 1 (midday); wet: 0..1 rain amount;
     wind: 0..~2.5 — drives the drift, so storms visibly whip the leaves */
  update(dt, focus, daylight, wet, wind = 0.15) {
    this.t += dt;
    const t = this.t;
    const night = 1 - THREE.MathUtils.clamp(daylight, 0, 1);
    this.mode = night > 0.62 ? 'fireflies' : 'dust';
    const drift = 0.35 + wind * 2.4;      // wind-driven sideways travel
    const turb = 1 + wind * 1.6;          // gusts shake the bob too
    const pos = this.geo.attributes.position, col = this.geo.attributes.color;
    const flies = this.mode === 'fireflies';
    for (let i = 0; i < N; i++) {
      const ph = this.phase[i];
      // slow drift + bob; fireflies wander wider and blink via y-dips
      const dx = Math.sin(t * 0.24 + ph) * 1.6 * turb + t * drift;
      const dz = Math.cos(t * 0.19 + ph * 1.7) * 1.6 * turb + t * drift * 0.3;
      const bob = flies
        ? Math.sin(t * 1.4 + ph * 3.1) * 0.55
        : Math.sin(t * 0.5 + ph) * 0.4 * turb;
      let x = this.off[i * 3] + dx, y = this.off[i * 3 + 1], z = this.off[i * 3 + 2] + dz;
      x = ((x % BOX.x) + BOX.x * 1.5) % BOX.x - BOX.x / 2;
      z = ((z % BOX.z) + BOX.z * 1.5) % BOX.z - BOX.z / 2;
      const groundish = flies ? Math.min(y, 4.5) : y;
      pos.setXYZ(i, focus.x + x, focus.y - 2 + groundish + bob, focus.z + z);
      const c = flies ? C_FLY : (this.leaf[i] ? C_LEAF : C_DUST);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    if (flies) {
      this.mat.size = 0.21;
      this.mat.opacity = (0.35 + 0.6 * night) * (1 - wet * 0.85);
    } else {
      this.mat.size = 0.15 + Math.min(0.1, wind * 0.03);
      this.mat.opacity = Math.min(0.6, 0.32 * (1 - night * 0.5) * (1 - wet * 0.8) + wind * 0.06);
    }
  }
}
