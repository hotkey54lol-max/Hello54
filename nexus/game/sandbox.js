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
    this._buildRain();
  }

  _buildRain() {
    const N = 1500;
    const posArr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) posArr.set([(Math.random() - 0.5) * 52, Math.random() * 30, (Math.random() - 0.5) * 52], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    this.rain = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fc4e8, size: 0.13, transparent: true, opacity: 0.55, depthWrite: false }));
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
      const old = this.physics.props.find(p => !p.fixed);
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
    } else if (kind === 'tower') {
      for (let i = 0; i < 5; i++) setTimeout(() => this.spawn('crate'), i * 130);
    }
  }

  clearProps() {
    for (const p of [...this.physics.props]) { this.scene.remove(p.mesh); this.physics.removeProp(p); }
  }

  render(dt) {
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
