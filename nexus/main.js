/* Project Nexus — boot: engine + environment + physics + character + sandbox. */
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { Environment } from './world/environment.js';
import { Physics } from './world/physics.js';
import { Character } from './game/character.js';
import { Sandbox } from './game/sandbox.js';

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
  const character = new Character(engine.scene, physics, input);
  await character.init();

  const sandbox = new Sandbox(engine.scene, physics, character, env);

  engine.addSystem({ step: dt => { physics.step(dt); } });
  engine.addSystem({ step: dt => { env.update(dt); } });
  engine.addSystem({
    render: (alpha, dt) => {
      character.render(dt, engine.camera);
      physics.syncProps();
      sandbox.render(dt);
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
    const map = { Digit1: 'crate', Digit2: 'ball', Digit3: 'barrel', Digit4: 'plank', Digit5: 'tower' };
    if (map[e.code]) sandbox.spawn(map[e.code]);
    if (e.code === 'KeyR') sandbox.setRain(!sandbox.raining);
  });

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
  };

  status('');
  const load = document.getElementById('nxLoading');
  if (load) load.style.display = 'none';
  engine.start();
  return { engine, env, physics, character, sandbox };
}
