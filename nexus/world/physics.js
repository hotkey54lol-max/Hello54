/* Project Nexus — physics on Rapier (WASM rigid bodies).
   Runs on the main thread for this build (sandbox scale is small);
   the module boundary keeps a worker move possible later. */
import RAPIER from 'rapier';

/* plain-object lerp helpers (physics.js stays three-free) */
function lerp3(a, b, t, out) {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}
/* normalized lerp of quats: exact enough for one 1/60s interval, no import needed */
function nlerpQ(a, b, t, out) {
  const s = (a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w) < 0 ? -1 : 1;
  out.x = a.x + (b.x * s - a.x) * t;
  out.y = a.y + (b.y * s - a.y) * t;
  out.z = a.z + (b.z * s - a.z) * t;
  out.w = a.w + (b.w * s - a.w) * t;
  const l = Math.hypot(out.x, out.y, out.z, out.w) || 1;
  out.x /= l; out.y /= l; out.z /= l; out.w /= l;
  return out;
}

export class Physics {
  constructor() {
    this.ready = false; this.props = []; this.preStep = null;
    this.charBody = null;      // kinematic character body tracked for interpolation
    this.onSplash = null;      // (x, z, power) => {} — prop hit the water
    this._hadSteps = false;    // any sim substeps ran this render frame
  }

  async init(terrainData, scatter) {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -18, z: 0 }); // slightly gamey gravity: snappier arcs
    const groundBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(terrainData.vertices, terrainData.indices), groundBody);
    for (const s of scatter) {
      // body carries the world position; collider offsets are LOCAL to the body
      const b = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      if (s.kind === 'tree') this.world.createCollider(RAPIER.ColliderDesc.cylinder(3.2, s.r).setTranslation(s.x, 3.2, s.z), b);
      else this.world.createCollider(RAPIER.ColliderDesc.ball(s.r).setTranslation(s.x, s.r * 0.8, s.z), b);
    }
    this.controller = this.world.createCharacterController(0.02);
    this.controller.enableAutostep(0.55, 0.25, true);
    this.controller.enableSnapToGround(0.55);
    this.controller.setMaxSlopeClimbAngle(52 * Math.PI / 180);
    this.controller.setMinSlopeSlideAngle(55 * Math.PI / 180);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.ready = true;
  }

  makeCharacter(x, y, z) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z)
    );
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(0.52, 0.36), body);
    return { body, collider };
  }

  /* desired: THREE-like {x,y,z} translation for this step. Returns actual movement + grounded. */
  moveCharacter(char, desired) {
    this.controller.computeColliderMovement(char.collider, desired);
    const mv = this.controller.computedMovement();
    const grounded = this.controller.computedGrounded();
    const t = char.body.translation();
    char.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
    return { mv, grounded };
  }

  addProp(kind, mesh, x, y, z, opts = {}) {
    let bodyDesc, colDesc;
    if (kind === 'crate') {
      bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.05).setAngularDamping(0.25);
      colDesc = RAPIER.ColliderDesc.cuboid(0.55, 0.55, 0.55).setDensity(0.7).setFriction(0.75);
    } else if (kind === 'ball') {
      bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.01).setAngularDamping(0.4).setCcdEnabled(true);
      colDesc = RAPIER.ColliderDesc.ball(0.62).setDensity(0.5).setRestitution(0.55).setFriction(0.45);
    } else if (kind === 'bomb') {
      bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.02).setAngularDamping(0.4).setCcdEnabled(true);
      colDesc = RAPIER.ColliderDesc.ball(0.55).setDensity(1.4).setRestitution(0.3).setFriction(0.5);
    } else if (kind === 'barrel') {
      bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.05).setAngularDamping(0.3);
      colDesc = RAPIER.ColliderDesc.cylinder(0.75, 0.48).setDensity(0.6).setFriction(0.6);
    } else if (kind === 'domino') {
      bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.01).setAngularDamping(0.05);
      if (opts.quat) bodyDesc.setRotation(opts.quat);
      colDesc = RAPIER.ColliderDesc.cuboid(0.35, 0.675, 0.13).setDensity(0.9).setFriction(0.45);
    } else if (kind === 'wreckball') {
      /* heavy pendulum ball — density way up so it bulldozes props */
      bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.01).setAngularDamping(0.05).setCcdEnabled(true);
      colDesc = RAPIER.ColliderDesc.ball(0.55).setDensity(6).setFriction(0.4).setRestitution(0.1);
    } else if (kind === 'shard') {
      /* debris from a shattered crate (Chaos-destruction stand-in) */
      bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.02).setAngularDamping(0.1);
      colDesc = RAPIER.ColliderDesc.cuboid(0.19, 0.19, 0.19).setDensity(0.5).setFriction(0.5);
    } else if (kind === 'bigball') {
      bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.01).setAngularDamping(0.25).setCcdEnabled(true);
      colDesc = RAPIER.ColliderDesc.ball(1.35).setDensity(0.3).setRestitution(0.62).setFriction(0.4);
    } else { // plank ramp: fixed architecture; caller supplies the exact quaternion (yaw+tilt) used by the mesh
      bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
      if (opts.quat) bodyDesc.setRotation(opts.quat);
      colDesc = RAPIER.ColliderDesc.cuboid(1.6, 0.14, 3.4).setFriction(0.9);
    }
    const body = this.world.createRigidBody(bodyDesc);
    this.world.createCollider(colDesc, body);
    const t = body.translation(), r = body.rotation();
    const prop = {
      kind, mesh, body, fixed: kind === 'plank', spawnQuat: opts.quat || null,
      // render-interpolation snapshots (plain objects, preallocated — no per-step garbage)
      prevP: { x: t.x, y: t.y, z: t.z }, curP: { x: t.x, y: t.y, z: t.z },
      prevQ: { x: r.x, y: r.y, z: r.z, w: r.w }, curQ: { x: r.x, y: r.y, z: r.z, w: r.w },
      _prevY: y,
    };
    this.props.push(prop);
    return prop;
  }

  /* the character is a kinematic body driven by the controller — track it so
     the visual model interpolates exactly like the dynamic props */
  trackCharacter(body) {
    this.charBody = body;
    const t = body.translation();
    this.charPrevP = { x: t.x, y: t.y, z: t.z };
    this.charCurP = { x: t.x, y: t.y, z: t.z };
  }

  beginFrame() { this._hadSteps = false; }

  _capturePrev() {
    for (const p of this.props) {
      if (p.fixed) continue;
      const t = p.body.translation(), r = p.body.rotation();
      p.prevP.x = t.x; p.prevP.y = t.y; p.prevP.z = t.z;
      p.prevQ.x = r.x; p.prevQ.y = r.y; p.prevQ.z = r.z; p.prevQ.w = r.w;
    }
    if (this.charBody) {
      const t = this.charBody.translation();
      this.charPrevP.x = t.x; this.charPrevP.y = t.y; this.charPrevP.z = t.z;
    }
  }

  _captureCur() {
    for (const p of this.props) {
      if (p.fixed) continue;
      const t = p.body.translation(), r = p.body.rotation();
      p.curP.x = t.x; p.curP.y = t.y; p.curP.z = t.z;
      p.curQ.x = r.x; p.curQ.y = r.y; p.curQ.z = r.z; p.curQ.w = r.w;
    }
    if (this.charBody) {
      const t = this.charBody.translation();
      this.charCurP.x = t.x; this.charCurP.y = t.y; this.charCurP.z = t.z;
    }
  }

  /* interpolated character position for this render frame; out = {x,y,z} */
  charPos(alpha, out) {
    if (!this.charBody || !this._hadSteps) {
      const t = this.charBody ? this.charBody.translation() : { x: 0, y: 0, z: 0 };
      out.x = t.x; out.y = t.y; out.z = t.z;
      return out;
    }
    return lerp3(this.charPrevP, this.charCurP, alpha, out);
  }

  /* pin a prop to a fixed pivot with a spherical joint — a pendulum.
     The prop-local anchor sits `len` above its centre, so the centre
     hangs `len` below the pivot and swings freely. */
  addPendulum(prop, px, py, pz, len) {
    const anchor = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, pz));
    const data = RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: len, z: 0 });
    prop.joint = this.world.createImpulseJoint(data, anchor, prop.body, true);
    prop.anchorBody = anchor;
  }

  removeProp(prop) {
    if (prop.joint) { this.world.removeImpulseJoint(prop.joint); prop.joint = null; }
    if (prop.anchorBody) { this.world.removeRigidBody(prop.anchorBody); prop.anchorBody = null; }
    this.world.removeRigidBody(prop.body);
    this.props.splice(this.props.indexOf(prop), 1);
  }

  step(dt) {
    if (!this.ready) return;
    if (this.preStep) this.preStep(dt);
    this._capturePrev(); // sim state before this substep
    this.world.timestep = dt;
    this.world.step();
    this._captureCur();   // sim state after this substep
    this._detectSplash();
    this._hadSteps = true;
  }

  /* a prop punched through the water plane this step → splash callback */
  _detectSplash() {
    if (!this.onSplash) return;
    for (const p of this.props) {
      if (p.fixed) continue;
      const t = p.body.translation();
      if (p._prevY !== undefined && p._prevY > 0.3 && t.y <= 0.3) {
        const vy = p.body.linvel().y;
        if (vy < -1.5) this.onSplash(t.x, t.z, -vy);
      }
      p._prevY = t.y;
    }
  }

  /* called from the render phase: mesh transforms are the interpolation of
     the last two sim states (alpha = acc/step). When no substep ran this
     frame the latest sim state is drawn as-is (no backtracking). */
  syncProps(alpha) {
    const tmpQ = this._tmpQ || (this._tmpQ = { x: 0, y: 0, z: 0, w: 1 });
    for (const p of this.props) {
      if (p.fixed) continue;
      if (this._hadSteps) {
        p.mesh.position.set(
          p.prevP.x + (p.curP.x - p.prevP.x) * alpha,
          p.prevP.y + (p.curP.y - p.prevP.y) * alpha,
          p.prevP.z + (p.curP.z - p.prevP.z) * alpha);
        nlerpQ(p.prevQ, p.curQ, alpha, tmpQ);
        p.mesh.quaternion.set(tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w);
      } else {
        p.mesh.position.set(p.curP.x, p.curP.y, p.curP.z);
        p.mesh.quaternion.set(p.curQ.x, p.curQ.y, p.curQ.z, p.curQ.w);
      }
    }
  }

  get bodyCount() { return this.world ? this.world.bodies.len() : 0; }
}
