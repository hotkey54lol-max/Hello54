/* RED LIGHT, GREEN LEGS — simulation core (pure JS, no DOM).
   Runs identically in the browser (watch mode + headless training bursts)
   and in Node (learning tests). The Babylon view only reads state.
   Learning: per-agent small MLP brain, (1+1) evolution strategies with a
   slowly-forgetting personal-best score. No instructions, only rewards. */
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
const TRACK_LEN = 100;          // metres, start line z=0 -> finish z=100
const ROUND_TIME = 60;          // seconds per round
const DT = 1 / 30;              // sim tick
const WALL_X = 6.4;             // warehouse half-width for agents
const RED_GRACE = 0.25;         // seconds after red before movement counts
const RED_SPEED = 0.4;          // m/s — moving faster than this on red = sent back
const BODY_H = 0.85;            // body centre height
const IN = 9, HID = 16, OUT = 10;
const NW = HID * IN + HID + OUT * HID + OUT; // 314 weights

/* ---------------- brain ---------------- */
function randomBrain(rng) {
  const w = new Float32Array(NW);
  for (let i = 0; i < NW; i++) w[i] = gauss(rng) * 0.55;
  return w;
}
function mutateBrain(src, rng, sigma) {
  const w = new Float32Array(src);
  for (let i = 0; i < NW; i++) {
    if (rng() < 0.65) w[i] += gauss(rng) * sigma;
  }
  return w;
}
function brainForward(w, inp, out) {
  const h = brainForward._h || (brainForward._h = new Float32Array(HID));
  let p = 0;
  for (let j = 0; j < HID; j++) {
    let s = w[HID * IN + j]; // b1
    const base = j * IN;
    for (let i = 0; i < IN; i++) s += w[base + i] * inp[i];
    h[j] = tanh(s);
  }
  p = HID * IN + HID;
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
  { name: '#1 Oliver', color: [0.91, 0.27, 0.27], lane: -4.5 },
  { name: '#2 Aria',   color: [0.96, 0.72, 0.30], lane: -1.5 },
  { name: '#3 Sophia', color: [0.35, 0.80, 0.45], lane:  1.5 },
  { name: '#4 Albert', color: [0.35, 0.55, 0.98], lane:  4.5 },
];
// leg layout: 4 per side; posIdx 0..3 front->rear, side 0=left 1=right
const LEG_HIP_Z = [0.78, 0.27, -0.27, -0.78];
const LEG_HIP_X = 0.55;
function legGroup(posIdx, side) { return (posIdx + side) % 4; } // diagonal groups

function makeAgent(def, rng) {
  const best = randomBrain(rng);
  return {
    name: def.name, color: def.color, lane: def.lane,
    bestBrain: best, bestScore: -1e9,
    stats: { rounds: 0, finishes: 0, wins: 0, violations: 0, bestDist: 0, bestTime: 0, distHistory: [] },
    rt: null,
  };
}
function resetRuntime(a) {
  a.rt = {
    x: a.lane, z: 0, vx: 0, vz: 0, heading: 0,
    pitch: 0, roll: 0, pitchV: 0, rollV: 0,
    phase: 0, speed: 0, score: 0, distMax: 0,
    finished: false, finishTime: 0, stun: 0, sentBacks: 0,
    throttle: 0, brake: 0, freq: 0, amp: 0, coordination: 0,
    feet: new Float32Array(8 * 3), // world xyz per leg (foot)
    hips: new Float32Array(8 * 3),
    knees: new Float32Array(8 * 3),
    lastEvent: null, // 'sentback' | 'finish' | 'trip'
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

const _inp = new Float32Array(IN);
const _out = new Float32Array(OUT);

function stepAgent(sim, a, dt) {
  const rt = a.rt;
  if (rt.finished) { rt.speed = 0; return; }
  const L = sim.light;
  const isGreen = L.state === 'green' ? 1 : -1;

  _inp[0] = isGreen;
  _inp[1] = clamp(L.t / 5, 0, 1);
  _inp[2] = clamp(rt.speed / 6, 0, 1);
  _inp[3] = clamp((TRACK_LEN - rt.z) / TRACK_LEN, 0, 1);
  _inp[4] = Math.sin(rt.phase);
  _inp[5] = Math.cos(rt.phase);
  _inp[6] = clamp(rt.pitch * 2, -1, 1);
  _inp[7] = clamp(rt.roll * 2, -1, 1);
  _inp[8] = rt.stun > 0 ? 1 : 0;
  brainForward(a._candidate || a.bestBrain, _inp, _out);

  const off = [_out[0] * Math.PI, _out[1] * Math.PI, _out[2] * Math.PI, _out[3] * Math.PI];
  const amp = 0.30 + 0.55 * ((_out[4] + 1) / 2) * 2 * 0.5 + 0.45 * ((_out[4] + 1) / 2); // 0.30..1.30
  const freq = 0.4 + 2.8 * ((_out[5] + 1) / 2);                                       // 0.4..3.2 Hz
  const dutyC = (_out[6]) * 0.5;                                                      // stance threshold shift
  let throttle = (_out[7] + 1) / 2;
  let brake = (_out[8] + 1) / 2;
  const steer = _out[9];
  if (rt.stun > 0) { throttle = 0; rt.stun -= dt; }
  rt.throttle = throttle; rt.brake = brake; rt.freq = freq; rt.amp = amp;

  const braking = brake > 0.6;
  if (!braking && throttle > 0.03) rt.phase += 2 * Math.PI * freq * dt;

  // legs
  let pushSum = 0, leftPush = 0, rightPush = 0, frontPush = 0, rearPush = 0, stanceCount = 0;
  const cosH = Math.cos(rt.heading), sinH = Math.sin(rt.heading);
  for (let leg = 0; leg < 8; leg++) {
    const side = leg % 2, posIdx = (leg / 2) | 0;
    const lp = rt.phase + off[legGroup(posIdx, side)];
    const s = Math.sin(lp);
    const stance = braking ? true : (s < dutyC);
    const push = stance ? Math.max(0, -s) : 0;
    pushSum += push;
    if (side === 0) leftPush += push; else rightPush += push;
    if (posIdx < 2) frontPush += push; else rearPush += push;
    if (stance) stanceCount++;
    // foot world position (for the view + support visuals)
    const hipLX = (side === 0 ? -LEG_HIP_X : LEG_HIP_X);
    const hipLZ = LEG_HIP_Z[posIdx];
    const hx = rt.x + hipLX * cosH + hipLZ * sinH;
    const hz = rt.z - hipLX * sinH + hipLZ * cosH;
    const stride = amp * Math.cos(lp) * 0.55;
    const fx = hx + stride * sinH + (side === 0 ? -0.45 : 0.45) * cosH;
    const fz = hz + stride * cosH - (side === 0 ? -0.45 : 0.45) * sinH;
    const fy = stance ? 0 : Math.max(0, s) * 0.42;
    rt.hips[leg * 3] = hx; rt.hips[leg * 3 + 1] = BODY_H; rt.hips[leg * 3 + 2] = hz;
    rt.feet[leg * 3] = fx; rt.feet[leg * 3 + 1] = fy; rt.feet[leg * 3 + 2] = fz;
    // knee: midpoint pushed outward + up
    rt.knees[leg * 3] = (hx + fx) / 2 + (side === 0 ? -0.28 : 0.28) * cosH;
    rt.knees[leg * 3 + 1] = (BODY_H + fy) / 2 + 0.22;
    rt.knees[leg * 3 + 2] = (hz + fz) / 2 - (side === 0 ? -0.28 : 0.28) * sinH;
  }
  const supportFrac = stanceCount / 8;
  rt.coordination = pushSum / 8;

  // body wobble (springs driven by push imbalance)
  const pTarget = (rearPush - frontPush) * 0.05;
  const rTarget = (leftPush - rightPush) * 0.05;
  rt.pitchV += ((pTarget - rt.pitch) * 26 - rt.pitchV * 6) * dt;
  rt.rollV += ((rTarget - rt.roll) * 26 - rt.rollV * 6) * dt;
  rt.pitch += rt.pitchV * dt;
  rt.roll += rt.rollV * dt;

  // propulsion
  const eff = 1 - Math.min(0.6, (Math.abs(rt.pitch) + Math.abs(rt.roll)) * 0.45);
  const maxAccel = 15;
  let accel = throttle * rt.coordination * maxAccel * (amp / 0.8) * eff;
  if (freq < 0.7) accel *= freq / 0.7;
  if (braking) accel = 0;
  const vCap = amp * freq * 1.35;
  rt.vx += sinH * accel * dt;
  rt.vz += cosH * accel * dt;

  // drag: rolling + support friction + braking
  let drag = 0.5 + supportFrac * 1.1;
  if (braking) drag = 16;
  else if (throttle < 0.05) drag += 1.6;
  const dMul = Math.max(0, 1 - drag * dt);
  rt.vx *= dMul; rt.vz *= dMul;

  // cap speed near vCap (soft)
  const sp = Math.hypot(rt.vx, rt.vz);
  if (sp > vCap && !braking) {
    const over = 1 - Math.min(1, (sp - vCap)) * 2.2 * dt * 3;
    rt.vx *= over; rt.vz *= over;
  }

  // steering / yaw drift from push imbalance
  const yawRate = (leftPush - rightPush) * 0.045 + steer * (throttle > 0.03 ? 1.1 : 0.25);
  rt.heading += yawRate * dt * clamp(sp * 0.7 + 0.35, 0, 1.4);

  // integrate
  const prevZ = rt.z;
  rt.x += rt.vx * dt;
  rt.z += rt.vz * dt;
  if (rt.x < -WALL_X) { rt.x = -WALL_X; rt.vx = 0; }
  if (rt.x > WALL_X) { rt.x = WALL_X; rt.vx = 0; }
  if (rt.z < 0) { rt.z = 0; rt.vz = Math.max(0, rt.vz); }
  rt.speed = Math.hypot(rt.vx, rt.vz);

  // trip over if wobbling wildly at speed
  if ((Math.abs(rt.pitch) > 0.6 || Math.abs(rt.roll) > 0.6) && rt.speed > 1.2 && rt.stun <= 0) {
    rt.vx *= 0.25; rt.vz *= 0.25; rt.stun = 0.45;
    rt.pitchV += (sim.rng() - 0.5) * 3; rt.rollV += (sim.rng() - 0.5) * 3;
    rt.score -= 1;
    rt.lastEvent = 'trip';
    sim.events.push({ type: 'trip', agent: a.name, t: sim.time });
  }

  // rewards: forward progress, green-idle tick
  const dz = rt.z - prevZ;
  if (dz > 0) rt.score += dz;
  if (L.state === 'green' && rt.speed < 0.3) rt.score -= 0.30 * dt;
  if (rt.z > rt.distMax) rt.distMax = rt.z;

  // red-light violation -> sent back to the start line
  if (L.state === 'red' && L.t > RED_GRACE && rt.speed > RED_SPEED) {
    rt.z = 0; rt.vx = 0; rt.vz = 0; rt.speed = 0; rt.stun = 0.6;
    rt.sentBacks++; a.stats.violations++;
    rt.score -= 15;
    rt.lastEvent = 'sentback';
    sim.events.push({ type: 'sentback', agent: a.name, t: sim.time });
  }

  // finish
  if (rt.z >= TRACK_LEN) {
    rt.z = TRACK_LEN; rt.finished = true; rt.finishTime = sim.time;
    rt.score += 50 + (ROUND_TIME - sim.time) * 0.5;
    rt.lastEvent = 'finish';
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

/* Run one full round: every agent runs a fresh mutant of its best brain.
   Adopt the mutant if it beats the (slowly forgetting) personal best. */
function runRound(sim) {
  sim.round++;
  sim.time = 0;
  sim.light = { state: 'green', t: 0, dur: 3 + sim.rng() * 2 };
  const results = [];
  for (const a of sim.agents) {
    resetRuntime(a);
    a._candidate = mutateBrain(a.bestBrain, sim.rng, 0.22);
    a.stats.rounds++;
  }
  let steps = Math.round(ROUND_TIME / DT);
  while (steps-- > 0) {
    stepSim(sim, DT);
    if (sim.agents.every(a => a.rt.finished)) break;
  }
  let roundWinner = null, bestScore = -1e9;
  for (const a of sim.agents) {
    const rt = a.rt;
    const res = {
      name: a.name, score: rt.score, dist: rt.distMax,
      finished: rt.finished, time: rt.finishTime, sentBacks: rt.sentBacks,
    };
    results.push(res);
    if (res.score > bestScore) { bestScore = res.score; roundWinner = a; }
    // evolution: forget a little, then adopt-if-better
    a.bestScore *= 0.998;
    if (rt.score > a.bestScore) {
      a.bestBrain = a._candidate;
      a.bestScore = rt.score;
      res.adopted = true;
    } else res.adopted = false;
    a._candidate = null;
    if (rt.distMax > a.stats.bestDist) a.stats.bestDist = rt.distMax;
    if (rt.finished) {
      a.stats.finishes++;
      if (!a.stats.bestTime || rt.finishTime < a.stats.bestTime) a.stats.bestTime = rt.finishTime;
    }
    a.stats.distHistory.push(Math.round(rt.distMax * 10) / 10);
    if (a.stats.distHistory.length > 120) a.stats.distHistory.shift();
  }
  if (roundWinner) roundWinner.stats.wins++;
  return { round: sim.round, results, winner: roundWinner ? roundWinner.name : null };
}

/* Run the current best brains (no mutation) — used by watch mode so the
   spiders perform with what they've learned. Watch rounds also teach:
   afterwards, treat the result as an evaluation of a fresh mutant only
   in training. In watch mode we run best brains and still run the same
   candidate pipeline, so watching = learning too. (runRound is used for
   both; the view simply renders it in real time via stepSim.) */

/* For watch mode the view drives stepSim itself; this prepares a round
   exactly like runRound but leaves stepping to the caller. */
function beginRound(sim, mutate) {
  sim.round++;
  sim.time = 0;
  sim.light = { state: 'green', t: 0, dur: 3 + sim.rng() * 2 };
  for (const a of sim.agents) {
    resetRuntime(a);
    a._candidate = mutate ? mutateBrain(a.bestBrain, sim.rng, 0.22) : null;
    a.stats.rounds++;
  }
}
function endRound(sim) {
  const results = [];
  let roundWinner = null, bestScore = -1e9;
  for (const a of sim.agents) {
    const rt = a.rt;
    const res = { name: a.name, score: rt.score, dist: rt.distMax, finished: rt.finished, time: rt.finishTime, sentBacks: rt.sentBacks };
    results.push(res);
    if (res.score > bestScore) { bestScore = res.score; roundWinner = a; }
    res.adopted = false;
    if (a._candidate) {
      a.bestScore *= 0.998;
      if (rt.score > a.bestScore) { a.bestBrain = a._candidate; a.bestScore = rt.score; res.adopted = true; }
      a._candidate = null;
    }
    if (rt.distMax > a.stats.bestDist) a.stats.bestDist = rt.distMax;
    if (rt.finished) { a.stats.finishes++; if (!a.stats.bestTime || rt.finishTime < a.stats.bestTime) a.stats.bestTime = rt.finishTime; }
    a.stats.distHistory.push(Math.round(rt.distMax * 10) / 10);
    if (a.stats.distHistory.length > 120) a.stats.distHistory.shift();
  }
  if (roundWinner) roundWinner.stats.wins++;
  return { round: sim.round, results, winner: roundWinner ? roundWinner.name : null };
}

/* ---------------- persistence ---------------- */
function serialize(sim) {
  return {
    v: 1,
    agents: sim.agents.map(a => ({
      best: Array.from(a.bestBrain),
      bestScore: a.bestScore,
      stats: a.stats,
    })),
  };
}
function deserialize(sim, data) {
  if (!data || data.v !== 1 || !Array.isArray(data.agents)) return false;
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
