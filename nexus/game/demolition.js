/* Demolition Day — Nexus's first game: timed physics challenges built
   from the sandbox's proven toys. A challenge builds its scene in front
   of the player, polls an objective on the render loop, and scores
   count × 100 − seconds × 5 (+250 clear bonus), 1–3 stars, best score
   per challenge to the arcade board (game ids dd-tower / dd-dominoes /
   dd-blast via window.Arcade). */
import * as THREE from 'three';
import { heightAt } from '../world/environment.js';

const CRATE = 1.1;
const TIME_CAP = 180;

function angleBetween(q0, q1) {
  const dot = Math.abs(q0.x * q1.x + q0.y * q1.y + q0.z * q1.z + q0.w * q1.w);
  return 2 * Math.acos(Math.min(1, dot));
}

export const CHALLENGES = [
  { id: 'tower', icon: '🏗', name: 'Tower Topple', board: 'dd-tower',
    blurb: 'A 10-crate pyramid. Call in the wrecking ball and bring it all down.', tool: 'wrecking', toolLabel: '🏗 Wrecking Ball', tools: 1 },
  { id: 'dominoes', icon: '🁢', name: 'Domino Day', board: 'dd-dominoes',
    blurb: 'The 14-piece rainbow run. One push — or spend your one bomb.', tool: 'bomb', toolLabel: '💣 Bomb (optional)', tools: 1 },
  { id: 'blast', icon: '💥', name: 'Blast Off', board: 'dd-blast',
    blurb: '6 barrels on a crate deck. Two bombs. Get every barrel off the deck.', tool: 'bomb', toolLabel: '💣 Drop Bomb', tools: 2 },
];

export class Demolition {
  constructor(scene, physics, character, sandbox, ui) {
    this.scene = scene; this.physics = physics; this.character = character;
    this.sandbox = sandbox; this.ui = ui; // ui: { toast, onRun(state) }
    this.state = 'idle'; // idle | running | done
    this.def = null;
    this.tracked = [];   // { prop, y0, q0, role }
    this.elapsed = 0;
    this.toolsLeft = 0;
    this.bombsUsed = 0;
    this.result = null;
    try { this.stars = JSON.parse(localStorage.getItem('dd_stars') || '{}'); } catch (e) { this.stars = {}; }
  }

  _front(dist) {
    const p = this.character.pos, yaw = this.character.faceYaw;
    return { x: p.x + Math.sin(yaw) * dist, z: p.z + Math.cos(yaw) * dist, yaw };
  }

  _track(prop, role) {
    const t = prop.body.translation();
    this.tracked.push({ prop, role, y0: t.y, q0: prop.mesh.quaternion.clone() });
  }

  _crate(x, y, z, role) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(CRATE, CRATE, CRATE),
      new THREE.MeshStandardMaterial({ map: this.sandbox.wood, roughness: 0.9 }));
    m.castShadow = m.receiveShadow = true;
    m.position.set(x, y, z);
    this.scene.add(m);
    const prop = this.physics.addProp('crate', m, x, y, z);
    this._track(prop, role);
    return prop;
  }

  start(id) {
    const def = CHALLENGES.find(c => c.id === id);
    if (!def) return;
    this.cleanup();
    this.def = def;
    this.elapsed = 0;
    this.bombsUsed = 0;
    this.toolsLeft = def.tools;
    this.result = null;
    if (id === 'tower') this._buildTower();
    else if (id === 'dominoes') this._buildDominoes();
    else if (id === 'blast') this._buildBlast();
    this.state = 'running';
    this.ui.toast(def.icon + ' ' + def.name + ' — go!');
    this.ui.onRun(this);
  }

  /* find the flattest build spot in front of the player (the domino
     lesson: a sloped build site fails challenges all by itself). Tries
     rotations around the player at the given radius, scores each by the
     height spread across the footprint, keeps the flattest. */
  _flatSpot(dist, halfW) {
    const p = this.character.pos, baseYaw = this.character.faceYaw;
    let best = null;
    for (const da of [0, -0.45, 0.45, -0.9, 0.9, -1.35, 1.35]) {
      const yaw = baseYaw + da;
      const x = p.x + Math.sin(yaw) * dist, z = p.z + Math.cos(yaw) * dist;
      const perpX = Math.cos(yaw), perpZ = -Math.sin(yaw);
      const samples = [-halfW, -halfW / 2, 0, halfW / 2, halfW].map(off => heightAt(x + perpX * off, z + perpZ * off));
      samples.push(heightAt(x + Math.sin(yaw) * halfW, z + Math.cos(yaw) * halfW), heightAt(x - Math.sin(yaw) * halfW, z - Math.cos(yaw) * halfW));
      const spread = Math.max(...samples) - Math.min(...samples);
      if (!best || spread < best.spread) best = { x, z, yaw, spread, gy: Math.min(...samples) };
      if (spread < 0.15) break;
    }
    return best;
  }

  _buildTower() {
    const c = this._flatSpot(6.5, 2.3);
    const gy = heightAt(c.x, c.z);
    const perpX = Math.cos(c.yaw), perpZ = -Math.sin(c.yaw);
    const rows = [4, 3, 2, 1];
    rows.forEach((n, layer) => {
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * (CRATE + 0.03);
        this._crate(c.x + perpX * off, gy + CRATE / 2 + layer * CRATE, c.z + perpZ * off, 'target');
      }
    });
  }

  _buildDominoes() {
    const before = new Set(this.physics.props);
    this.sandbox.spawn('dominoes');
    for (const p of this.physics.props) {
      if (before.has(p) || p.kind !== 'domino') continue;
      const s = p.spawnQuat;
      this.tracked.push({ prop: p, role: 'target', y0: p.body.translation().y,
        q0: s ? new THREE.Quaternion(s.x, s.y, s.z, s.w) : p.mesh.quaternion.clone() });
    }
  }

  _buildBlast() {
    const c = this._flatSpot(6.5, 2.3);
    const perpX = Math.cos(c.yaw), perpZ = -Math.sin(c.yaw);
    const dirX = Math.sin(c.yaw), dirZ = Math.cos(c.yaw);
    // three 2-high leg columns (a column under EVERY deck crate — v1/v2
    // had legs only at the ends and the middle deck crate fell through),
    // each grounded on its own terrain height
    let deckBase = -Infinity;
    for (const side of [-1.5, 0, 1.5]) {
      const lx = c.x + perpX * side, lz = c.z + perpZ * side;
      const lgy = heightAt(lx, lz);
      for (let h = 0; h < 2; h++)
        this._crate(lx, lgy + CRATE / 2 + h * CRATE, lz, 'scenery');
      deckBase = Math.max(deckBase, lgy + CRATE * 2);
    }
    // deck: 3 (perp) × 2 (dir) crates — two deep, so the barrel rows at
    // ±0.475 in the dir axis sit fully ON the deck (the v1 bug: a 1-deep
    // deck left half of every barrel hanging off the edge)
    for (const off of [-1.12, 0, 1.12]) for (const d of [-0.56, 0.56])
      this._crate(c.x + perpX * off + dirX * d, deckBase + CRATE / 2, c.z + perpZ * off + dirZ * d, 'scenery');
    const deckTop = deckBase + CRATE;
    this.deck = { x: c.x, z: c.z, top: deckTop };
    // 6 barrels in two rows of three on the deck
    for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) {
      const off = (i - 1) * 1.05, back = (r - 0.5) * 0.95;
      const x = c.x + perpX * off + dirX * back, z = c.z + perpZ * off + dirZ * back;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 1.5, 20),
        new THREE.MeshStandardMaterial({ color: 0x3f6fb5, roughness: 0.45, metalness: 0.55 }));
      m.castShadow = m.receiveShadow = true;
      m.position.set(x, deckTop + 0.75, z);
      this.scene.add(m);
      const prop = this.physics.addProp('barrel', m, x, deckTop + 0.75, z);
      this._track(prop, 'target');
    }
  }

  useTool() {
    if (this.state !== 'running' || this.toolsLeft <= 0) return;
    this.toolsLeft--;
    if (this.def.tool === 'wrecking') this.sandbox.spawn('wrecking');
    else { this.sandbox.spawn('bomb'); this.bombsUsed++; }
    this.ui.onRun(this);
  }

  _isDown(t) {
    const p = t.prop;
    const tr = p.body.translation();
    if (this.def.id === 'blast') {
      return tr.y < this.deck.top - 1.2 || Math.hypot(tr.x - this.deck.x, tr.z - this.deck.z) > 2.8;
    }
    const ang = angleBetween(t.q0, p.mesh.quaternion);
    if (this.def.id === 'dominoes') return ang > 0.8;
    return ang > 0.65 || tr.y < t.y0 - 0.55;
  }

  count() {
    let n = 0;
    for (const t of this.tracked) if (t.role === 'target' && this._isDown(t)) n++;
    return n;
  }
  total() { return this.tracked.filter(t => t.role === 'target').length; }

  update(dt) {
    if (this.state !== 'running') return;
    this.elapsed += dt;
    if (this.count() >= this.total() && this.total() > 0) this.finish('cleared');
    else if (this.elapsed >= TIME_CAP) this.finish('time');
  }

  finish(reason) {
    if (this.state !== 'running') return;
    this.state = 'done';
    const count = this.count(), total = this.total();
    const secs = Math.floor(this.elapsed);
    const points = Math.max(0, count * 100 - secs * 5) + (count >= total && total > 0 ? 250 : 0);
    let stars = 0;
    if (this.def.id === 'tower') stars = count >= 10 ? (secs <= 25 ? 3 : 2) : count >= 6 ? 1 : 0;
    if (this.def.id === 'dominoes') stars = count >= 14 ? 3 : count >= 11 ? 2 : count >= 7 ? 1 : 0;
    if (this.def.id === 'blast') stars = count >= 6 ? (this.bombsUsed <= 1 ? 3 : 2) : count >= 4 ? 1 : 0;
    const prev = this.stars[this.def.id] || 0;
    if (stars > prev) {
      this.stars[this.def.id] = stars;
      try { localStorage.setItem('dd_stars', JSON.stringify(this.stars)); } catch (e) {}
    }
    this.result = { id: this.def.id, name: this.def.name, icon: this.def.icon, reason, count, total, secs, points, stars };
    let name = 'Player1';
    try { name = localStorage.getItem('arcade_name') || 'Player1'; } catch (e) {}
    if (window.Arcade && window.Arcade.saveScore) window.Arcade.saveScore(this.def.board, name, points);
    this.ui.onRun(this);
  }

  quit() {
    this.state = 'idle';
    this.def = null;
    this.result = null;
    this.cleanup();
    this.ui.onRun(this);
  }

  cleanup() {
    this.sandbox.clearProps();
    this.tracked = [];
  }
}
