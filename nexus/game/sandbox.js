/* Sandbox Of Nexus — the engine's proving ground: spawn toys, bend time, make weather. */
import * as THREE from 'three';
import { heightAt } from '../world/environment.js';

const MAX_PROPS = 130;

function woodTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#a0763e'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = i % 2 ? '#9a6f39' : '#ab7f45';
    g.fillRect(0, i * 26, 128, 24);
    g.fillStyle = 'rgba(60,38,14,0.5)';
    for (let s = 0; s < 12; s++) g.fillRect(Math.random() * 128, i * 26 + 4 + Math.random() * 16, 8 + Math.random() * 26, 2);
  }
  g.strokeStyle = '#5e421f'; g.lineWidth = 10; g.strokeRect(0, 0, 128, 128);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(128, 128); g.moveTo(128, 0); g.lineTo(0, 128);
  g.lineWidth = 5; g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Sandbox {
  constructor(scene, physics, character, env) {
    this.scene = scene; this.physics = physics; this.character = character; this.env = env;
    this.wood = woodTexture();
    this.bombs = [];
    this.shards = []; // live crate debris { prop, ttl }
    this.wrecks = []; // wrecking-ball rigs { prop, line, post, knob, pivot }
    this.sfx = null;
    this.lowFx = false; // governor: POTATO tier halves splash particles
    this._buildRain();
    this._buildExplosionFx();
    this._buildSplashes();
  }

  setLowFx(v) { this.lowFx = !!v; }

  /* splash pool: white-water bursts when a prop punches the surface */
  _buildSplashes() {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 1, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(c);
    this.splashPool = []; this._splashIdx = 0;
    for (let s = 0; s < 6; s++) {
      const N = 36, pos = new Float32Array(N * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xd8ecff, size: 0.17, map: tex, transparent: true, opacity: 0, depthWrite: false,
      }));
      pts.visible = false; pts.frustumCulled = false;
      this.scene.add(pts);
      this.splashPool.push({ pts, vel: new Float32Array(N * 3), t: -1, n: N });
    }
  }

  splash(x, z, power = 2) {
    try {
      const s = this.splashPool[this._splashIdx++ % this.splashPool.length];
      const n = this.lowFx ? (s.n / 2) | 0 : s.n; // POTATO: halve the droplets
      const pa = s.pts.geometry.attributes.position;
      for (let i = 0; i < s.n; i++) {
        const on = i < n;
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.35;
        pa.setXYZ(i, x + Math.cos(a) * r, on ? 0.12 : -10, z + Math.sin(a) * r);
        const sp = (1.5 + Math.random() * 3) * Math.min(2.2, 0.6 + power * 0.25);
        s.vel.set([Math.cos(a) * sp * 0.45, sp, Math.sin(a) * sp * 0.45], i * 3);
        if (!on) { s.vel[i * 3 + 1] = 0; pa.setY(i, -10); }
      }
      pa.needsUpdate = true;
      s.t = 0; s.pts.visible = true; s.pts.material.opacity = 0.9;
    } catch (e) { /* a failed splash must never break the frame */ }
  }

  splashActiveCount() { return this.splashPool.filter(s => s.t >= 0).length; }

  _updateSplashes(dt) {
    for (const s of this.splashPool) {
      if (s.t < 0) continue;
      s.t += dt;
      const pa = s.pts.geometry.attributes.position;
      for (let i = 0; i < s.n; i++) {
        s.vel[i * 3 + 1] -= 9.5 * dt;
        pa.setXYZ(i,
          pa.getX(i) + s.vel[i * 3] * dt,
          Math.max(-9, pa.getY(i) + s.vel[i * 3 + 1] * dt),
          pa.getZ(i) + s.vel[i * 3 + 2] * dt);
      }
      pa.needsUpdate = true;
      s.pts.material.opacity = Math.max(0, 0.9 * (1 - s.t / 0.75));
      if (s.t > 0.75) { s.t = -1; s.pts.visible = false; }
    }
  }

  _buildExplosionFx() {
    this.flash = new THREE.PointLight(0xffa050, 0, 26, 1.6);
    this.scene.add(this.flash);
    const N = 260;
    const pos = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.burst = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffb060, size: 0.22, transparent: true, opacity: 0, depthWrite: false }));
    this.burst.visible = false;
    this.burstVel = new Float32Array(N * 3);
    this.burstT = -1;
    this.scene.add(this.burst);
  }

  /* Chaos-destruction stand-in: a crate caught in the inner blast doesn't
     fly — it SHATTERS into debris shards that scatter, settle, then fade */
  breakCrate(prop) {
    const t = prop.body.translation();
    const v = prop.body.linvel();
    this.scene.remove(prop.mesh);
    this.physics.removeProp(prop);
    if (!this.shardMat) this.shardMat = new THREE.MeshStandardMaterial({ map: this.wood, roughness: 0.95 });
    const geo = new THREE.BoxGeometry(0.38, 0.38, 0.38);
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(geo, this.shardMat);
      m.castShadow = true;
      const px = t.x + (Math.random() - 0.5) * 0.3, py = t.y + (Math.random() - 0.5) * 0.3, pz = t.z + (Math.random() - 0.5) * 0.3;
      m.position.set(px, py, pz);
      this.scene.add(m);
      const sp = this.physics.addProp('shard', m, px, py, pz);
      sp.body.setLinvel({ x: v.x + (Math.random() - 0.5) * 3.6, y: v.y + 2.2 + Math.random() * 2.4, z: v.z + (Math.random() - 0.5) * 3.6 }, true);
      sp.body.setAngvel({ x: (Math.random() - 0.5) * 9, y: (Math.random() - 0.5) * 9, z: (Math.random() - 0.5) * 9 }, true);
      this.shards.push({ prop: sp, ttl: 7 });
    }
    if (this.sfx) this.sfx.noiseBurst(0.22, 0.32, 750);
  }

  _detonate(bomb) {
    const bp = bomb.mesh.position.clone();
    const R = 8.5;
    const toBreak = [];
    for (const p of this.physics.props) {
      if (p === bomb.prop || p.fixed) continue;
      const t = p.body.translation();
      const d = Math.hypot(t.x - bp.x, t.y - bp.y, t.z - bp.z);
      if (d > R) continue;
      if (p.kind === 'crate' && d < R * 0.55) { toBreak.push(p); continue; }
      const f = (1 - d / R);
      const dir = new THREE.Vector3(t.x - bp.x, (t.y - bp.y) + 1.6, t.z - bp.z).normalize();
      const imp = dir.multiplyScalar(f * 13 * p.body.mass());
      p.body.applyImpulse({ x: imp.x, y: imp.y, z: imp.z }, true);
    }
    for (const p of toBreak) this.breakCrate(p);
    const cp = this.character.pos;
    const cd = Math.hypot(cp.x - bp.x, cp.z - bp.z);
    if (cd < 7) {
      const f = 1 - cd / 7;
      const dir = new THREE.Vector3(cp.x - bp.x, 0, cp.z - bp.z).normalize();
      this.character.vel.x += dir.x * f * 11;
      this.character.vel.z += dir.z * f * 11;
      this.character.vy = Math.max(this.character.vy, f * 8);
    }
    this.flash.position.copy(bp).y += 1;
    this.flash.intensity = 260;
    const posAttr = this.burst.geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      posAttr.setXYZ(i, bp.x, bp.y + 0.4, bp.z);
      const v = new THREE.Vector3().randomDirection().multiplyScalar(3 + Math.random() * 9);
      v.y = Math.abs(v.y) * 1.1 + 2;
      this.burstVel.set([v.x, v.y, v.z], i * 3);
    }
    posAttr.needsUpdate = true;
    this.burst.visible = true;
    this.burst.material.opacity = 0.95;
    this.burstT = 0;
    if (this.sfx) this.sfx.boom();
    this.scene.remove(bomb.mesh);
    this.physics.removeProp(bomb.prop);
    this.bombs.splice(this.bombs.indexOf(bomb), 1);
  }

  _buildRain() {
    const N = 1500;
    const posArr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) posArr.set([(Math.random() - 0.5) * 52, Math.random() * 30, (Math.random() - 0.5) * 52], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    // soft vertical streak sprite — rain reads as streaks, not confetti squares
    const c = document.createElement('canvas'); c.width = 8; c.height = 32;
    const gg = c.getContext('2d');
    const grad = gg.createLinearGradient(0, 0, 0, 32);
    grad.addColorStop(0, 'rgba(180,210,240,0)');
    grad.addColorStop(0.5, 'rgba(180,210,240,0.95)');
    grad.addColorStop(1, 'rgba(180,210,240,0)');
    gg.fillStyle = grad; gg.fillRect(2, 0, 4, 32);
    this.rain = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fc4e8, size: 0.42, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.55, depthWrite: false }));
    this.rain.visible = false;
    this.raining = false;
    this.scene.add(this.rain);
  }

  setRain(on) { this.raining = on; this.rain.visible = on; }

  _front(dist = 3.6) {
    const p = this.character.pos;
    const dir = new THREE.Vector3(Math.sin(this.character.faceYaw), 0, Math.cos(this.character.faceYaw));
    return { x: p.x + dir.x * dist, z: p.z + dir.z * dist };
  }

  spawn(kind) {
    if (this.physics.props.length >= MAX_PROPS && kind !== 'plank') {
      const old = this.physics.props.find(p => !p.fixed && p.kind !== 'bomb');
      if (old) { this.scene.remove(old.mesh); this.physics.removeProp(old); }
    }
    const f = this._front();
    if (kind === 'crate') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.MeshStandardMaterial({ map: this.wood, roughness: 0.9 }));
      m.castShadow = m.receiveShadow = true;
      m.position.set(f.x, heightAt(f.x, f.z) + 2.4, f.z);
      this.scene.add(m);
      this.physics.addProp('crate', m, f.x, m.position.y, f.z);
    } else if (kind === 'ball') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.62, 26, 20), new THREE.MeshStandardMaterial({ color: 0xff7847, roughness: 0.28, metalness: 0.05 }));
      m.castShadow = true;
      m.position.set(f.x, heightAt(f.x, f.z) + 2.2, f.z);
      this.scene.add(m);
      this.physics.addProp('ball', m, f.x, m.position.y, f.z);
    } else if (kind === 'barrel') {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 1.5, 20), new THREE.MeshStandardMaterial({ color: 0x3f6fb5, roughness: 0.45, metalness: 0.55 }));
      m.castShadow = m.receiveShadow = true;
      m.position.set(f.x, heightAt(f.x, f.z) + 2.4, f.z);
      this.scene.add(m);
      this.physics.addProp('barrel', m, f.x, m.position.y, f.z);
    } else if (kind === 'plank') {
      const yaw = this.character.faceYaw;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-26 * Math.PI / 180, yaw, 0, 'YXZ'));
      const m = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.28, 6.8), new THREE.MeshStandardMaterial({ map: this.wood, roughness: 0.9 }));
      m.castShadow = m.receiveShadow = true;
      const gy = heightAt(f.x, f.z);
      m.position.set(f.x, gy + 1.45, f.z);
      m.quaternion.copy(q);
      this.scene.add(m);
      this.physics.addProp('plank', m, f.x, gy + 1.45, f.z, { quat: { x: q.x, y: q.y, z: q.z, w: q.w } });
    } else if (kind === 'bomb') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.55, 22, 16), new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.35, metalness: 0.65, emissive: 0xff2a18, emissiveIntensity: 0.4 }));
      m.castShadow = true;
      m.position.set(f.x, heightAt(f.x, f.z) + 2.2, f.z);
      this.scene.add(m);
      const prop = this.physics.addProp('bomb', m, f.x, m.position.y, f.z);
      this.bombs.push({ prop, mesh: m, t: 1.7 });
    } else if (kind === 'tower') {
      for (let i = 0; i < 5; i++) setTimeout(() => this.spawn('crate'), i * 130);
    } else if (kind === 'bigball') {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.35, 30, 22), new THREE.MeshStandardMaterial({ color: 0xffd23e, roughness: 0.32, metalness: 0.05 }));
      m.castShadow = true;
      m.position.set(f.x, heightAt(f.x, f.z) + 3.4, f.z);
      this.scene.add(m);
      this.physics.addProp('bigball', m, f.x, m.position.y, f.z);
    } else if (kind === 'wrecking') {
      /* a wrecking ball on a real pendulum joint (Chaos demo): a heavy
         steel ball hung from a post — walk into it and it swings through
         whatever you built. Rope drawn as a line, updated per frame. */
      const yaw = this.character.faceYaw;
      const px = f.x + Math.sin(yaw) * 1.5, pz = f.z + Math.cos(yaw) * 1.5;
      const gy = heightAt(px, pz);
      const pivot = new THREE.Vector3(px, gy + 4.6, pz);
      const LEN = 3.6, off = 1.4;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 4.6, 8), new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 }));
      post.position.set(px, gy + 2.3, pz);
      post.castShadow = true;
      this.scene.add(post);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5, metalness: 0.6 }));
      knob.position.copy(pivot);
      this.scene.add(knob);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.55, 22, 16), new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.42, metalness: 0.65 }));
      m.castShadow = true;
      /* displaced along the facing direction, so it hangs dead ahead of
         the player and swings in the walk plane — walk in and meet it */
      const bx = px + Math.sin(yaw) * off, by = pivot.y - Math.sqrt(LEN * LEN - off * off), bz = pz + Math.cos(yaw) * off;
      m.position.set(bx, by, bz);
      this.scene.add(m);
      const prop = this.physics.addProp('wreckball', m, bx, by, bz);
      this.physics.addPendulum(prop, pivot.x, pivot.y, pivot.z, LEN);
      const lineGeo = new THREE.BufferGeometry().setFromPoints([pivot, m.position]);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x1d1d1f }));
      this.scene.add(line);
      this.wrecks.push({ prop, line, post, knob, pivot });
    } else if (kind === 'dominoes') {
      /* a curving run of rainbow dominoes — walk into the first one (or bomb
         the line) and watch the chain reaction snake across the grass */
      const N = 14, GAP = 0.55;
      while (this.physics.props.length + N > MAX_PROPS) {
        const old = this.physics.props.find(p => !p.fixed && p.kind !== 'bomb');
        if (!old) break;
        this.scene.remove(old.mesh); this.physics.removeProp(old);
      }
      const yaw0 = this.character.faceYaw;
      const dir = new THREE.Vector3(Math.sin(yaw0), 0, Math.cos(yaw0));
      const perp = new THREE.Vector3(dir.z, 0, -dir.x);
      const sx = f.x + dir.x * 1.4, sz = f.z + dir.z * 1.4;
      const geo = new THREE.BoxGeometry(0.7, 1.35, 0.26);
      const cA = new THREE.Color(0xff4757), cB = new THREE.Color(0x3742fa);
      for (let i = 0; i < N; i++) {
        const t = i * GAP;
        const lat = Math.sin(t * 0.55) * 1.15;              // S-curve sideways offset
        const dLat = Math.cos(t * 0.55) * 1.15 * 0.55;      // its slope → tangent
        const px = sx + dir.x * t + perp.x * lat;
        const pz = sz + dir.z * t + perp.z * lat;
        const tx = dir.x + perp.x * dLat, tz = dir.z + perp.z * dLat;
        const yaw = Math.atan2(tx, tz);
        const col = cA.clone().lerp(cB, i / (N - 1));
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }));
        m.castShadow = m.receiveShadow = true;
        const gy = heightAt(px, pz);
        m.position.set(px, gy + 0.69, pz);
        /* stand the base flush with the terrain: align the domino's up axis
           to the ground normal (sampled from the same heightAt the physics
           terrain uses) so runs stay standing on slopes */
        const e = 0.35;
        const n = new THREE.Vector3(
          -(heightAt(px + e, pz) - heightAt(px - e, pz)) / (2 * e), 1,
          -(heightAt(px, pz + e) - heightAt(px, pz - e)) / (2 * e)).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)
          .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)));
        m.quaternion.copy(q);
        this.scene.add(m);
        this.physics.addProp('domino', m, px, gy + 0.69, pz, { quat: { x: q.x, y: q.y, z: q.z, w: q.w } });
      }
    }
    if (this.sfx && kind !== 'tower') this.sfx.spawnPop();
  }

  clearProps() {
    for (const p of [...this.physics.props]) { this.scene.remove(p.mesh); this.physics.removeProp(p); }
    this.shards.length = 0;
    for (const w of this.wrecks) { this.scene.remove(w.line); this.scene.remove(w.post); this.scene.remove(w.knob); }
    this.wrecks.length = 0;
  }

  render(dt) {
    /* wrecking-ball ropes follow their balls; prune rigs whose ball was
       removed (cleared or cap-evicted) so no orphan posts/lines remain */
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      if (!this.physics.props.includes(w.prop)) {
        this.scene.remove(w.line); this.scene.remove(w.post); this.scene.remove(w.knob);
        this.wrecks.splice(i, 1);
        continue;
      }
      const bp = w.prop.mesh.position;
      const attr = w.line.geometry.attributes.position;
      attr.setXYZ(0, w.pivot.x, w.pivot.y, w.pivot.z);
      attr.setXYZ(1, bp.x, bp.y, bp.z);
      attr.needsUpdate = true;
    }
    /* crate debris ages out: shrink over the last second, then remove */
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.ttl -= dt;
      if (s.ttl < 1) s.prop.mesh.scale.setScalar(Math.max(0.02, s.ttl));
      if (s.ttl <= 0) {
        this.scene.remove(s.prop.mesh);
        if (this.physics.props.includes(s.prop)) this.physics.removeProp(s.prop);
        this.shards.splice(i, 1);
      }
    }
    /* weather drives the rain now (the old manual toggle is a weather
       override wired in main.js): wetness fades the rain in, wind slants it.
       Effective values include any passing storm front. */
    const wet = this.env.effWet !== undefined ? this.env.effWet : this.env.weather.wet;
    const wind = this.env.effWind !== undefined ? this.env.effWind : this.env.weather.wind;
    this.setRain(wet > 0.04);
    if (this.raining) {
      this.rain.material.opacity = 0.12 + wet * 0.45;
      this.rain.rotation.z = wind * 0.16;
    }
    this._updateSplashes(dt);
    // bomb fuses + explosion fx
    for (const b of [...this.bombs]) {
      b.t -= dt;
      b.mesh.material.emissiveIntensity = 0.4 + Math.max(0, 1.7 - b.t) * (Math.sin(performance.now() / 55) * 0.5 + 0.9);
      if (b.t <= 0) this._detonate(b);
    }
    if (this.flash.intensity > 0) this.flash.intensity = Math.max(0, this.flash.intensity - dt * 900);
    if (this.burstT >= 0) {
      this.burstT += dt;
      const posAttr = this.burst.geometry.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        const vx = this.burstVel[i * 3], vy = this.burstVel[i * 3 + 1] - 12 * dt, vz = this.burstVel[i * 3 + 2];
        this.burstVel[i * 3 + 1] = vy;
        posAttr.setXYZ(i, posAttr.getX(i) + vx * dt, posAttr.getY(i) + vy * dt, posAttr.getZ(i) + vz * dt);
      }
      posAttr.needsUpdate = true;
      this.burst.material.opacity = Math.max(0, 0.95 - this.burstT * 1.1);
      if (this.burstT > 0.95) { this.burstT = -1; this.burst.visible = false; }
    }
    if (this.raining && this.character.headPos) {
      const posAttr = this.rain.geometry.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        let y = posAttr.getY(i) - 23 * dt;
        if (y < 0) y += 30;
        posAttr.setY(i, y);
      }
      posAttr.needsUpdate = true;
      this.rain.position.set(this.character.headPos.x, this.character.headPos.y - 4, this.character.headPos.z);
    }
  }
}
