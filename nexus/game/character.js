/* Project Nexus — Character (Unreal vocabulary): the possessed body.
   A smooth skeletal model driven by the Rapier character controller,
   with an idle/walk/run animation state machine. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { heightAt } from '../world/environment.js';

const CAP_LIFT = 0.88; // capsule centre height above the feet

export class Character {
  constructor(scene, physics, input) {
    this.scene = scene; this.physics = physics; this.input = input;
    this.spawn = new THREE.Vector3(0, heightAt(0, 6) + CAP_LIFT + 0.35, 6);
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.faceYaw = Math.PI;
    this.grounded = false;
    this.camYaw = Math.PI; this.camPitch = 0.34; this.camDist = 6.5;
    this._jumpPrev = false;
    this.speed2d = 0;
  }

  async init() {
    const gltf = await new GLTFLoader().loadAsync(new URL('../assets/models/Soldier.glb', import.meta.url).href);
    this.model = gltf.scene;
    this.model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; } });
    this.scene.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      this.actions[clip.name] = a;
    }
    this.current = null;
    this._play('Idle', 0);
    const t = this.physics.makeCharacter(this.spawn.x, this.spawn.y, this.spawn.z);
    this.body = t.body; this.collider = t.collider;
    this.physics.preStep = dt => this._physicsStep(dt);
    this._snapModel();
  }

  _play(name, fade = 0.18) {
    const next = this.actions[name];
    if (!next || this.current === next) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  _physicsStep(dt) {
    const inp = this.input;
    const ax = inp.axis();
    const sprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
    const maxSpeed = sprint ? 8.2 : 4.4;
    const sy = Math.sin(this.camYaw), cy = Math.cos(this.camYaw);
    // camera forward on the ground plane (camera sits at +sin,+cos behind the player)
    const fwd = new THREE.Vector3(-sy, 0, -cy);
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3()
      .addScaledVector(fwd, -ax.y)
      .addScaledVector(right, ax.x);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(maxSpeed);

    const accel = this.grounded ? 34 : 9;
    const k = Math.min(1, accel * dt / Math.max(1, maxSpeed));
    this.vel.x += (wish.x - this.vel.x) * (this.grounded ? Math.min(1, 14 * dt) : k * 0.4);
    this.vel.z += (wish.z - this.vel.z) * (this.grounded ? Math.min(1, 14 * dt) : k * 0.4);

    this._t = (this._t || 0) + dt;
    if (this.grounded) this._lastGroundedT = this._t;
    if (this.grounded) this.vy = Math.max(this.vy, -2);
    else this.vy -= 18 * dt;
    const jumpNow = inp.down('Space');
    if (jumpNow && !this._jumpPrev) this._jumpBufferT = this._t;
    this._jumpPrev = jumpNow;
    if (this._jumpBufferT !== undefined && this._t - this._jumpBufferT < 0.12 &&
        this._lastGroundedT !== undefined && this._t - this._lastGroundedT < 0.12) {
      this.vy = 7.6; this._jumpBufferT = -9;
    }

    const desired = { x: this.vel.x * dt, y: this.vy * dt, z: this.vel.z * dt };
    const res = this.physics.moveCharacter({ body: this.body, collider: this.collider }, desired);
    this.grounded = res.grounded;
    if (this.grounded && this.vy < 0) this.vy = 0;
    this.speed2d = Math.hypot(this.vel.x, this.vel.z);

    const t = this.body.translation();
    if (t.y < -10) { // fell off the island
      this.body.setTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z }, true);
      this.body.setNextKinematicTranslation({ x: this.spawn.x, y: this.spawn.y, z: this.spawn.z });
      this.vel.set(0, 0, 0); this.vy = 0;
    }
    if (this.speed2d > 0.4) {
      const target = Math.atan2(this.vel.x, this.vel.z);
      let d = target - this.faceYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.faceYaw += d * Math.min(1, 12 * dt);
    }
  }

  _snapModel() {
    const t = this.body.translation();
    this.model.position.set(t.x, t.y - CAP_LIFT, t.z);
    this.model.rotation.y = this.faceYaw + Math.PI; // Soldier.glb is authored facing -Z
  }

  render(dt, camera) {
    if (!this.model) return;
    this._snapModel();
    // animation state from speed
    const s = this.speed2d;
    if (s < 0.35) this._play('Idle');
    else if (s < 5) { this._play('Walk'); if (this.current) this.current.setEffectiveTimeScale(THREE.MathUtils.clamp(s / 2.2, 0.5, 1.7)); }
    else { this._play('Run'); if (this.current) this.current.setEffectiveTimeScale(THREE.MathUtils.clamp(s / 5.2, 0.7, 1.5)); }
    if (this.mixer) this.mixer.update(dt);

    // camera: drag orbit + wheel zoom, smoothed follow
    const look = this.input.consumeLook();
    this.camYaw -= look.dx * 0.0042;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + look.dy * 0.0032, -0.12, 1.25);
    this.camDist = THREE.MathUtils.clamp(this.camDist + this.input.consumeWheel() * 0.008, 2.2, 14);
    const t = this.body.translation();
    const target = new THREE.Vector3(t.x, t.y - CAP_LIFT + 1.55, t.z);
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const want = new THREE.Vector3(
      t.x + Math.sin(this.camYaw) * cp * this.camDist,
      target.y + sp * this.camDist,
      t.z + Math.cos(this.camYaw) * cp * this.camDist
    );
    const groundY = heightAt(want.x, want.z) + 0.45;
    if (want.y < groundY) want.y = groundY;
    camera.position.lerp(want, 1 - Math.pow(0.0000015, dt)); // ~frame-rate independent damping
    camera.lookAt(target);
    this.headPos = target;
  }

  get pos() { const t = this.body.translation(); return { x: t.x, y: t.y - CAP_LIFT, z: t.z }; }
}
