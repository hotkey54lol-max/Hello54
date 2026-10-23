/* RED LIGHT, GREEN LEGS — simulation core v2 (pure JS, no DOM).
   Runs identically in the browser (watch mode + headless training bursts)
   and in Node (learning tests). The Babylon view only reads state.

   PHYSICS-FIRST DESIGN (Joslyn's v2 brief): each spider is a real body
   held up by its eight legs. The brain (small MLP, (1+1) evolution
   strategies) outputs per-leg gait phases plus stride/lift/frequency/
   throttle/steer/brake/crouch. Planted feet create support: enough
   support under the body's centre and it stands and walks; bad gaits
   sag, tip, face-plant and drag — the ragdoll flailing IS the learning,
   nothing is scripted. Race rule: first spider to the finish wins the
   round; the round ends at the first finish (or the clock). */
(function (global) {
'use strict';

/* ---------------- utils ---------------- */
function RNG(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng) { // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const tanh = Math.tanh;

/* ---------------- constants ---------------- */
const TRACK_LEN = 120;          // metres, start line z=0 -> finish z=120
const ROUND_TIME = 120;         // 2-minute rounds (or first finish); timeout = everyone loses
const DT = 1 / 30;              // sim tick
const WALL_X = 20;              // hall half-width for agents (hall is 44 wide)
const RED_GRACE = 0.25;         // seconds after red before movement counts
const RED_SPEED = 0.4;          // m/s — moving faster than this on red = sent back
const BODY_H = 0.85;            // standing body centre height
const IN = 12, HID = 20, OUT = 15;
const NW = HID * IN + HID + OUT * HID + OUT; // 575 weights

/* ---------------- brain ---------------- */
function randomBrain(rng) {
  const w = new Float32Array(NW);
  for (let i = 0; i < NW; i++) w[i] = gauss(rng) * 0.55;
  return w;
}
function mutateBrain(src, rng, sigma) {
  const w = new Float32Array(src);
  // one mutation in four is a "kick" — a bigger jolt that escapes local optima
  const s = rng() < 0.25 ? sigma * 1.8 : sigma;
  for (let i = 0; i < NW; i++) {
    if (rng() < 0.65) w[i] += gauss(rng) * s;
  }
  return w;
}
function brainForward(w, inp, out) {
  const h = brainForward._h || (brainForward._h = new Float32Array(HID));
  for (let j = 0; j < HID; j++) {
    let s = w[HID * IN + j]; // b1
    const base = j * IN;
    for (let i = 0; i < IN; i++) s += w[base + i] * inp[i];
    h[j] = tanh(s);
  }
  const p = HID * IN + HID;
  for (let o = 0; o < OUT; o++) {
    let s = w[p + OUT * HID + o]; // b2
    const base = p + o * HID;
    for (let j = 0; j < HID; j++) s += w[base + j] * h[j];
    out[o] = tanh(s);
  }
  return out;
}

/* ---------------- agents ---------------- */
const CAST = [
  { name: '#1 Oliver', color: [0.91, 0.27, 0.27], lane: -6.75 },
  { name: '#2 Aria',   color: [0.96, 0.72, 0.30], lane: -2.25 },
  { name: '#3 Sophia', color: [0.35, 0.80, 0.45], lane:  2.25 },
  { name: '#4 Albert', color: [0.35, 0.55, 0.98], lane:  6.75 },
];
// leg layout: leg = posIdx*2 + side; posIdx 0..3 front->rear, side 0=left 1=right
const LEG_HIP_Z = [0.78, 0.27, -0.27, -0.78];
const LEG_HIP_X = 0.55;
const DUTY = 0.62; // fraction of the cycle a foot spends in stance

function makeAgent(def, rng) {
  const best = randomBrain(rng);
  return {
    name: def.name, color: def.color, lane: def.lane,
    bestBrain: best, bestScore: -1e9,
    stats: { rounds: 0, finishes: 0, wins: 0, violations: 0, falls: 0, reboots: 0, bestDist: 0, bestTime: 0, distHistory: [] },
    rt: null,
  };
}
function resetRuntime(a) {
  a.rt = {
    x: a.lane, z: 0, y: BODY_H, vx: 0, vz: 0, heading: 0,
    pitch: 0, roll: 0, pitchV: 0, rollV: 0,
    phase: 0, speed: 0, score: 0, distMax: 0,
    finished: false, finishTime: 0, stun: 0, sentBacks: 0,
    fallen: false, falls: 0, support: 0, contacts: 0, upTime: 0,
    throttle: 0, brake: 0, freq: 0,
    feet: new Float32Array(8 * 3), // world xyz per leg (foot)
    hips: new Float32Array(8 * 3),
    knees: new Float32Array(8 * 3),
    lastEvent: null, // 'sentback' | 'finish' | 'fall' | 'recover'
  };
}

/* ---------------- simulation ---------------- */
function makeSim(seed) {
  const rng = RNG(seed || 1337);
  const sim = {
    rng,
    agents: CAST.map(d => makeAgent(d, rng)),
    round: 0,
    light: { state: 'green', t: 0, dur: 3.5 },
    time: 0,
    firstFinishAt: 0,
    events: [], // per-tick view events: {type, agent, t}
  };
  sim.agents.forEach(resetRuntime);
  return sim;
}

function nextLight(sim) {
  const L = sim.light;
  if (L.state === 'green') { L.state = 'red'; L.dur = 1.5 + sim.rng() * 2.5; }
  else { L.state = 'green'; L.dur = 2 + sim.rng() * 3; }
  L.t = 0;
}

/* rotate a body-frame vector by (heading yaw, pitch, roll), Babylon YXZ order */
function rotApply(heading, pitch, roll, x, y, z, out) {
  // Rz (roll)
  let c = Math.cos(roll), s = Math.sin(roll);
  let x1 = x * c - y * s, y1 = x * s + y * c, z1 = z;
  // Rx (pitch)
  c = Math.cos(pitch); s = Math.sin(pitch);
  let x2 = x1, y2 = y1 * c - z1 * s, z2 = y1 * s + z1 * c;
  // Ry (heading)
  c = Math.cos(heading); s = Math.sin(heading);
  out.x = x2 * c + z2 * s;
  out.y = y2;
  out.z = -x2 * s + z2 * c;
  return out;
}
const _v = { x: 0, y: 0, z: 0 };
const _inp = new Float32Array(IN);
const _out = new Float32Array(OUT);

function stepAgent(sim, a, dt) {
  const rt = a.rt;
  if (rt.finished) { rt.speed = 0; return; }
  const L = sim.light;

  _inp[0] = L.state === 'green' ? 1 : -1;
  _inp[1] = clamp(L.t / 5, 0, 1);
  _inp[2] = clamp(rt.speed / 4, 0, 1);
  _inp[3] = clamp((TRACK_LEN - rt.z) / TRACK_LEN, 0, 1);
  _inp[4] = Math.sin(rt.phase);
  _inp[5] = Math.cos(rt.phase);
  _inp[6] = clamp(rt.pitch * 1.6, -1, 1);
  _inp[7] = clamp(rt.roll * 1.6, -1, 1);
  _inp[8] = clamp((rt.y / BODY_H - 0.5) * 2, -1, 1);
  _inp[9] = rt.fallen ? 1 : -1;
  _inp[10] = rt.stun > 0 ? 1 : 0;
  _inp[11] = Math.sin(rt.heading);
  brainForward(a._candidate || a.bestBrain, _inp, _out);

  const u = i => (_out[i] + 1) / 2;
  const stride = 0.15 + 1.0 * u(8);        // metres of foot travel per cycle
  const lift = 0.04 + 0.50 * u(9);         // swing foot clearance
  const freq = 0.3 + 2.7 * u(10);          // gait cycles per second
  let throttle = u(11);
  const steer = _out[12];
  const brake = u(13);
  const crouch = -0.2 + 0.5 * u(14);       // body height offset
  if (rt.stun > 0) { throttle = 0; rt.stun -= dt; }
  rt.throttle = throttle; rt.brake = brake; rt.freq = freq;

  const braking = brake > 0.65;
  const throttleEff = braking ? 0 : throttle * (1 - brake * 0.5);
  if (!braking) rt.phase += 2 * Math.PI * freq * dt * (0.15 + 0.85 * throttle);

  /* ---- legs: gait -> body-frame feet, then world feet via body rotation ---- */
  let contacts = 0, cx = 0, cz = 0, gripL = 0, gripR = 0;
  const planted = [];
  for (let leg = 0; leg < 8; leg++) {
    const side = leg % 2, posIdx = (leg / 2) | 0;
    const hipLX = (side === 0 ? -LEG_HIP_X : LEG_HIP_X);
    const hipLZ = LEG_HIP_Z[posIdx];
    const cyc = ((rt.phase + _out[leg] * Math.PI) / (2 * Math.PI)) % 1;
    const cu = cyc < 0 ? cyc + 1 : cyc;
    let footZ, footLift;
    const stancePhase = cu < DUTY;
    if (stancePhase) { footZ = stride * (0.5 - cu / DUTY); footLift = 0; }
    else { const w = (cu - DUTY) / (1 - DUTY); footZ = stride * (-0.5 + w); footLift = lift * Math.sin(Math.PI * w); }
    const footLX = hipLX + (side === 0 ? -0.38 : 0.38);
    const footLZ = hipLZ + footZ;
    const footLY = -rt.y + footLift;
    // world hip + foot (uses current body pose)
    rotApply(rt.heading, rt.pitch, rt.roll, hipLX, -0.08, hipLZ, _v);
    const hx = rt.x + _v.x, hy = rt.y + _v.y, hz = rt.z + _v.z;
    rotApply(rt.heading, rt.pitch, rt.roll, footLX, footLY, footLZ, _v);
    const fx = rt.x + _v.x, fy = rt.y + _v.y, fz = rt.z + _v.z;
    rt.hips[leg * 3] = hx; rt.hips[leg * 3 + 1] = hy; rt.hips[leg * 3 + 2] = hz;
    rt.feet[leg * 3] = fx; rt.feet[leg * 3 + 1] = Math.max(0, fy); rt.feet[leg * 3 + 2] = fz;
    rotApply(rt.heading, rt.pitch, rt.roll, (hipLX + footLX) / 2 + (side === 0 ? -0.30 : 0.30), (footLY - 0.08) / 2 + 0.26, (hipLZ + footLZ) / 2, _v);
    rt.knees[leg * 3] = rt.x + _v.x; rt.knees[leg * 3 + 1] = rt.y + _v.y; rt.knees[leg * 3 + 2] = rt.z + _v.z;
    if (stancePhase && fy <= 0.06) {
      contacts++; planted.push(leg);
      cx += footLX; cz += footLZ;
      if (side === 0) gripL++; else gripR++;
    }
  }
  if (contacts) { cx /= contacts; cz /= contacts; }
  gripL /= 4; gripR /= 4;
  rt.contacts = contacts;

  /* ---- support: how well the planted feet hold the body up ---- */
  const supportBase = clamp(contacts / 3.0, 0, 1);
  const centroidPenalty = contacts ? clamp(1 - (Math.abs(cx) + Math.abs(cz)) * 0.42, 0.2, 1) : 0;
  const support = supportBase * centroidPenalty;
  rt.support = support;

  // body height: springs toward standing when supported, sags to the floor when not
  const targetY = 0.30 + (BODY_H + crouch - 0.30) * support;
  const yRate = support > 0.45 ? 5.5 : 2.0;
  rt.y += (targetY - rt.y) * Math.min(1, dt * yRate);
  if (rt.y < 0.28) rt.y = 0.28;

  // tip dynamics: support centroid offset torques the body; planted feet stabilise it
  const tipK = 3.6 * (1.15 - support);
  const stiff = 3.5 + support * 8, damp = 1.0 + support * 3;
  rt.pitchV += (cz * tipK - rt.pitch * stiff - rt.pitchV * damp) * dt;
  rt.rollV += (cx * tipK - rt.roll * stiff - rt.rollV * damp) * dt;
  rt.pitch = clamp(rt.pitch + rt.pitchV * dt, -1.35, 1.35);
  rt.roll = clamp(rt.roll + rt.rollV * dt, -1.35, 1.35);

  const wasFallen = rt.fallen;
  rt.fallen = rt.y < 0.52 || Math.abs(rt.pitch) > 0.8 || Math.abs(rt.roll) > 0.8;
  if (rt.fallen && !wasFallen) {
    rt.falls++; a.stats.falls++;
    rt.score -= 0.8;
    rt.lastEvent = 'fall';
    sim.events.push({ type: 'fall', agent: a.name, t: sim.time });
  } else if (!rt.fallen && wasFallen) {
    rt.lastEvent = 'recover';
    sim.events.push({ type: 'recover', agent: a.name, t: sim.time });
  }
  if (!rt.fallen) rt.upTime += dt;

  /* ---- propulsion: planted feet drag the body toward the gait velocity ---- */
  const gaitSpeed = stride * freq / DUTY;
  const grip = clamp(contacts / 4, 0, 1) * (rt.fallen ? 0.06 : 1);
  const desVx = Math.sin(rt.heading) * gaitSpeed * throttleEff;
  const desVz = Math.cos(rt.heading) * gaitSpeed * throttleEff;
  const blend = Math.min(1, dt * (1.0 + grip * 5.5));
  rt.vx += (desVx - rt.vx) * blend;
  rt.vz += (desVz - rt.vz) * blend;
  if (braking) { const d = Math.max(0, 1 - 10 * dt); rt.vx *= d; rt.vz *= d; }
  if (rt.fallen) { const d = Math.max(0, 1 - 2.5 * dt); rt.vx *= d; rt.vz *= d; }

  // heading: brain steering + yaw from lopsided grip (asymmetric gaits circle — honestly)
  const yawRate = steer * (0.35 + 0.75 * throttle) * (rt.fallen ? 0.3 : 1)
    + (gripL - gripR) * 0.45 * clamp(rt.speed, 0, 1.5);
  rt.heading += yawRate * dt;

  // integrate
  const prevZ = rt.z;
  rt.x += rt.vx * dt;
  rt.z += rt.vz * dt;
  if (rt.x < -WALL_X) { rt.x = -WALL_X; rt.vx = 0; }
  if (rt.x > WALL_X) { rt.x = WALL_X; rt.vx = 0; }
  if (rt.z < 0) { rt.z = 0; rt.vz = Math.max(0, rt.vz); }
  rt.speed = Math.hypot(rt.vx, rt.vz);

  // rewards: forward progress, a clear wage for staying upright, green-idle tick
  const dz = rt.z - prevZ;
  if (dz > 0) rt.score += dz;
  if (!rt.fallen) rt.score += (rt.y / BODY_H) * 0.5 * dt;
  if (L.state === 'green' && rt.speed < 0.3) rt.score -= 0.30 * dt;
  if (rt.z > rt.distMax) rt.distMax = rt.z;

  // red-light violation -> sent back to the start line
  if (L.state === 'red' && L.t > RED_GRACE && rt.speed > RED_SPEED) {
    rt.z = 0; rt.x = a.lane; rt.heading = 0; rt.vx = 0; rt.vz = 0; rt.speed = 0; rt.stun = 0.6;
    rt.sentBacks++; a.stats.violations++;
    rt.score -= 15;
    rt.lastEvent = 'sentback';
    sim.events.push({ type: 'sentback', agent: a.name, t: sim.time });
  }

  // finish
  if (rt.z >= TRACK_LEN) {
    rt.z = TRACK_LEN; rt.finished = true; rt.finishTime = sim.time;
    rt.score += 150 + (ROUND_TIME - sim.time) * 2;
    rt.lastEvent = 'finish';
    if (!sim.firstFinishAt) sim.firstFinishAt = sim.time;
    sim.events.push({ type: 'finish', agent: a.name, t: sim.time });
  }
}

function stepSim(sim, dt) {
  sim.time += dt;
  sim.light.t += dt;
  if (sim.light.t >= sim.light.dur) nextLight(sim);
  sim.events.length = 0;
  for (const a of sim.agents) stepAgent(sim, a, dt);
}

function raceWinner(sim) {
  let win = null;
  for (const a of sim.agents) {
    if (a.rt.finished && (!win || a.rt.finishTime < win.rt.finishTime)) win = a;
  }
  return win;
}

function settleRound(sim, results) {
  const win = raceWinner(sim);
  for (const a of sim.agents) {
    const rt = a.rt;
    const res = {
      name: a.name, score: rt.score, dist: rt.distMax,
      finished: rt.finished, time: rt.finishTime, sentBacks: rt.sentBacks, falls: rt.falls,
    };
    results.push(res);
    res.adopted = false;
    if (a._candidate) {
      a.bestScore *= 0.998;
      if (rt.score > a.bestScore) { a.bestBrain = a._candidate; a.bestScore = rt.score; res.adopted = true; }
      a._candidate = null;
    }
    // flatliner rescue: a brain that still can't move after 150 rounds gets a
    // factory reset (fresh random brain) — characters that crawl stay, only
    // the truly hopeless get rebooted, and the view announces it
    a._flat = (a._flat || 0) + 1;
    res.rebooted = false;
    if (a._flat >= 150 && a.stats.bestDist < 6) {
      a.bestBrain = randomBrain(sim.rng);
      a.bestScore = -1e9;
      a.stats.reboots++;
      a._flat = 0;
      res.rebooted = true;
    }
    if (rt.distMax > a.stats.bestDist) a.stats.bestDist = rt.distMax;
    if (rt.finished) {
      a.stats.finishes++;
      if (!a.stats.bestTime || rt.finishTime < a.stats.bestTime) a.stats.bestTime = rt.finishTime;
    }
    a.stats.distHistory.push(Math.round(rt.distMax * 10) / 10);
    if (a.stats.distHistory.length > 120) a.stats.distHistory.shift();
  }
  if (win) win.stats.wins++;
  return { round: sim.round, results, winner: win ? win.name : null };
}

/* Run one full round headlessly: fresh mutants, race to first finish or the clock. */
function runRound(sim) {
  sim.round++;
  sim.time = 0;
  sim.firstFinishAt = 0;
  sim.light = { state: 'green', t: 0, dur: 3 + sim.rng() * 2 };
  for (const a of sim.agents) {
    resetRuntime(a);
    // strugglers mutate harder — exploration where the gradient is flat
    const sig = (a.stats.bestDist < 6 && (a._flat || 0) > 40) ? 0.44 : 0.22;
    a._candidate = mutateBrain(a.bestBrain, sim.rng, sig);
    a.stats.rounds++;
  }
  let steps = Math.round(ROUND_TIME / DT);
  while (steps-- > 0) {
    stepSim(sim, DT);
    if (sim.firstFinishAt) break;
  }
  return settleRound(sim, []);
}

/* For watch mode the view drives stepSim itself; this prepares a round
   exactly like runRound but leaves stepping to the caller. Watch uses a
   gentle mutation (sigma 0.10) so spiders keep learning while spectated
   without wrecking their best moves. */
function beginRound(sim, mutate, sigma) {
  sim.round++;
  sim.time = 0;
  sim.firstFinishAt = 0;
  sim.light = { state: 'green', t: 0, dur: 3 + sim.rng() * 2 };
  for (const a of sim.agents) {
    resetRuntime(a);
    const base = sigma || 0.22;
    const sig = (a.stats.bestDist < 6 && (a._flat || 0) > 40) ? base * 2 : base;
    a._candidate = mutate ? mutateBrain(a.bestBrain, sim.rng, sig) : null;
    a.stats.rounds++;
  }
}
function endRound(sim) {
  return settleRound(sim, []);
}

/* ---------------- persistence ---------------- */
function serialize(sim) {
  return {
    v: 2,
    agents: sim.agents.map(a => ({
      best: Array.from(a.bestBrain),
      bestScore: a.bestScore,
      stats: a.stats,
    })),
  };
}
function deserialize(sim, data) {
  if (!data || data.v !== 2 || !Array.isArray(data.agents)) return false;
  data.agents.forEach((saved, i) => {
    const a = sim.agents[i];
    if (!a || !saved || !Array.isArray(saved.best) || saved.best.length !== NW) return;
    a.bestBrain = Float32Array.from(saved.best);
    a.bestScore = saved.bestScore || 0;
    Object.assign(a.stats, saved.stats || {});
  });
  return true;
}

const API = {
  RNG, CAST, TRACK_LEN, ROUND_TIME, DT, NW,
  makeSim, runRound, beginRound, endRound, stepSim,
  serialize, deserialize,
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
global.RLGL = API;
})(typeof window !== 'undefined' ? window : globalThis);
