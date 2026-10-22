/* Project Nexus — ambient NPC (the Gameplay Framework / AI stand-in):
   a second soldier who lives on the island — wanders between waypoints,
   idles, looks around — running the same animation state machine pattern
   as the player and the multiplayer ghosts. Visual pawn: it steers by the
   heightfield (no physics body), which is honest demo-tier AI. */
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { heightAt } from '../world/environment.js';

function nameSprite(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,14,22,0.66)';
  g.beginPath(); g.roundRect(28, 8, 200, 46, 12); g.fill();
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffd94d';
  g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(2.6, 0.65, 1);
  s.position.y = 2.3;
  return s;
}

export class Npc {
  constructor(scene, gltf) {
    this.model = skeletonClone(gltf.scene);
    this.model.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.model.add(nameSprite('Nexus Bot'));
    scene.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.current = null;
    this.pos = new THREE.Vector3(4, 0, 2);
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.yaw = Math.PI * 0.75;
    this.state = 'idle';
    this.wait = 1.5;
    this.target = null;
    this.speed = 2.3;
    this._play('Idle', 0);
  }

  _play(name, fade = 0.22) {
    const next = this.actions[name];
    if (!next || this.current === next) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  _pickTarget() {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 34;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (heightAt(x, z) > 0.9) return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(0, 0, 8);
  }

  update(dt) {
    if (this.state === 'idle') {
      this._play('Idle');
      this.wait -= dt;
      if (this.wait <= 0) { this.target = this._pickTarget(); this.state = 'walk'; }
    } else {
      this._play('Walk');
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.7) { this.state = 'idle'; this.wait = 1 + Math.random() * 2.6; }
      else {
        const want = Math.atan2(dx, dz);
        let dr = want - this.yaw;
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        this.yaw += dr * Math.min(1, 7 * dt);
        this.pos.x += Math.sin(this.yaw) * this.speed * dt;
        this.pos.z += Math.cos(this.yaw) * this.speed * dt;
      }
    }
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.model.position.copy(this.pos);
    /* Soldier is authored facing -Z (same convention as the player/ghosts) */
    this.model.rotation.y = this.yaw + Math.PI;
    this.mixer.update(dt);
  }
}
