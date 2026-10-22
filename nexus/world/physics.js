/* Project Nexus — physics on Rapier (WASM rigid bodies).
   Runs on the main thread for this build (sandbox scale is small);
   the module boundary keeps a worker move possible later. */
import RAPIER from 'rapier';

export class Physics {
  constructor() { this.ready = false; this.props = []; this.preStep = null; }

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
    } else if (kind === 'barrel') {
      bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setLinearDamping(0.05).setAngularDamping(0.3);
      colDesc = RAPIER.ColliderDesc.cylinder(0.75, 0.48).setDensity(0.6).setFriction(0.6);
    } else { // plank ramp: fixed architecture; caller supplies the exact quaternion (yaw+tilt) used by the mesh
      bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
      if (opts.quat) bodyDesc.setRotation(opts.quat);
      colDesc = RAPIER.ColliderDesc.cuboid(1.6, 0.14, 3.4).setFriction(0.9);
    }
    const body = this.world.createRigidBody(bodyDesc);
    this.world.createCollider(colDesc, body);
    const prop = { kind, mesh, body, fixed: kind === 'plank' };
    this.props.push(prop);
    return prop;
  }

  removeProp(prop) {
    this.world.removeRigidBody(prop.body);
    this.props.splice(this.props.indexOf(prop), 1);
  }

  step(dt) {
    if (!this.ready) return;
    if (this.preStep) this.preStep(dt);
    this.world.timestep = dt;
    this.world.step();
  }

  syncProps() {
    for (const p of this.props) {
      if (p.fixed) continue;
      const t = p.body.translation(), r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  get bodyCount() { return this.world ? this.world.bodies.len() : 0; }
}
