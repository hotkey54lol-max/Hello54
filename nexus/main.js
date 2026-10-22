/* Project Nexus — boot: engine + environment + physics + character + sandbox. */
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { Environment, heightAt } from './world/environment.js';
import * as THREE from 'three';
import { Physics } from './world/physics.js';
import { Character } from './game/character.js';
import { Sandbox } from './game/sandbox.js';
import { Net } from './services/net.js';
import { AudioService } from './services/audio.js';
import { Particles } from './services/particles.js';
import { Npc } from './services/npc.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function boot() {
  const status = msg => { const el = document.getElementById('nxStatus'); if (el) el.textContent = msg; };
  const canvas = document.getElementById('nxCanvas');
  const engine = new Engine(canvas);
  const input = new Input(canvas);
  engine.setPixelScale(1);

  status('Growing the island…');
  const env = new Environment(engine.scene, engine.renderer);

  status('Waking physics (Rapier)…');
  const physics = new Physics();
  await physics.init(env.terrainData, env.scatter);

  status('Dressing the character…');
  const gltf = await new GLTFLoader().loadAsync(new URL('./assets/models/Soldier.glb', import.meta.url).href);
  const character = new Character(engine.scene, physics, input, gltf);
  await character.init();
  physics.trackCharacter(character.body); // render interpolation for the player too

  const sandbox = new Sandbox(engine.scene, physics, character, env);
  physics.onSplash = (x, z, power) => sandbox.splash(x, z, power);
  const particles = new Particles(engine.scene);

  /* multiplayer ghosts (silent solo fallback) */
  let myName = 'Player1';
  try { myName = localStorage.getItem('arcade_name') || 'Player1'; } catch (e) {}
  const net = new Net(engine.scene, gltf, () => {
    const p = character.pos;
    return { x: p.x, y: p.y, z: p.z, ry: character.faceYaw, sp: character.speed2d };
  }, myName);
  net.init();

  /* ambient NPC: a bot who lives on the island (the AI stand-in) */
  const npc = new Npc(engine.scene, gltf);

  engine.addSystem({ beginFrame: () => physics.beginFrame(), step: dt => { physics.step(dt); } });
  engine.addSystem({ step: dt => { env.update(dt); } });
  /* render trap: every render system runs behind a seatbelt. An exception in
     any one of them must surface as a loud error, never as a silently frozen
     canvas with a still-ticking HUD (the build .30 lesson). */
  const trap = (name, fn) => {
    try { fn(); } catch (e) {
      if (!engine._renderErr) {
        engine._renderErr = name + ': ' + (e && e.message ? e.message : e);
        console.error('[nexus-render] ' + engine._renderErr);
      }
    }
  };
  engine.addSystem({
    render: (alpha, dt) => {
      trap('character', () => character.render(alpha, dt, engine.camera));
      trap('props', () => physics.syncProps(alpha));
      trap('sandbox', () => sandbox.render(dt));
      trap('particles', () => particles.update(dt, character.pos, env.daylight ?? 1, env.effWet, env.effWind));
      trap('audio', () => audio.update(dt, { speed: character.speed2d, grounded: character.grounded, vy: character.vy, wet: env.effWet, wind: env.effWind }));
      trap('net', () => net.update(dt, performance.now()));
      trap('npc', () => npc.update(dt));
      trap('shadows', () => env.followShadows(character.model.position));
      if (cine.on) trap('cine', () => {
        /* Sequencer stand-in: a slow cinematic orbit + breathing dolly
           around the player, with letterbox bars (body.cine in the page) */
        cine.t += dt;
        const p = character.model.position;
        const a = cine.t * 0.11, r = 8.5 + Math.sin(cine.t * 0.05) * 2.5;
        const cx = p.x + Math.sin(a) * r, cz = p.z + Math.cos(a) * r;
        const cy = Math.max(heightAt(cx, cz) + 1.3, p.y + 1.7 + Math.sin(cine.t * 0.07) * 1.1);
        engine.camera.position.lerp(_cineTmp.set(cx, cy, cz), 1 - Math.pow(0.001, dt));
        engine.camera.lookAt(p.x, p.y + 1.4, p.z);
      });
    },
  });
  const _cineTmp = new THREE.Vector3();
  const cine = { on: false, t: 0 };
  function setCine(on) {
    cine.on = !!on; cine.t = 0;
    character.camLock = cine.on;
    document.body.classList.toggle('cine', cine.on);
  }

  /* governor announcements */
  const toast = document.getElementById('nxToast');
  let toastTimer = null;
  engine.onGovernor = (factor, dir) => {
    // POTATO tier: shed ambient particles + halve splashes, never touch gameplay
    const low = factor <= 0.65;
    env.setLowFx(low); sandbox.setLowFx(low); particles.setLowFx(low);
    if (!toast) return;
    toast.textContent = dir === 'down'
      ? '⚡ Auto-graphics: easing quality to ' + Math.round(factor * 100) + '% so the frame rate holds'
      : '⚡ Auto-graphics: restoring quality to ' + Math.round(factor * 100) + '%';
    toast.style.opacity = 1;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.opacity = 0; }, 3200);
  };

  /* sandbox UI wiring */
  document.querySelectorAll('[data-spawn]').forEach(b =>
    b.addEventListener('click', () => sandbox.spawn(b.dataset.spawn)));
  const timeSlider = document.getElementById('nxTime');
  if (timeSlider) timeSlider.addEventListener('input', () => { env.autoCycle = false; env.setTime(parseFloat(timeSlider.value)); syncCycleBtn(); });
  const cycleBtn = document.getElementById('nxCycle');
  function syncCycleBtn() { if (cycleBtn) cycleBtn.textContent = env.autoCycle ? '🕐 Cycle: ON' : '🕐 Cycle: off'; }
  if (cycleBtn) cycleBtn.addEventListener('click', () => { env.autoCycle = !env.autoCycle; syncCycleBtn(); });
  const rainBtn = document.getElementById('nxRain');
  const weatherModes = [['auto', '🌦 Weather: Auto'], ['clear', '☀ Weather: Clear'], ['cloudy', '☁ Weather: Cloudy'], ['rain', '🌧 Weather: Rain'], ['storm', '⛈ Weather: Storm']];
  let weatherIdx = 0;
  function syncWeatherBtn() { if (rainBtn) rainBtn.textContent = weatherModes[weatherIdx][1]; }
  if (rainBtn) rainBtn.addEventListener('click', () => {
    weatherIdx = (weatherIdx + 1) % weatherModes.length;
    env.setWeather(weatherModes[weatherIdx][0]);
    syncWeatherBtn();
  });
  const clearBtn = document.getElementById('nxClear');
  if (clearBtn) clearBtn.addEventListener('click', () => sandbox.clearProps());
  const stormBtn = document.getElementById('nxStorm');
  if (stormBtn) stormBtn.addEventListener('click', () => env.summonStorm(true));
  const cineBtn = document.getElementById('nxCine');
  if (cineBtn) cineBtn.addEventListener('click', () => setCine(!cine.on));
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyC') setCine(!cine.on);
    else if (cine.on && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) setCine(false);
    const map = { Digit1: 'crate', Digit2: 'ball', Digit3: 'barrel', Digit4: 'plank', Digit5: 'tower', Digit6: 'bomb', Digit7: 'dominoes', Digit8: 'bigball' };
    if (map[e.code]) sandbox.spawn(map[e.code]);
    if (e.code === 'KeyR') {
      const w = env.weather;
      if (w.mode === 'manual' && w.state === 'rain') { env.setWeather('auto'); weatherIdx = 0; }
      else { env.setWeather('rain'); weatherIdx = 3; }
      syncWeatherBtn();
    }
    if (e.code === 'KeyT') env.summonStorm(true);
    if (e.code === 'KeyH') document.body.classList.toggle('ui-hidden');
  });

  /* audio: synthesized; starts on first gesture (browser policy) */
  const audio = new AudioService();
  sandbox.sfx = audio;
  env.sfx = audio;
  const gesture = () => audio.ensure();
  window.addEventListener('pointerdown', gesture);
  window.addEventListener('keydown', gesture);
  const soundBtn = document.getElementById('nxSound');
  if (soundBtn) soundBtn.addEventListener('click', () => {
    audio.ensure();
    audio.setMuted(!audio.muted);
    soundBtn.textContent = audio.muted ? '🔇 Sound: off' : '🔊 Sound: on';
  });

  /* settings panel */
  const settings = (() => { try { return JSON.parse(localStorage.getItem('nx_settings') || '{}'); } catch (e) { return {}; } })();
  const saveSettings = () => { try { localStorage.setItem('nx_settings', JSON.stringify(settings)); } catch (e) {} };
  const scaleSel = document.getElementById('nxScale');
  const shChk = document.getElementById('nxShadows');
  const blChk = document.getElementById('nxBloom');
  const aoChk = document.getElementById('nxAO');
  const filmChk = document.getElementById('nxFilm');
  function applySettings() {
    const sc = parseFloat(settings.scale || '1');
    engine.setPixelScale(sc);
    if (scaleSel) scaleSel.value = String(settings.scale || '1');
    env.sun.castShadow = settings.shadows !== false;
    if (shChk) shChk.checked = settings.shadows !== false;
    engine.userBloom = settings.bloom !== false;
    engine.bloom.enabled = engine.userBloom && engine.govFactor > 0.65;
    if (blChk) blChk.checked = settings.bloom !== false;
    engine.userAO = settings.ao !== false;
    engine.ao.enabled = engine.userAO && engine.govFactor > 0.85;
    if (aoChk) aoChk.checked = settings.ao !== false;
    engine.userFilm = settings.film !== false; // film/vignette grade toggle
    engine.film.enabled = engine.userFilm && engine.govFactor > 0.65;
    if (filmChk) filmChk.checked = settings.film !== false;
  }
  if (scaleSel) scaleSel.addEventListener('change', () => { settings.scale = scaleSel.value; saveSettings(); applySettings(); });
  if (shChk) shChk.addEventListener('change', () => { settings.shadows = shChk.checked; saveSettings(); applySettings(); });
  if (blChk) blChk.addEventListener('change', () => { settings.bloom = blChk.checked; saveSettings(); applySettings(); });
  if (aoChk) aoChk.addEventListener('change', () => { settings.ao = aoChk.checked; saveSettings(); applySettings(); });
  if (filmChk) filmChk.addEventListener('change', () => { settings.film = filmChk.checked; saveSettings(); applySettings(); });
  const setBtn = document.getElementById('nxSettingsBtn');
  const setPanel = document.getElementById('nxSettings');
  if (setBtn && setPanel) setBtn.addEventListener('click', () => {
    setPanel.style.display = setPanel.style.display === 'none' ? 'block' : 'none';
  });
  applySettings();

  /* touch jump button (shown only on touch devices) */
  const jumpBtn = document.getElementById('nxJump');
  if (jumpBtn && 'ontouchstart' in window) {
    jumpBtn.style.display = 'block';
    jumpBtn.addEventListener('touchstart', e => { e.preventDefault(); input.keys['Space'] = true; }, { passive: false });
    jumpBtn.addEventListener('touchend', e => { e.preventDefault(); input.keys['Space'] = false; }, { passive: false });
  }

  /* perf HUD */
  const hud = document.getElementById('nxHud');
  setInterval(() => {
    if (!hud) return;
    const f = engine.frame;
    hud.textContent = 'FPS ' + f.fps + ' · ' + f.ms.toFixed(1) + 'ms · sim ' + f.simMs.toFixed(1) + 'ms · draws ' + f.calls + ' · tris ' + (f.tris / 1000).toFixed(0) + 'k · bodies ' + physics.bodyCount + ' · props ' + physics.props.length + ' · gov ' + Math.round(engine.govFactor * 100) + '%' +
      ' · MP ' + (net.online ? 'on' : 'off') + ' peers ' + net.peerCount + ' rx ' + net.rxCount + (net.lastErr ? ' ERR ' + net.lastErr : '');
  }, 200);

  /* test/debug surface */
  window.__nx = {
    ready: true,
    pos: () => character.pos,
    speed: () => character.speed2d,
    grounded: () => character.grounded,
    fps: () => engine.frame.fps,
    calls: () => engine.frame.calls,
    tris: () => engine.frame.tris,
    bodies: () => physics.bodyCount,
    props: () => physics.props.length,
    gov: () => engine.govFactor,
    spawn: k => sandbox.spawn(k),
    setTime: h => { env.autoCycle = false; env.setTime(h); },
    time: () => env.timeOfDay,
    rain: on => sandbox.setRain(on),
    setCam: (yaw, pitch, dist) => { character.camYaw = yaw; if (pitch !== undefined) character.camPitch = pitch; if (dist !== undefined) character.camDist = dist; },
    press: (code, down) => { input.keys[code] = !!down; },
    peers: () => net.peerCount,
    online: () => net.online,
    weather: () => ({ state: env.weather.state, mode: env.weather.mode, wet: +env.weather.wet.toFixed(2), cloud: +env.weather.cloud.toFixed(2), wind: +env.weather.wind.toFixed(2), flash: +env.weather.flash.toFixed(2) }),
    ao: () => engine.ao.enabled,
    particles: () => particles.mode,
    npc: () => ({ x: +npc.pos.x.toFixed(1), z: +npc.pos.z.toFixed(1), state: npc.state }),
    npcDebug: () => ({ state: npc.state, wait: +npc.wait.toFixed(2), hasTarget: !!npc.target, modelY: +npc.model.position.y.toFixed(2), renderErr: engine._renderErr || '' }),
    setCine: on => setCine(on),
    cineOn: () => cine.on,
    grass: () => ({ visible: env.grassChunks.filter(c => c.mesh.visible).length, total: env.grassChunks.length }),
    setGrassCull: d => { env.grassCull = d; },
    kinds: () => physics.props.map(p => p.kind),
    camPos: () => { const c = engine.camera.position; return { x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2) }; },
    setWeather: n => env.setWeather(n),
    tilts: () => physics.props.filter(p => p.kind === 'domino').map(p => {
      /* rotation SINCE spawn (dominoes stand flush on slopes, so absolute
         tilt from identity is meaningless — movement is what counts) */
      if (!p.spawnQuat) return 0;
      const q = p.mesh.quaternion, s = p.spawnQuat;
      const dot = Math.abs(q.x * s.x + q.y * s.y + q.z * s.z + q.w * s.w);
      return Math.round(2 * Math.acos(Math.min(1, dot)) * 57.3);
    }),
    propsPos: () => physics.props.map(p => [p.kind, +p.mesh.position.x.toFixed(1), +p.mesh.position.z.toFixed(1)]),
    debugGhost: () => {
      const p = character.pos;
      net._addGhost('nx-debug1', 'DebugGhost');
      net._onPos({ id: 'nx-debug1', n: 'DebugGhost', x: p.x + 2.5, y: p.y, z: p.z, ry: 0, sp: 0 });
      const g = net.peers.get('nx-debug1');
      return g ? { visible: g.model.visible, pos: g.model.position.toArray(), children: g.model.children.length } : null;
    },
    /* expansion chunk 2 debug surface */
    alpha: () => engine.lastAlpha,
    simTime: () => +engine.simTime.toFixed(2),
    renderErr: () => engine._renderErr || '',
    fxErr: () => env._fxErr || '',
    film: () => ({ enabled: engine.film.enabled, user: engine.userFilm !== false }),
    propInterp: i => { // verifies the render-interpolation contract directly
      const p = physics.props[i];
      if (!p || p.fixed) return null;
      const r = v => +v.toFixed(3);
      return {
        mesh: [r(p.mesh.position.x), r(p.mesh.position.y), r(p.mesh.position.z)],
        prev: [r(p.prevP.x), r(p.prevP.y), r(p.prevP.z)],
        cur: [r(p.curP.x), r(p.curP.y), r(p.curP.z)],
        alpha: +engine.lastAlpha.toFixed(3), stepped: physics._hadSteps,
      };
    },
    charInterp: () => {
      const o = { x: 0, y: 0, z: 0 };
      physics.charPos(engine.lastAlpha, o);
      const m = character.model.position;
      return { interp: [+o.x.toFixed(3), +o.z.toFixed(3)], model: [+m.x.toFixed(3), +m.z.toFixed(3)] };
    },
    summonStorm: (speed) => env.summonStorm(true, speed || 0),
    frontPlace: (x, peak) => { env.front.active = true; env.front.x = x; env.front.peak = peak == null ? 1 : peak; },
    front: () => ({
      active: env.front.active, x: +env.front.x.toFixed(1), peak: +env.front.peak.toFixed(2),
      prox: +env.frontProx.toFixed(2), wet: +env.effWet.toFixed(2), cloud: +env.effCloud.toFixed(2),
      wind: +env.effWind.toFixed(2), bankVisible: env.bank.visible,
      bankI: +env.bankUniforms.uIntensity.value.toFixed(2),
      bankPos: env.bank.position.toArray().map(v => +v.toFixed(1)),
    }),
    frontSkip: () => { env.front.x = env.front.dir * 545; }, // fast-forward the front off the island (tests)
    splash: (x, z, p) => sandbox.splash(x === undefined ? 0 : x, z === undefined ? 8 : z, p || 3),
    splashActive: () => sandbox.splashActiveCount(),
    glint: () => ({ visible: env.glint.visible, strength: +env.glintUniforms.uGlint.value.toFixed(2) }),
    setLowFx: v => { env.setLowFx(v); sandbox.setLowFx(v); particles.setLowFx(v); },
    lowFx: () => ({ env: env.lowFx, sandbox: sandbox.lowFx, particles: particles.lowFx }),
  };

  status('');
  const load = document.getElementById('nxLoading');
  if (load) load.style.display = 'none';
  engine.start();
  return { engine, env, physics, character, sandbox };
}
