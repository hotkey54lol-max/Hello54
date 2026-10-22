/* Project Nexus — boot: engine + environment + physics + character + sandbox. */
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { Environment } from './world/environment.js';
import { Physics } from './world/physics.js';
import { Character } from './game/character.js';
import { Sandbox } from './game/sandbox.js';
import { Net } from './services/net.js';
import { AudioService } from './services/audio.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function boot() {
  const status = msg => { const el = document.getElementById('nxStatus'); if (el) el.textContent = msg; };
  const canvas = document.getElementById('nxCanvas');
  const engine = new Engine(canvas);
  const input = new Input(canvas);
  engine.setPixelScale(1);

  status('Growing the island…');
  const env = new Environment(engine.scene);

  status('Waking physics (Rapier)…');
  const physics = new Physics();
  await physics.init(env.terrainData, env.scatter);

  status('Dressing the character…');
  const gltf = await new GLTFLoader().loadAsync(new URL('./assets/models/Soldier.glb', import.meta.url).href);
  const character = new Character(engine.scene, physics, input, gltf);
  await character.init();

  const sandbox = new Sandbox(engine.scene, physics, character, env);

  /* multiplayer ghosts (silent solo fallback) */
  let myName = 'Player1';
  try { myName = localStorage.getItem('arcade_name') || 'Player1'; } catch (e) {}
  const net = new Net(engine.scene, gltf, () => {
    const p = character.pos;
    return { x: p.x, y: p.y, z: p.z, ry: character.faceYaw, sp: character.speed2d };
  }, myName);
  net.init();

  engine.addSystem({ step: dt => { physics.step(dt); } });
  engine.addSystem({ step: dt => { env.update(dt); } });
  engine.addSystem({
    render: (alpha, dt) => {
      character.render(dt, engine.camera);
      physics.syncProps();
      sandbox.render(dt);
      audio.update(dt, { speed: character.speed2d, grounded: character.grounded, vy: character.vy, raining: sandbox.raining });
      net.update(dt, performance.now());
      env.followShadows(character.model.position);
    },
  });

  /* governor announcements */
  const toast = document.getElementById('nxToast');
  let toastTimer = null;
  engine.onGovernor = (factor, dir) => {
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
  if (rainBtn) rainBtn.addEventListener('click', () => { sandbox.setRain(!sandbox.raining); rainBtn.textContent = sandbox.raining ? '🌧 Rain: ON' : '🌧 Rain: off'; });
  const clearBtn = document.getElementById('nxClear');
  if (clearBtn) clearBtn.addEventListener('click', () => sandbox.clearProps());
  window.addEventListener('keydown', e => {
    const map = { Digit1: 'crate', Digit2: 'ball', Digit3: 'barrel', Digit4: 'plank', Digit5: 'tower', Digit6: 'bomb' };
    if (map[e.code]) sandbox.spawn(map[e.code]);
    if (e.code === 'KeyR') sandbox.setRain(!sandbox.raining);
  });

  /* audio: synthesized; starts on first gesture (browser policy) */
  const audio = new AudioService();
  sandbox.sfx = audio;
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
  function applySettings() {
    const sc = parseFloat(settings.scale || '1');
    engine.setPixelScale(sc);
    if (scaleSel) scaleSel.value = String(settings.scale || '1');
    env.sun.castShadow = settings.shadows !== false;
    if (shChk) shChk.checked = settings.shadows !== false;
    engine.userBloom = settings.bloom !== false;
    engine.bloom.enabled = engine.userBloom && engine.govFactor > 0.65;
    if (blChk) blChk.checked = settings.bloom !== false;
  }
  if (scaleSel) scaleSel.addEventListener('change', () => { settings.scale = scaleSel.value; saveSettings(); applySettings(); });
  if (shChk) shChk.addEventListener('change', () => { settings.shadows = shChk.checked; saveSettings(); applySettings(); });
  if (blChk) blChk.addEventListener('change', () => { settings.bloom = blChk.checked; saveSettings(); applySettings(); });
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
    hud.textContent = 'FPS ' + f.fps + ' · ' + f.ms.toFixed(1) + 'ms · sim ' + f.simMs.toFixed(1) + 'ms · draws ' + f.calls + ' · tris ' + (f.tris / 1000).toFixed(0) + 'k · bodies ' + physics.bodyCount + ' · props ' + physics.props.length + ' · gov ' + Math.round(engine.govFactor * 100) + '%';
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
  };

  status('');
  const load = document.getElementById('nxLoading');
  if (load) load.style.display = 'none';
  engine.start();
  return { engine, env, physics, character, sandbox };
}
